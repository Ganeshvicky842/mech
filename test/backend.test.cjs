const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { after, before, test } = require('node:test');

const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrench-backend-'));
const adminEmail = 'test-admin@example.com';
const adminPassword = 'test-only-password-for-wrench';
let port;
let serverProcess;
let smtpServer;
let smtpPort;
let lastEmail = '';

async function unusedPort() {
  const probe = http.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port: freePort } = probe.address();
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return freePort;
}

async function startServer() {
  port = await unusedPort();
  serverProcess = spawn(process.execPath, [path.join(root, 'server.cjs')], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATABASE_PATH: path.join(dataDir, 'wrench.sqlite'), ADMIN_EMAIL: adminEmail, ADMIN_PASSWORD: adminPassword, ADMIN_RECOVERY_EMAIL: 'recovery@example.com', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtpPort), SMTP_SECURE: 'false', SMTP_USER: 'smtp-user@example.com', SMTP_APP_PASSWORD: 'test-only-smtp-password', APP_BASE_URL: `http://127.0.0.1:${port}`, NODE_ENV: 'test' },
    stdio: 'ignore'
  });
  const address = `http://127.0.0.1:${port}`;
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    if (serverProcess.exitCode !== null) throw new Error(`Backend exited with status ${serverProcess.exitCode}.`);
    try {
      const response = await fetch(`${address}/api/health`);
      if (response.ok) return address;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Backend did not become ready.');
}

async function startSmtpServer() {
  smtpServer = net.createServer(socket => {
    let buffer = '';
    let receivingMessage = false;
    let message = '';
    socket.write('220 localhost test SMTP\r\n');
    socket.on('data', chunk => {
      buffer += chunk.toString();
      while (buffer.includes('\r\n')) {
        const newline = buffer.indexOf('\r\n');
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        if (receivingMessage) {
          if (line === '.') {
            receivingMessage = false;
            lastEmail = message;
            message = '';
            socket.write('250 message accepted\r\n');
          } else {
            message += `${line}\r\n`;
          }
        } else if (/^EHLO /i.test(line) || /^HELO /i.test(line)) {
          socket.write('250-localhost\r\n250 AUTH PLAIN LOGIN\r\n');
        } else if (/^AUTH /i.test(line)) {
          socket.write('235 authenticated\r\n');
        } else if (/^(MAIL FROM|RCPT TO|RSET|NOOP)/i.test(line)) {
          socket.write('250 accepted\r\n');
        } else if (line === 'DATA') {
          receivingMessage = true;
          socket.write('354 send message\r\n');
        } else if (line === 'QUIT') {
          socket.write('221 goodbye\r\n');
          socket.end();
        } else {
          socket.write('500 unsupported command\r\n');
        }
      }
    });
  });
  smtpServer.listen(0, '127.0.0.1');
  await once(smtpServer, 'listening');
  smtpPort = smtpServer.address().port;
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  const exited = once(serverProcess, 'exit');
  serverProcess.kill();
  await exited;
  serverProcess = null;
}

before(async () => {
  await startSmtpServer();
  await startServer();
});
after(async () => {
  await stopServer();
  if (smtpServer?.listening) await new Promise((resolve, reject) => smtpServer.close(error => error ? reject(error) : resolve()));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('persists requests and protects workshop management APIs', async () => {
  let address = `http://127.0.0.1:${port}`;
  const call = async (route, options = {}) => {
    const response = await fetch(`${address}${route}`, options);
    const body = await response.json().catch(() => null);
    return { response, body };
  };

  let result = await call('/api/health');
  assert.equal(result.body.status, 'ok');
  assert.equal(result.response.headers.get('x-frame-options'), 'DENY');
  assert.equal(result.response.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
  assert.equal((await call('/server.cjs')).response.status, 404);
  assert.equal((await call('/.data/wrench.sqlite')).response.status, 404);
  result = await call('/api/mechanics');
  assert.equal(result.body.length, 6);
  result = await call('/api/catalog');
  assert.equal(result.body.length, 18);

  const invalidDate = await call('/api/availability?date=2026-02-30');
  assert.equal(invalidDate.response.status, 400);
  const appointmentDate = new Date(Date.now() + 2 * 86400000);
  appointmentDate.setHours(12, 0, 0, 0);
  while (appointmentDate.getDay() === 0) appointmentDate.setDate(appointmentDate.getDate() + 1);
  const date = new Date(appointmentDate.getTime() - appointmentDate.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const availability = await call(`/api/availability?date=${date}`);
  assert.ok(availability.body.slots.length > 0);

  const bookingInput = { name: 'Backend Test', phone: '+91 98765 43210', car: 'Test Car', registration: 'KA 01 ZZ 0101', service: 'Routine service', date, time: availability.body.slots[0], handover: 'Drop-off at our workshop', note: 'Persistent booking test' };
  const json = { 'Content-Type': 'application/json' };
  const bookingResult = await call('/api/bookings', { method: 'POST', headers: json, body: JSON.stringify(bookingInput) });
  assert.equal(bookingResult.response.status, 201);
  const duplicate = await call('/api/bookings', { method: 'POST', headers: json, body: JSON.stringify(bookingInput) });
  assert.equal(duplicate.response.status, 409);
  const invalidPhone = await call('/api/bookings', { method: 'POST', headers: json, body: JSON.stringify({ ...bookingInput, time: availability.body.slots[1], phone: 'letters-only' }) });
  assert.equal(invalidPhone.response.status, 400);

  const roadsideInput = { name: 'Emergency Test', phone: '+91 90000 12345', vehicle: 'Test SUV', registration: 'KA 01 ZZ 0202', location: 'Test road', issue: 'Flat tyre', details: 'Rear tyre punctured and vehicle cannot move.', mechanic: 'Ravi Varma' };
  const roadsideResult = await call('/api/roadside-requests', { method: 'POST', headers: json, body: JSON.stringify(roadsideInput) });
  assert.equal(roadsideResult.response.status, 201);
  assert.equal((await call('/api/admin/bootstrap')).response.status, 401);
  const deniedLogin = await call('/api/admin/login', { method: 'POST', headers: { ...json, Origin: 'http://untrusted.invalid' }, body: JSON.stringify({ email: adminEmail, password: adminPassword }) });
  assert.equal(deniedLogin.response.status, 403);

  const login = await call('/api/admin/login', { method: 'POST', headers: { ...json, Origin: address }, body: JSON.stringify({ email: adminEmail, password: adminPassword }) });
  assert.equal(login.response.status, 200);
  const cookie = login.response.headers.get('set-cookie').split(';')[0];
  let bootstrap = await call('/api/admin/bootstrap', { headers: { Cookie: cookie } });
  assert.ok(bootstrap.body.bookings.some(booking => booking.id === bookingResult.body.id));
  assert.ok(bootstrap.body.roadsideRequests.some(request => request.id === roadsideResult.body.id));
  const assignedMechanic = bootstrap.body.mechanics.find(mechanic => mechanic.name === 'Arjun Singh');
  assert.ok(assignedMechanic);
  assert.equal(assignedMechanic.monthlySalary, 0);

  const roadsideUpdate = await call(`/api/admin/roadside-requests/${roadsideResult.body.id}`, { method: 'PATCH', headers: { ...json, Origin: address, Cookie: cookie }, body: JSON.stringify({ status: 'Contacting customer', mechanic: 'Ravi Varma' }) });
  assert.equal(roadsideUpdate.body.status, 'Contacting customer');
  const bookingUpdate = await call(`/api/admin/bookings/${bookingResult.body.id}`, { method: 'PATCH', headers: { ...json, Origin: address, Cookie: cookie }, body: JSON.stringify({ status: 'Confirmed' }) });
  assert.equal(bookingUpdate.body.status, 'Confirmed');
  const assignedBooking = await call(`/api/admin/bookings/${bookingResult.body.id}`, { method: 'PATCH', headers: { ...json, Origin: address, Cookie: cookie }, body: JSON.stringify({ mechanicId: assignedMechanic.id }) });
  assert.equal(assignedBooking.body.mechanicName, assignedMechanic.name);
  const completedBooking = await call(`/api/admin/bookings/${bookingResult.body.id}`, { method: 'PATCH', headers: { ...json, Origin: address, Cookie: cookie }, body: JSON.stringify({ status: 'Completed' }) });
  assert.equal(completedBooking.body.mechanicId, assignedMechanic.id);
  const salary = await call(`/api/admin/mechanics/${assignedMechanic.id}/salary`, { method: 'PATCH', headers: { ...json, Origin: address, Cookie: cookie }, body: JSON.stringify({ monthlySalary: 42000 }) });
  assert.equal(salary.body.monthlySalary, 42000);
  const invalidSalary = await call(`/api/admin/mechanics/${assignedMechanic.id}/salary`, { method: 'PATCH', headers: { ...json, Origin: address, Cookie: cookie }, body: JSON.stringify({ monthlySalary: -1 }) });
  assert.equal(invalidSalary.response.status, 400);
  const checkIn = await call('/api/admin/mechanic-attendance', { method: 'POST', headers: { ...json, Origin: address, Cookie: cookie }, body: JSON.stringify({ mechanicId: assignedMechanic.id, action: 'check-in' }) });
  assert.equal(checkIn.response.status, 200);
  const duplicateCheckIn = await call('/api/admin/mechanic-attendance', { method: 'POST', headers: { ...json, Origin: address, Cookie: cookie }, body: JSON.stringify({ mechanicId: assignedMechanic.id, action: 'check-in' }) });
  assert.equal(duplicateCheckIn.response.status, 409);
  const checkOut = await call('/api/admin/mechanic-attendance', { method: 'POST', headers: { ...json, Origin: address, Cookie: cookie }, body: JSON.stringify({ mechanicId: assignedMechanic.id, action: 'check-out' }) });
  assert.ok(checkOut.body.checkOut);
  const duplicateCheckOut = await call('/api/admin/mechanic-attendance', { method: 'POST', headers: { ...json, Origin: address, Cookie: cookie }, body: JSON.stringify({ mechanicId: assignedMechanic.id, action: 'check-out' }) });
  assert.equal(duplicateCheckOut.response.status, 409);
  bootstrap = await call('/api/admin/bootstrap', { headers: { Cookie: cookie } });
  assert.equal(bootstrap.body.mechanics.find(mechanic => mechanic.id === assignedMechanic.id).monthlySalary, 42000);
  assert.ok(bootstrap.body.attendance.some(record => record.mechanicId === assignedMechanic.id && record.checkOut));
  assert.equal(bootstrap.body.bookings.find(booking => booking.id === bookingResult.body.id).status, 'Completed');
  const releasedBooking = await call('/api/bookings', { method: 'POST', headers: json, body: JSON.stringify({ ...bookingInput, time: availability.body.slots[1] }) });
  assert.equal(releasedBooking.response.status, 201);
  const cancelBooking = await call(`/api/admin/bookings/${releasedBooking.body.id}`, { method: 'PATCH', headers: { ...json, Origin: address, Cookie: cookie }, body: JSON.stringify({ status: 'Cancelled' }) });
  assert.equal(cancelBooking.body.status, 'Cancelled');
  assert.ok((await call(`/api/availability?date=${date}`)).body.slots.includes(availability.body.slots[1]));

  const stockBefore = bootstrap.body.inventory.find(item => item.sku === 'OIL-5W30').qty;
  const partOrder = await call('/api/part-orders', { method: 'POST', headers: json, body: JSON.stringify({ name: 'Order Test', phone: '+91 98765 00000', items: [{ sku: 'OIL-5W30', quantity: 1 }] }) });
  assert.equal(partOrder.response.status, 201);
  assert.equal(partOrder.body.total, 2450);
  const orderUpdate = await call(`/api/admin/part-orders/${partOrder.body.id}`, { method: 'PATCH', headers: { ...json, Origin: address, Cookie: cookie }, body: JSON.stringify({ status: 'Confirmed' }) });
  assert.equal(orderUpdate.body.status, 'Confirmed');
  const cancelledOrder = await call('/api/part-orders', { method: 'POST', headers: json, body: JSON.stringify({ name: 'Cancel Test', phone: '+91 98765 00001', items: [{ sku: 'OIL-5W30', quantity: 1 }] }) });
  const cancelOrder = await call(`/api/admin/part-orders/${cancelledOrder.body.id}`, { method: 'PATCH', headers: { ...json, Origin: address, Cookie: cookie }, body: JSON.stringify({ status: 'Cancelled' }) });
  assert.equal(cancelOrder.body.status, 'Cancelled');
  const stockUpdate = await call('/api/admin/inventory/OIL-5W30', { method: 'PATCH', headers: { ...json, Origin: address, Cookie: cookie }, body: JSON.stringify({ direction: 'in', quantity: 2, party: 'Test supplier' }) });
  assert.equal(stockUpdate.body.qty, stockBefore + 1);
  const newPart = await call('/api/admin/inventory', { method: 'POST', headers: { ...json, Origin: address, Cookie: cookie }, body: JSON.stringify({ sku: 'TEST-PART-01', name: 'Test filter', category: 'Spare parts', brand: 'Test', qty: 3, min: 1, cost: 10, price: 15 }) });
  assert.equal(newPart.response.status, 201);
  const sale = await call('/api/admin/transactions', { method: 'POST', headers: { ...json, Origin: address, Cookie: cookie }, body: JSON.stringify({ type: 'Sale', party: 'Test customer', detail: 'API test sale', amount: 25 }) });
  assert.equal(sale.response.status, 201);
  const paid = await call('/api/admin/invoices/INV-1086', { method: 'PATCH', headers: { ...json, Origin: address, Cookie: cookie }, body: JSON.stringify({}) });
  assert.equal(paid.body.status, 'Paid');
  const duplicatePayment = await call('/api/admin/invoices/INV-1086', { method: 'PATCH', headers: { ...json, Origin: address, Cookie: cookie }, body: JSON.stringify({}) });
  assert.equal(duplicatePayment.body.status, 'Paid');
  const offer = await call('/api/admin/offers', { method: 'POST', headers: { ...json, Origin: address, Cookie: cookie }, body: JSON.stringify({ tag: 'API TEST', title: 'Test offer', desc: 'Offer created by backend test', when: 'Test only', code: 'API-TEST' }) });
  assert.equal(offer.response.status, 201);
  const mechanic = await call('/api/admin/mechanics', { method: 'POST', headers: { ...json, Origin: address, Cookie: cookie }, body: JSON.stringify({ name: 'Test Mechanic', initials: 'TM', specialty: 'Test repairs', description: 'Test mechanic for directory API coverage.', skills: 'Testing,Diagnostics', location: 'Test area', experience: 4, rating: 4.5 }) });
  assert.equal(mechanic.response.status, 201);
  const unavailable = await call(`/api/admin/mechanics/${mechanic.body.id}`, { method: 'PATCH', headers: { ...json, Origin: address, Cookie: cookie }, body: JSON.stringify({ status: 'Unavailable' }) });
  assert.equal(unavailable.body.status, 'Unavailable');
  assert.equal((await call('/api/mechanics')).body.some(item => item.name === 'Test Mechanic'), false);

  const genericRecovery = await call('/api/admin/forgot-password', { method: 'POST', headers: { ...json, Origin: address }, body: JSON.stringify({ email: 'unknown@example.com' }) });
  assert.equal(genericRecovery.response.status, 200);
  assert.equal(genericRecovery.body.message, 'If the administrator email is valid, recovery instructions will be sent to the configured recovery inbox.');
  const recovery = await call('/api/admin/forgot-password', { method: 'POST', headers: { ...json, Origin: address }, body: JSON.stringify({ email: adminEmail }) });
  assert.equal(recovery.response.status, 200);
  const decodedEmail = lastEmail.replace(/=\r\n/g, '').replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const expiredToken = decodedEmail.match(/reset-password\.html\?token=([a-f0-9]{64})/)?.[1];
  assert.ok(expiredToken, 'SMTP message should contain a one-time reset token');
  const testDatabase = new DatabaseSync(path.join(dataDir, 'wrench.sqlite'));
  testDatabase.prepare('UPDATE admin_password_resets SET expires_at=0').run();
  testDatabase.close();
  const expiredReset = await call('/api/admin/reset-password', { method: 'POST', headers: { ...json, Origin: address }, body: JSON.stringify({ token: expiredToken, password: 'new-test-admin-password' }) });
  assert.equal(expiredReset.response.status, 400);
  const renewedRecovery = await call('/api/admin/forgot-password', { method: 'POST', headers: { ...json, Origin: address }, body: JSON.stringify({ email: adminEmail }) });
  assert.equal(renewedRecovery.response.status, 200);
  const renewedEmail = lastEmail.replace(/=\r\n/g, '').replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const resetToken = renewedEmail.match(/reset-password\.html\?token=([a-f0-9]{64})/)?.[1];
  assert.ok(resetToken, 'renewed SMTP message should contain a reset token');
  const invalidReset = await call('/api/admin/reset-password', { method: 'POST', headers: { ...json, Origin: address }, body: JSON.stringify({ token: '0'.repeat(64), password: 'new-test-admin-password' }) });
  assert.equal(invalidReset.response.status, 400);
  const newPassword = 'new-test-admin-password-2026';
  const reset = await call('/api/admin/reset-password', { method: 'POST', headers: { ...json, Origin: address }, body: JSON.stringify({ token: resetToken, password: newPassword }) });
  assert.equal(reset.response.status, 200);
  assert.equal((await call('/api/admin/bootstrap', { headers: { Cookie: cookie } })).response.status, 401);
  const reusedReset = await call('/api/admin/reset-password', { method: 'POST', headers: { ...json, Origin: address }, body: JSON.stringify({ token: resetToken, password: 'another-new-password-2026' }) });
  assert.equal(reusedReset.response.status, 400);
  const oldPasswordLogin = await call('/api/admin/login', { method: 'POST', headers: { ...json, Origin: address }, body: JSON.stringify({ email: adminEmail, password: adminPassword }) });
  assert.equal(oldPasswordLogin.response.status, 401);

  await stopServer();
  address = await startServer();
  const relogin = await call('/api/admin/login', { method: 'POST', headers: { ...json, Origin: address }, body: JSON.stringify({ email: adminEmail, password: newPassword }) });
  const persistentCookie = relogin.response.headers.get('set-cookie').split(';')[0];
  bootstrap = await call('/api/admin/bootstrap', { headers: { Cookie: persistentCookie } });
  assert.ok(bootstrap.body.bookings.some(booking => booking.id === bookingResult.body.id));
  assert.equal(bootstrap.body.roadsideRequests.find(request => request.id === roadsideResult.body.id).status, 'Contacting customer');
  assert.equal(bootstrap.body.inventory.find(item => item.sku === 'OIL-5W30').qty, stockBefore + 1);
  assert.equal(bootstrap.body.partOrders.find(order => order.id === partOrder.body.id).status, 'Confirmed');
  assert.equal(bootstrap.body.partOrders.find(order => order.id === cancelledOrder.body.id).status, 'Cancelled');
  assert.equal(bootstrap.body.inventory.some(item => item.sku === 'TEST-PART-01'), true);
  assert.equal(bootstrap.body.offers.some(item => item.code === 'API-TEST'), true);
  assert.equal(bootstrap.body.mechanics.find(item => item.name === 'Test Mechanic').status, 'Unavailable');
});
