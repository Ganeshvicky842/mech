const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { MongoClient } = require('mongodb');
const nodemailer = require('nodemailer');
const applySecurityHeaders = require('./middleware/security.cjs');
const { createMongoStore } = require('./mongo-store.cjs');

const root = __dirname;
require('dotenv').config({ path: path.join(root, '.env') });
const dataDir = path.resolve(process.env.WRENCH_DATA_DIR || path.join(root, '.data'));
const databasePath = path.resolve(root, process.env.DATABASE_PATH || path.join(dataDir, 'wrench.sqlite'));
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const database = new DatabaseSync(databasePath);
const mongoEnabled = process.env.DATABASE_BACKEND !== 'sqlite';
if (mongoEnabled && !process.env.MONGO_URL) throw new Error('Set MONGO_URL in .env or set DATABASE_BACKEND=sqlite for local-only use.');
let databaseDirty = false;
const originalPrepare = database.prepare.bind(database);
database.prepare = sql => {
  const statement = originalPrepare(sql);
  const mutatesData = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql);
  return new Proxy(statement, {
    get(target, property) {
      if (property === 'run') return (...params) => {
        const result = target.run(...params);
        if (mutatesData && result.changes) databaseDirty = true;
        return result;
      };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
};
database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || '127.0.0.1';
const adminEmail = (process.env.ADMIN_EMAIL || 'admin@wrenchco.in').trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'wrench123');
const adminRecoveryEmail = (process.env.ADMIN_RECOVERY_EMAIL || 'ramollarakesh143@gmail.com').trim().toLowerCase();
const smtpUser = (process.env.SMTP_USER || '').trim();
const smtpPassword = (process.env.SMTP_APP_PASSWORD || '').replace(/\s/g, '');
const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
const smtpPort = Number(process.env.SMTP_PORT || 465);
const smtpSecure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : smtpPort === 465;
const smtpFrom = (process.env.SMTP_FROM || smtpUser).trim();
const appBaseUrl = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)) {
  throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD before starting in production.');
}
if (process.env.NODE_ENV !== 'production' && !process.env.ADMIN_PASSWORD) {
  console.warn('Using the local demo admin account. Set ADMIN_EMAIL and ADMIN_PASSWORD before deployment.');
}
const sessions = new Map();
const loginAttempts = new Map();
const recoveryAttempts = new Map();
const sessionDuration = 8 * 60 * 60 * 1000;
let mongoClient;
let mongoStore;
let mongoRequestQueue = Promise.resolve();
const slotOptions = ['09:00 AM', '10:00 AM', '11:30 AM', '01:00 PM', '02:00 PM', '03:30 PM', '04:30 PM', '05:30 PM'];
const serviceNames = ['Routine service', 'Repairs & diagnostics', 'Genuine parts', 'Pick-up & delivery', 'Car care & detailing'];
const categories = ['Genuine parts', 'Accessories', 'Spare parts'];
const bookingStatuses = ['Awaiting confirmation', 'Confirmed', 'In progress', 'Completed', 'Cancelled'];
const roadsideStatuses = ['New', 'Contacting customer', 'Dispatched', 'Completed', 'Cancelled'];
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jsx': 'text/babel; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon' };
const publicFiles = new Set(['index.html', 'emergency.html', 'styles.css', 'mechanic-performance.css', 'catalog.css', 'theme.css', 'auto-theme.css', 'emergency.css', 'recovery.css', 'reset-password.css', 'app.js', 'api.js', 'catalog.jsx', 'emergency.js', 'reset-password.js', 'assets/mechanic-at-work.jpg']);
const products = [
  ['OIL-5W30', 'Synthetic engine oil · 5W-30', 'Genuine parts', 'Mobil 1', 24, 8, 1800, 2450],
  ['FLT-OEM-01', 'OEM oil filter · Universal', 'Genuine parts', 'Bosch', 18, 10, 280, 420],
  ['BRK-PAD-22', 'Ceramic brake pad set', 'Spare parts', 'Brembo', 5, 8, 2200, 3290],
  ['CAB-FLT-07', 'Cabin air filter', 'Accessories', 'Mann', 31, 10, 450, 690],
  ['WIP-24-16', 'All-weather wiper pair', 'Accessories', 'Bosch', 12, 6, 650, 990],
  ['BAT-AGM-12', 'AGM battery · 12V', 'Genuine parts', 'Amaron', 7, 5, 7200, 8990],
  ['SPK-IR-04', 'Iridium spark plug set', 'Genuine parts', 'Bosch', 14, 5, 1200, 1890],
  ['BELT-GT-17', 'Serpentine drive belt', 'Genuine parts', 'Gates', 9, 4, 780, 1290],
  ['ALT-OEM-09', 'Alternator assembly', 'Genuine parts', 'Denso', 4, 2, 9800, 12490],
  ['SUS-BJ-17', 'Front suspension ball joint', 'Spare parts', 'CTR', 11, 4, 850, 1390],
  ['IGN-COIL-09', 'Ignition coil pack', 'Spare parts', 'NGK', 8, 3, 1650, 2490],
  ['LMP-LED-03', 'LED headlamp assembly', 'Spare parts', 'Lumax', 6, 2, 4100, 5690],
  ['ACC-PHN-12', 'Universal dashboard phone mount', 'Accessories', 'Portronics', 28, 8, 260, 499],
  ['ACC-MAT-01', 'All-weather floor mat set', 'Accessories', '3D Mats', 13, 5, 1450, 2290],
  ['ACC-AIR-02', 'Portable tyre inflator · 12V', 'Accessories', 'Michelin', 10, 4, 1750, 2690],
  ['ACC-ORG-02', 'Premium seat-back organiser', 'Accessories', 'Wrench Select', 17, 5, 540, 990],
  ['ACC-CARE-06', 'Microfibre car care kit', 'Accessories', 'Wrench Select', 22, 7, 390, 750],
  ['ACC-CHG-04', 'Dual-port USB-C car charger', 'Accessories', 'Portronics', 21, 6, 340, 649]
];
const mechanicSeeds = [
  ['Arjun Singh', 'AS', 'Engine diagnostics & repair', 'Tracks down warning lights, rough idling and engine performance issues, then explains repairs before work begins.', 'OBD diagnostics,Engine care', 'Indiranagar · Bengaluru', 12, 4.9, 'Available'],
  ['Priya Kumar', 'PK', 'Auto electrical & batteries', 'Specialises in battery, alternator, starter and lighting faults to help get you powered up.', 'Battery testing,Electrical', 'Koramangala · Bengaluru', 9, 4.8, 'Available'],
  ['Ravi Varma', 'RV', 'Tyres & roadside recovery', 'Handles punctures, wheel changes and safe recovery coordination when your vehicle cannot continue.', 'Tyre repair,Recovery', 'HSR Layout · Bengaluru', 10, 4.9, 'Available'],
  ['Neha Kulkarni', 'NK', 'Brakes & suspension', 'Checks brake noise, vibration and handling concerns with safety-first inspections and clear next steps.', 'Brake systems,Suspension', 'Jayanagar · Bengaluru', 8, 4.8, 'Available'],
  ['Imran Malik', 'IM', 'Cooling & air conditioning', 'Diagnoses overheating, coolant leaks and AC issues, and helps you understand when it is safer to stop.', 'Cooling systems,AC service', 'Whitefield · Bengaluru', 11, 4.9, 'Available'],
  ['Sneha Desai', 'SD', 'Routine service & inspections', 'Provides preventive maintenance, fluid and filter checks, and practical advice for everyday reliability.', 'Maintenance,Vehicle checks', 'Indiranagar · Bengaluru', 7, 4.8, 'Available']
];
const bookingSeeds = [
  ['WC-2401', 'Rohan Mehta', '+91 98765 12340', 'Honda City', 'KA 03 MN 8241', 'Routine service', '10:00 AM', 'Drop-off at our workshop', 'Confirmed', 5499],
  ['WC-2402', 'Ishita Rao', '+91 99001 77540', 'Hyundai Creta', 'KA 05 AB 1120', 'Repairs & diagnostics', '11:30 AM', 'Free pick-up & delivery', 'Awaiting confirmation', 3200],
  ['WC-2403', 'Kabir Nair', '+91 98451 88771', 'Maruti Swift', 'KA 02 CM 4528', 'Genuine parts', '02:00 PM', 'Drop-off at our workshop', 'In progress', 1850],
  ['WC-2404', 'Ananya Das', '+91 99860 31824', 'Tata Nexon', 'KA 04 TR 9921', 'Routine service', '04:30 PM', 'Free pick-up & delivery', 'Confirmed', 4899]
];
const invoiceSeeds = [
  ['INV-1086', 'Ishita Rao', 'Diagnostics & parts', 8200, '2026-09-24', 'Pending'],
  ['INV-1084', 'Rohan Mehta', 'Routine service', 5499, '2026-09-22', 'Pending'],
  ['INV-1078', 'Vikram Shah', 'Brake repair', 3750, '2026-09-18', 'Overdue'],
  ['INV-1075', 'Mira Joshi', 'Genuine parts', 6400, '2026-09-17', 'Pending']
];
const transactionSeeds = [
  ['TX-9021', 'Sale', 'Rohan Mehta', 'Routine service · WC-2401', 5499],
  ['TX-9020', 'Purchase', 'Bosch Automotive', 'Filters & accessories', 12400],
  ['TX-9019', 'Sale', 'Ananya Das', 'Routine service · WC-2398', 4899],
  ['TX-9018', 'Purchase', 'Mobil India', 'Engine oil · 12 units', 21600]
];
const offerSeeds = [
  ['POPULAR', 'Monsoon-ready check-up', 'Complimentary 18-point safety inspection with every full service.', 'Valid through 31 October 2026', 'RAINREADY'],
  ['SAVE ₹500', 'A smoother first visit', 'New customers save ₹500 on repairs over ₹3,000.', 'New customers · One use per vehicle', 'FIRSTDRIVE'],
  ['FREE PICK-UP', 'Care comes to you', 'Free car collection and return within 10 km of the workshop.', 'Every service · Book ahead', 'WRENCHCOMES']
];

database.exec(`
  CREATE TABLE IF NOT EXISTS admin_credentials (
    id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_password_resets (
    token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mechanics (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, initials TEXT NOT NULL, specialty TEXT NOT NULL,
    description TEXT NOT NULL, skills TEXT NOT NULL, location TEXT NOT NULL, experience INTEGER NOT NULL,
    rating REAL NOT NULL, status TEXT NOT NULL DEFAULT 'Available'
  );
  CREATE TABLE IF NOT EXISTS inventory (
    sku TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, brand TEXT NOT NULL,
    qty INTEGER NOT NULL CHECK(qty >= 0), min INTEGER NOT NULL CHECK(min >= 0),
    cost REAL NOT NULL CHECK(cost >= 0), price REAL NOT NULL CHECK(price >= 0)
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, car TEXT NOT NULL, registration TEXT NOT NULL,
    service TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, handover TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, price REAL NOT NULL DEFAULT 0,
    mechanic_id INTEGER REFERENCES mechanics(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS mechanic_salaries (
    mechanic_id INTEGER PRIMARY KEY REFERENCES mechanics(id) ON DELETE CASCADE,
    monthly_salary INTEGER NOT NULL DEFAULT 0 CHECK(monthly_salary >= 0)
  );
  CREATE TABLE IF NOT EXISTS mechanic_attendance (
    mechanic_id INTEGER NOT NULL REFERENCES mechanics(id) ON DELETE CASCADE,
    work_date TEXT NOT NULL, check_in TEXT NOT NULL, check_out TEXT,
    PRIMARY KEY(mechanic_id, work_date)
  );
  CREATE TABLE IF NOT EXISTS roadside_requests (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, vehicle TEXT NOT NULL, registration TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL, issue TEXT NOT NULL, details TEXT NOT NULL, mechanic TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'New', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY, customer TEXT NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL,
    due TEXT NOT NULL, status TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, party TEXT NOT NULL, detail TEXT NOT NULL,
    amount REAL NOT NULL, date TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS offers (
    code TEXT PRIMARY KEY, tag TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
    when_text TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS part_orders (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, lines TEXT NOT NULL,
    total REAL NOT NULL, status TEXT NOT NULL DEFAULT 'Requested', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS bookings_date_index ON bookings(date, time);
  CREATE UNIQUE INDEX IF NOT EXISTS active_booking_slot_index ON bookings(date,time) WHERE status!='Cancelled';
  CREATE INDEX IF NOT EXISTS roadside_created_index ON roadside_requests(created_at DESC);
`);
if (!database.prepare('PRAGMA table_info(bookings)').all().some(column => column.name === 'mechanic_id')) {
  database.exec('ALTER TABLE bookings ADD COLUMN mechanic_id INTEGER REFERENCES mechanics(id)');
}

if (!database.prepare('SELECT 1 FROM admin_credentials WHERE id=1').get() && adminPassword) {
  const salt = randomBytes(16).toString('hex');
  const passwordHash = scryptSync(adminPassword, salt, 64).toString('hex');
  database.prepare('INSERT INTO admin_credentials(id,salt,password_hash) VALUES(1,?,?)').run(salt, passwordHash);
}

const countRows = table => database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
if (countRows('mechanics') === 0) {
  const insert = database.prepare('INSERT INTO mechanics(name,initials,specialty,description,skills,location,experience,rating,status) VALUES(?,?,?,?,?,?,?,?,?)');
  for (const mechanic of mechanicSeeds) insert.run(...mechanic);
}
if (countRows('inventory') === 0) {
  const insert = database.prepare('INSERT INTO inventory(sku,name,category,brand,qty,min,cost,price) VALUES(?,?,?,?,?,?,?,?)');
  for (const product of products) insert.run(...product);
}
if (process.env.NODE_ENV !== 'production' && countRows('bookings') === 0) {
  const today = new Date();
  const date = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const insert = database.prepare('INSERT INTO bookings(id,name,phone,car,registration,service,date,time,handover,status,price) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  for (const booking of bookingSeeds) insert.run(booking[0], booking[1], booking[2], booking[3], booking[4], booking[5], date, booking[6], booking[7], booking[8], booking[9]);
}
if (process.env.NODE_ENV !== 'production' && countRows('invoices') === 0) {
  const insert = database.prepare('INSERT INTO invoices(id,customer,description,amount,due,status) VALUES(?,?,?,?,?,?)');
  for (const invoice of invoiceSeeds) insert.run(...invoice);
}
if (process.env.NODE_ENV !== 'production' && countRows('transactions') === 0) {
  const today = new Date().toISOString().slice(0, 10);
  const insert = database.prepare('INSERT INTO transactions(id,type,party,detail,amount,date) VALUES(?,?,?,?,?,?)');
  for (const tx of transactionSeeds) insert.run(tx[0], tx[1], tx[2], tx[3], tx[4], today);
}
if (process.env.NODE_ENV !== 'production' && countRows('offers') === 0) {
  const insert = database.prepare('INSERT INTO offers(tag,title,description,when_text,code) VALUES(?,?,?,?,?)');
  for (const offer of offerSeeds) insert.run(...offer);
}

function sendJson(response, status, data, extraHeaders = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders });
  response.end(JSON.stringify(data));
}
function fail(response, status, message) { sendJson(response, status, { error: message }); }
function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    request.on('data', chunk => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > 32768) {
        tooLarge = true;
        body = '';
        reject(Object.assign(new Error('Request body is too large.'), { status: 413 }));
      }
    });
    request.on('end', () => {
      if (tooLarge) return;
      try {
        const parsed = body ? JSON.parse(body) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        resolve(parsed);
      }
      catch { reject(Object.assign(new Error('Request body must be valid JSON.'), { status: 400 })); }
    });
    request.on('error', reject);
  });
}
const clean = value => typeof value === 'string' ? value.trim() : '';
function requiredFields(body, fields) {
  for (const [field, minLength] of Object.entries(fields)) {
    const value = clean(body[field]);
    if (value.length < minLength || value.length > 500) return `${field} must contain ${minLength}–500 characters.`;
  }
  return null;
}
function validPhone(phone) { return /^[+0-9 ()-]{8,18}$/.test(phone) && phone.replace(/\D/g, '').length >= 8; }
function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
function currentIsoDate() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function cookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map(value => {
    const index = value.indexOf('=');
    return [value.slice(0, index).trim(), decodeURIComponent(value.slice(index + 1).trim())];
  }));
}
function adminSession(request) {
  const token = cookies(request).wrench_admin_session;
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + sessionDuration;
  return session;
}
function passwordMatches(password) {
  const credentials = database.prepare('SELECT salt,password_hash FROM admin_credentials WHERE id=1').get();
  if (!credentials) return false;
  const suppliedHash = scryptSync(password, credentials.salt, 64);
  const storedHash = Buffer.from(credentials.password_hash, 'hex');
  return suppliedHash.length === storedHash.length && timingSafeEqual(suppliedHash, storedHash);
}
function requireAdmin(request, response) {
  if (adminSession(request)) return true;
  fail(response, 401, 'Administrator sign-in required.');
  return false;
}
function guardSameOrigin(request, response) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const forwardedProto = request.headers['x-forwarded-proto'];
  const protocol = forwardedProto ? forwardedProto.split(',')[0].trim() : (request.socket.encrypted ? 'https' : 'http');
  try {
    if (new URL(origin).host === request.headers.host && new URL(origin).protocol === `${protocol}:`) return true;
  } catch {}
  fail(response, 403, 'Cross-origin requests are not allowed.');
  return false;
}
function secureRequest(request) {
  return request.socket.encrypted || request.headers['x-forwarded-proto']?.split(',')[0].trim() === 'https';
}
function todayAvailable(date) {
  if (new Date(`${date}T00:00:00`).getDay() === 0) return [];
  const booked = new Set(database.prepare("SELECT time FROM bookings WHERE date=? AND status!='Cancelled'").all(date).map(row => row.time));
  return slotOptions.filter(time => !booked.has(time) && (date !== currentIsoDate() || timeIsFuture(time)));
}
function timeIsFuture(time) {
  const [clock, half] = time.split(' ');
  const [rawHour, minutes] = clock.split(':').map(Number);
  const hour = rawHour % 12 + (half === 'PM' ? 12 : 0);
  const now = new Date();
  return hour > now.getHours() || (hour === now.getHours() && minutes > now.getMinutes());
}
function bookingView(row) {
  return { id: row.id, name: row.name, phone: row.phone, car: row.car, registration: row.registration, service: row.service, date: row.date, time: row.time, handover: row.handover, note: row.note, status: row.status, price: row.price, mechanicId: row.mechanic_id, mechanicName: row.mechanic_name || '', createdAt: row.created_at };
}
function requestView(row) {
  return { id: row.id, name: row.name, phone: row.phone, vehicle: row.vehicle, registration: row.registration, location: row.location, issue: row.issue, details: row.details, mechanic: row.mechanic, status: row.status, createdAt: row.created_at };
}
function inventoryView(row) {
  return { sku: row.sku, name: row.name, category: row.category, brand: row.brand, qty: row.qty, min: row.min, cost: row.cost, price: row.price };
}
function adminBootstrap() {
  return {
    bookings: database.prepare('SELECT bookings.*, mechanics.name AS mechanic_name FROM bookings LEFT JOIN mechanics ON mechanics.id=bookings.mechanic_id ORDER BY date DESC,time DESC').all().map(bookingView),
    roadsideRequests: database.prepare('SELECT * FROM roadside_requests ORDER BY created_at DESC').all().map(requestView),
    mechanics: database.prepare('SELECT mechanics.*, COALESCE(mechanic_salaries.monthly_salary,0) AS monthlySalary FROM mechanics LEFT JOIN mechanic_salaries ON mechanic_salaries.mechanic_id=mechanics.id ORDER BY mechanics.id').all(),
    attendance: database.prepare("SELECT mechanic_id AS mechanicId,work_date AS date,check_in AS checkIn,check_out AS checkOut FROM mechanic_attendance WHERE work_date>=? ORDER BY work_date DESC,check_in DESC").all(`${currentIsoDate().slice(0, 7)}-01`),
    inventory: database.prepare('SELECT * FROM inventory ORDER BY name').all().map(inventoryView),
    invoices: database.prepare('SELECT id,customer,description AS desc,amount,due,status FROM invoices ORDER BY due DESC').all(),
    transactions: database.prepare('SELECT id,type,party,detail,amount,date FROM transactions ORDER BY date DESC,id DESC').all(),
    offers: database.prepare('SELECT tag,title,description AS desc,when_text AS \"when\",code,active FROM offers ORDER BY rowid DESC').all(),
    partOrders: database.prepare('SELECT id,name,phone,lines,total,status,created_at AS createdAt FROM part_orders ORDER BY created_at DESC').all()
  };
}
function insertTransaction(type, party, detail, amount) {
  const id = `TX-${Date.now()}-${randomBytes(2).toString('hex')}`;
  database.prepare('INSERT INTO transactions(id,type,party,detail,amount,date) VALUES(?,?,?,?,?,?)').run(id, type, party, detail, amount, currentIsoDate());
  return id;
}

async function handleApi(request, response, url) {
  const pathname = url.pathname;
  const method = request.method;
  if (method === 'GET' && pathname === '/api/health') {
    sendJson(response, 200, { status: 'ok', database: 'sqlite' });
    return;
  }
  if (method === 'GET' && pathname === '/api/mechanics') {
    sendJson(response, 200, database.prepare("SELECT id,name,initials,specialty,description,skills,location,experience,rating,status FROM mechanics WHERE status='Available' ORDER BY id").all());
    return;
  }
  if (method === 'GET' && pathname === '/api/catalog') {
    sendJson(response, 200, database.prepare('SELECT sku,name,category,brand,qty,min,cost,price FROM inventory WHERE qty>0 ORDER BY name').all());
    return;
  }
  if (method === 'GET' && pathname === '/api/availability') {
    const date = url.searchParams.get('date') || '';
    if (!validDate(date) || date < currentIsoDate()) return fail(response, 400, 'Choose a valid date today or later.');
    sendJson(response, 200, { date, slots: todayAvailable(date) });
    return;
  }
  if (method === 'POST' && pathname === '/api/bookings') {
    const body = await readBody(request);
    const fieldError = requiredFields(body, { name: 2, phone: 8, car: 2, registration: 2, service: 3, date: 10, time: 5, handover: 3 });
    if (fieldError) return fail(response, 400, fieldError);
    if (!validPhone(body.phone)) return fail(response, 400, 'Enter a valid phone number.');
    if (!serviceNames.includes(body.service)) return fail(response, 400, 'Choose a valid service.');
    if (!validDate(body.date) || body.date < currentIsoDate()) return fail(response, 400, 'Choose a valid date today or later.');
    if (!slotOptions.includes(body.time)) return fail(response, 400, 'Choose an available appointment time.');
    if (!['Drop-off at our workshop', 'Free pick-up & delivery'].includes(body.handover)) return fail(response, 400, 'Choose a valid vehicle handover option.');
    if (!todayAvailable(body.date).includes(body.time)) return fail(response, 409, 'That appointment time is no longer available.');
    const id = `WC-${randomBytes(4).toString('hex').toUpperCase()}`;
    const price = body.service === 'Routine service' ? 1499 : body.service === 'Repairs & diagnostics' ? 799 : 0;
    try {
      database.prepare('INSERT INTO bookings(id,name,phone,car,registration,service,date,time,handover,note,status,price) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, body.name.trim(), body.phone.trim(), body.car.trim(), body.registration.trim(), body.service, body.date, body.time, body.handover, clean(body.note).slice(0, 1000), 'Awaiting confirmation', price);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return fail(response, 409, 'That appointment time was just booked. Please choose another.');
      throw error;
    }
    sendJson(response, 201, bookingView(database.prepare('SELECT * FROM bookings WHERE id=?').get(id)));
    return;
  }
  if (method === 'POST' && pathname === '/api/roadside-requests') {
    const body = await readBody(request);
    const fieldError = requiredFields(body, { name: 2, phone: 8, vehicle: 2, location: 3, issue: 3, details: 10 });
    if (fieldError) return fail(response, 400, fieldError);
    if (!validPhone(body.phone)) return fail(response, 400, 'Enter a valid phone number.');
    const mechanic = clean(body.mechanic);
    if (mechanic && !database.prepare("SELECT 1 FROM mechanics WHERE name=? AND status='Available'").get(mechanic)) return fail(response, 400, 'Choose an available mechanic or request a match.');
    const id = `WR-${randomBytes(4).toString('hex').toUpperCase()}`;
    database.prepare('INSERT INTO roadside_requests(id,name,phone,vehicle,registration,location,issue,details,mechanic) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, body.name.trim(), body.phone.trim(), body.vehicle.trim(), clean(body.registration).slice(0, 40), body.location.trim(), body.issue.trim(), body.details.trim().slice(0, 2000), mechanic);
    sendJson(response, 201, requestView(database.prepare('SELECT * FROM roadside_requests WHERE id=?').get(id)));
    return;
  }
  if (method === 'POST' && pathname === '/api/part-orders') {
    const body = await readBody(request);
    const fieldError = requiredFields(body, { name: 2, phone: 8 });
    if (fieldError) return fail(response, 400, fieldError);
    if (!validPhone(body.phone)) return fail(response, 400, 'Enter a valid phone number.');
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) return fail(response, 400, 'Choose at least one part.');
    const lines = [];
    let total = 0;
    for (const line of body.items) {
      if (!line || typeof line !== 'object' || Array.isArray(line)) return fail(response, 400, 'Each requested part must include a SKU and quantity.');
      const sku = clean(line.sku);
      const quantity = Number(line.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) return fail(response, 400, 'Part quantities must be between 1 and 50.');
      const product = database.prepare('SELECT sku,name,qty,price FROM inventory WHERE sku=?').get(sku);
      if (!product || product.qty < quantity) return fail(response, 409, `Not enough stock for ${product?.name || sku}.`);
      lines.push({ sku, name: product.name, quantity, price: product.price });
      total += product.price * quantity;
    }
    const id = `PO-${randomBytes(4).toString('hex').toUpperCase()}`;
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const line of lines) {
        const changed = database.prepare('UPDATE inventory SET qty=qty-? WHERE sku=? AND qty>=?').run(line.quantity, line.sku, line.quantity);
        if (changed.changes !== 1) throw new Error(`Not enough stock for ${line.name}.`);
      }
      database.prepare('INSERT INTO part_orders(id,name,phone,lines,total) VALUES(?,?,?,?,?)')
        .run(id, body.name.trim(), body.phone.trim(), JSON.stringify(lines), total);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      if (error.message.startsWith('Not enough stock')) return fail(response, 409, error.message);
      throw error;
    }
    sendJson(response, 201, { id, total, items: lines, status: 'Requested' });
    return;
  }
  if (pathname === '/api/admin/login' && method === 'POST') {
    if (!guardSameOrigin(request, response)) return;
    const ip = request.socket.remoteAddress || 'unknown';
    const attempts = loginAttempts.get(ip) || { count: 0, blockedUntil: 0 };
    if (attempts.blockedUntil > Date.now()) return fail(response, 429, 'Too many sign-in attempts. Try again in a few minutes.');
    const body = await readBody(request);
    const suppliedPassword = typeof body.password === 'string' ? body.password : '';
    const emailMatches = clean(body.email).toLowerCase() === adminEmail;
    if (!emailMatches || !passwordMatches(suppliedPassword)) {
      attempts.count += 1;
      if (attempts.count >= 5) { attempts.count = 0; attempts.blockedUntil = Date.now() + 5 * 60 * 1000; }
      loginAttempts.set(ip, attempts);
      return fail(response, attempts.blockedUntil ? 429 : 401, 'Email or password is incorrect.');
    }
    loginAttempts.delete(ip);
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { email: adminEmail, expiresAt: Date.now() + sessionDuration });
    const cookie = `wrench_admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionDuration / 1000}${secureRequest(request) ? '; Secure' : ''}`;
    sendJson(response, 200, { email: adminEmail }, { 'Set-Cookie': cookie });
    return;
  }
  if (pathname === '/api/admin/forgot-password' && method === 'POST') {
    if (!guardSameOrigin(request, response)) return;
    const ip = request.socket.remoteAddress || 'unknown';
    const attempts = recoveryAttempts.get(ip) || { count: 0, windowStartedAt: Date.now() };
    if (Date.now() - attempts.windowStartedAt >= 60 * 60 * 1000) {
      attempts.count = 0;
      attempts.windowStartedAt = Date.now();
    }
    if (attempts.count >= 5) {
      recoveryAttempts.set(ip, attempts);
      return fail(response, 429, 'Too many recovery requests. Please try again later.');
    }
    attempts.count += 1;
    recoveryAttempts.set(ip, attempts);
    const body = await readBody(request);
    const genericMessage = 'If the administrator email is valid, recovery instructions will be sent to the configured recovery inbox.';
    if (clean(body.email).toLowerCase() !== adminEmail) {
      sendJson(response, 200, { message: genericMessage });
      return;
    }
    if (!adminRecoveryEmail || !smtpUser || !smtpPassword || !appBaseUrl || (process.env.NODE_ENV === 'production' && !appBaseUrl.startsWith('https://'))) {
      console.error('Password recovery is not configured. Set ADMIN_RECOVERY_EMAIL, SMTP_USER, SMTP_APP_PASSWORD, and APP_BASE_URL (HTTPS in production).');
      return fail(response, 503, 'Password recovery is not configured. Contact the workshop administrator.');
    }
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = Date.now() + 30 * 60 * 1000;
    database.prepare('DELETE FROM admin_password_resets WHERE expires_at<=?').run(Date.now());
    database.prepare('DELETE FROM admin_password_resets').run();
    database.prepare('INSERT INTO admin_password_resets(token_hash,expires_at,created_at) VALUES(?,?,?)').run(tokenHash, expiresAt, Date.now());
    const resetUrl = `${appBaseUrl}/reset-password.html?token=${encodeURIComponent(token)}`;
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: { user: smtpUser, pass: smtpPassword }
      });
      await transporter.sendMail({
        from: smtpFrom,
        to: adminRecoveryEmail,
        subject: 'Wrench & Co. administrator password reset',
        text: `A password reset was requested for your Wrench & Co. administrator account.\n\nUse this one-time link within 30 minutes:\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
        html: `<p>A password reset was requested for your Wrench &amp; Co. administrator account.</p><p><a href="${resetUrl}">Reset your administrator password</a></p><p>This one-time link expires in 30 minutes. If you did not request this, you can ignore this email.</p>`
      });
    } catch (error) {
      database.prepare('DELETE FROM admin_password_resets WHERE token_hash=?').run(tokenHash);
      console.error('Administrator recovery email could not be sent:', error);
      return fail(response, 503, 'Recovery email could not be sent. Check the server email configuration and try again.');
    }
    sendJson(response, 200, { message: genericMessage });
    return;
  }
  if (pathname === '/api/admin/reset-password' && method === 'POST') {
    if (!guardSameOrigin(request, response)) return;
    const body = await readBody(request);
    const token = clean(body.token);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!/^[a-f0-9]{64}$/i.test(token)) return fail(response, 400, 'This password reset link is invalid or expired.');
    if (password.length < 12 || password.length > 200) return fail(response, 400, 'Choose a password between 12 and 200 characters.');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const reset = database.prepare('SELECT expires_at FROM admin_password_resets WHERE token_hash=?').get(tokenHash);
    if (!reset || reset.expires_at <= Date.now()) {
      if (reset) database.prepare('DELETE FROM admin_password_resets WHERE token_hash=?').run(tokenHash);
      return fail(response, 400, 'This password reset link is invalid or expired.');
    }
    const salt = randomBytes(16).toString('hex');
    const passwordHash = scryptSync(password, salt, 64).toString('hex');
    database.exec('BEGIN IMMEDIATE');
    try {
      const consumed = database.prepare('DELETE FROM admin_password_resets WHERE token_hash=? AND expires_at>?').run(tokenHash, Date.now());
      if (consumed.changes !== 1) {
        database.exec('ROLLBACK');
        return fail(response, 400, 'This password reset link is invalid or expired.');
      }
      database.prepare('UPDATE admin_credentials SET salt=?,password_hash=? WHERE id=1').run(salt, passwordHash);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    sessions.clear();
    sendJson(response, 200, { message: 'Your password has been updated. Sign in with your new password.' });
    return;
  }
  if (pathname === '/api/admin/logout' && method === 'POST') {
    if (!guardSameOrigin(request, response)) return;
    const token = cookies(request).wrench_admin_session;
    if (token) sessions.delete(token);
    sendJson(response, 200, { ok: true }, { 'Set-Cookie': `wrench_admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureRequest(request) ? '; Secure' : ''}` });
    return;
  }
  if (method === 'GET' && pathname === '/api/admin/session') {
    const session = adminSession(request);
    sendJson(response, 200, { authenticated: !!session, email: session?.email || null });
    return;
  }
  if (pathname.startsWith('/api/admin/')) {
    if (!requireAdmin(request, response)) return;
    if (method === 'GET' && pathname === '/api/admin/bootstrap') {
      sendJson(response, 200, adminBootstrap());
      return;
    }
    if (method === 'PATCH' && pathname.startsWith('/api/admin/bookings/')) {
      const id = decodeURIComponent(pathname.slice('/api/admin/bookings/'.length));
      const body = await readBody(request);
      if (body.status === undefined && body.mechanicId === undefined) return fail(response, 400, 'Choose a booking status or mechanic assignment to update.');
      if (body.status !== undefined && !bookingStatuses.includes(body.status)) return fail(response, 400, 'Choose a valid booking status.');
      let mechanicId;
      if (body.mechanicId !== undefined && body.mechanicId !== null) {
        mechanicId = Number(body.mechanicId);
        if (!Number.isInteger(mechanicId) || !database.prepare("SELECT 1 FROM mechanics WHERE id=? AND status='Available'").get(mechanicId)) return fail(response, 400, 'Choose an available mechanic.');
      }
      const result = body.status !== undefined && body.mechanicId !== undefined
        ? database.prepare('UPDATE bookings SET status=?,mechanic_id=? WHERE id=?').run(body.status, mechanicId ?? null, id)
        : body.status !== undefined
          ? database.prepare('UPDATE bookings SET status=? WHERE id=?').run(body.status, id)
          : database.prepare('UPDATE bookings SET mechanic_id=? WHERE id=?').run(mechanicId ?? null, id);
      if (!result.changes) return fail(response, 404, 'Booking not found.');
      sendJson(response, 200, bookingView(database.prepare('SELECT bookings.*,mechanics.name AS mechanic_name FROM bookings LEFT JOIN mechanics ON mechanics.id=bookings.mechanic_id WHERE bookings.id=?').get(id)));
      return;
    }
    if (method === 'PATCH' && pathname.startsWith('/api/admin/roadside-requests/')) {
      const id = decodeURIComponent(pathname.slice('/api/admin/roadside-requests/'.length));
      const body = await readBody(request);
      if (!roadsideStatuses.includes(body.status)) return fail(response, 400, 'Choose a valid roadside request status.');
      const mechanic = body.mechanic === undefined ? null : clean(body.mechanic);
      if (mechanic && !database.prepare('SELECT 1 FROM mechanics WHERE name=?').get(mechanic)) return fail(response, 400, 'Choose a valid mechanic.');
      const result = mechanic === null
        ? database.prepare('UPDATE roadside_requests SET status=? WHERE id=?').run(body.status, id)
        : database.prepare('UPDATE roadside_requests SET status=?,mechanic=? WHERE id=?').run(body.status, mechanic, id);
      if (!result.changes) return fail(response, 404, 'Roadside request not found.');
      sendJson(response, 200, requestView(database.prepare('SELECT * FROM roadside_requests WHERE id=?').get(id)));
      return;
    }
    if (method === 'PATCH' && pathname.startsWith('/api/admin/part-orders/')) {
      const id = decodeURIComponent(pathname.slice('/api/admin/part-orders/'.length));
      const body = await readBody(request);
      if (!['Requested', 'Confirmed', 'Fulfilled', 'Cancelled'].includes(body.status)) return fail(response, 400, 'Choose a valid parts order status.');
      const order = database.prepare('SELECT * FROM part_orders WHERE id=?').get(id);
      if (!order) return fail(response, 404, 'Parts order not found.');
      if (order.status === 'Cancelled' || order.status === 'Fulfilled') return fail(response, 409, `A ${order.status.toLowerCase()} order cannot be changed.`);
      const transitions = { Requested: ['Confirmed', 'Cancelled'], Confirmed: ['Fulfilled', 'Cancelled'] };
      if (body.status !== order.status && !transitions[order.status]?.includes(body.status)) return fail(response, 409, 'That parts order status change is not allowed.');
      database.exec('BEGIN IMMEDIATE');
      try {
        database.prepare('UPDATE part_orders SET status=? WHERE id=?').run(body.status, id);
        if (body.status === 'Cancelled') {
          for (const line of JSON.parse(order.lines)) database.prepare('UPDATE inventory SET qty=qty+? WHERE sku=?').run(line.quantity, line.sku);
        }
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      sendJson(response, 200, database.prepare('SELECT id,name,phone,lines,total,status,created_at AS createdAt FROM part_orders WHERE id=?').get(id));
      return;
    }
    if (method === 'POST' && pathname === '/api/admin/mechanics') {
      const body = await readBody(request);
      const fieldError = requiredFields(body, { name: 2, initials: 2, specialty: 3, description: 10, skills: 2, location: 2 });
      if (fieldError) return fail(response, 400, fieldError);
      const experience = Number(body.experience), rating = Number(body.rating);
      if (!/^[A-Za-z]{2,3}$/.test(body.initials.trim()) || !Number.isInteger(experience) || experience < 0 || experience > 60 || !Number.isFinite(rating) || rating < 0 || rating > 5) return fail(response, 400, 'Enter valid mechanic initials, experience, and a rating from 0 to 5.');
      try {
        const mechanic = database.prepare('INSERT INTO mechanics(name,initials,specialty,description,skills,location,experience,rating,status) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(body.name.trim(), body.initials.trim().toUpperCase(), body.specialty.trim(), body.description.trim(), body.skills.trim(), body.location.trim(), experience, rating, 'Available');
        sendJson(response, 201, database.prepare('SELECT * FROM mechanics WHERE id=?').get(Number(mechanic.lastInsertRowid)));
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return fail(response, 409, 'A mechanic with that name already exists.');
        throw error;
      }
      return;
    }
    if (method === 'PATCH' && pathname.startsWith('/api/admin/mechanics/')) {
      const salaryMatch = pathname.match(/^\/api\/admin\/mechanics\/(\d+)\/salary$/);
      if (salaryMatch) {
        const id = Number(salaryMatch[1]);
        const body = await readBody(request);
        const monthlySalary = Number(body.monthlySalary);
        if (!Number.isSafeInteger(monthlySalary) || monthlySalary < 0 || monthlySalary > 10000000) return fail(response, 400, 'Enter a whole-number monthly salary between ₹0 and ₹10,000,000.');
        if (!database.prepare('SELECT 1 FROM mechanics WHERE id=?').get(id)) return fail(response, 404, 'Mechanic not found.');
        database.prepare('INSERT INTO mechanic_salaries(mechanic_id,monthly_salary) VALUES(?,?) ON CONFLICT(mechanic_id) DO UPDATE SET monthly_salary=excluded.monthly_salary').run(id, monthlySalary);
        sendJson(response, 200, { mechanicId: id, monthlySalary });
        return;
      }
      const id = Number(decodeURIComponent(pathname.slice('/api/admin/mechanics/'.length)));
      const body = await readBody(request);
      if (!Number.isInteger(id) || !['Available', 'Unavailable'].includes(body.status)) return fail(response, 400, 'Choose a valid mechanic and availability status.');
      const result = database.prepare('UPDATE mechanics SET status=? WHERE id=?').run(body.status, id);
      if (!result.changes) return fail(response, 404, 'Mechanic not found.');
      sendJson(response, 200, database.prepare('SELECT * FROM mechanics WHERE id=?').get(id));
      return;
    }
    if (method === 'POST' && pathname === '/api/admin/mechanic-attendance') {
      const body = await readBody(request);
      const mechanicId = Number(body.mechanicId);
      if (!Number.isInteger(mechanicId) || !database.prepare('SELECT 1 FROM mechanics WHERE id=?').get(mechanicId)) return fail(response, 400, 'Choose a valid mechanic.');
      if (!['check-in', 'check-out'].includes(body.action)) return fail(response, 400, 'Choose check-in or check-out.');
      const today = currentIsoDate();
      const timestamp = new Date().toISOString();
      if (body.action === 'check-in') {
        if (database.prepare('SELECT 1 FROM mechanic_attendance WHERE mechanic_id=? AND work_date=?').get(mechanicId, today)) return fail(response, 409, 'This mechanic has already checked in today.');
        try {
          database.prepare('INSERT INTO mechanic_attendance(mechanic_id,work_date,check_in) VALUES(?,?,?)').run(mechanicId, today, timestamp);
        } catch (error) {
          if (database.prepare('SELECT 1 FROM mechanic_attendance WHERE mechanic_id=? AND work_date=?').get(mechanicId, today)) return fail(response, 409, 'This mechanic has already checked in today.');
          throw error;
        }
      } else {
        const result = database.prepare('UPDATE mechanic_attendance SET check_out=? WHERE mechanic_id=? AND work_date=? AND check_out IS NULL').run(timestamp, mechanicId, today);
        if (!result.changes) return fail(response, 409, 'There is no active check-in for this mechanic today.');
      }
      sendJson(response, 200, database.prepare('SELECT mechanic_id AS mechanicId,work_date AS date,check_in AS checkIn,check_out AS checkOut FROM mechanic_attendance WHERE mechanic_id=? AND work_date=?').get(mechanicId, today));
      return;
    }
    if (method === 'POST' && pathname === '/api/admin/inventory') {
      const body = await readBody(request);
      const fieldError = requiredFields(body, { sku: 2, name: 2, brand: 2, category: 3 });
      if (fieldError) return fail(response, 400, fieldError);
      if (!categories.includes(body.category)) return fail(response, 400, 'Choose a valid product category.');
      const qty = Number(body.qty), min = Number(body.min), cost = Number(body.cost), price = Number(body.price);
      if (![qty, min, cost, price].every(Number.isFinite) || !Number.isInteger(qty) || !Number.isInteger(min) || qty < 0 || min < 0 || cost < 0 || price < 0) return fail(response, 400, 'Enter valid stock and price values.');
      try {
        database.prepare('INSERT INTO inventory(sku,name,category,brand,qty,min,cost,price) VALUES(?,?,?,?,?,?,?,?)').run(body.sku.trim().toUpperCase(), body.name.trim(), body.category, body.brand.trim(), qty, min, cost, price);
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return fail(response, 409, 'A part with that SKU already exists.');
        throw error;
      }
      sendJson(response, 201, inventoryView(database.prepare('SELECT * FROM inventory WHERE sku=?').get(body.sku.trim().toUpperCase())));
      return;
    }
    if (method === 'PATCH' && pathname.startsWith('/api/admin/inventory/')) {
      const sku = decodeURIComponent(pathname.slice('/api/admin/inventory/'.length));
      const body = await readBody(request);
      const direction = body.direction;
      const quantity = Number(body.quantity);
      if (!['in', 'out'].includes(direction) || !Number.isInteger(quantity) || quantity < 1) return fail(response, 400, 'Choose stock in/out and a positive whole-number quantity.');
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = direction === 'in'
          ? database.prepare('UPDATE inventory SET qty=qty+? WHERE sku=?').run(quantity, sku)
          : database.prepare('UPDATE inventory SET qty=qty-? WHERE sku=? AND qty>=?').run(quantity, sku, quantity);
        if (!result.changes) {
          database.exec('ROLLBACK');
          return fail(response, 409, 'Part not found or not enough stock.');
        }
        const part = database.prepare('SELECT * FROM inventory WHERE sku=?').get(sku);
        insertTransaction(direction === 'in' ? 'Purchase' : 'Sale', clean(body.party) || (direction === 'in' ? part.brand : 'Workshop use'), `${part.name} · ${quantity} units`, (direction === 'in' ? part.cost : part.price) * quantity);
        database.exec('COMMIT');
        sendJson(response, 200, inventoryView(database.prepare('SELECT * FROM inventory WHERE sku=?').get(sku)));
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      return;
    }
    if (method === 'POST' && pathname === '/api/admin/transactions') {
      const body = await readBody(request);
      const fieldError = requiredFields(body, { party: 2, detail: 2 });
      const amount = Number(body.amount);
      if (fieldError) return fail(response, 400, fieldError);
      if (!['Sale', 'Purchase'].includes(body.type) || !Number.isFinite(amount) || amount <= 0) return fail(response, 400, 'Enter a valid transaction type and positive amount.');
      const id = insertTransaction(body.type, body.party.trim(), body.detail.trim(), amount);
      sendJson(response, 201, database.prepare('SELECT id,type,party,detail,amount,date FROM transactions WHERE id=?').get(id));
      return;
    }
    if (method === 'PATCH' && pathname.startsWith('/api/admin/invoices/')) {
      const id = decodeURIComponent(pathname.slice('/api/admin/invoices/'.length));
      const invoice = database.prepare('SELECT * FROM invoices WHERE id=?').get(id);
      if (!invoice) return fail(response, 404, 'Invoice not found.');
      if (invoice.status !== 'Paid') {
        database.exec('BEGIN IMMEDIATE');
        try {
          database.prepare("UPDATE invoices SET status='Paid' WHERE id=?").run(id);
          insertTransaction('Sale', invoice.customer, `Invoice ${id} payment`, invoice.amount);
          database.exec('COMMIT');
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      }
      sendJson(response, 200, database.prepare('SELECT * FROM invoices WHERE id=?').get(id));
      return;
    }
    if (method === 'POST' && pathname === '/api/admin/offers') {
      const body = await readBody(request);
      const fieldError = requiredFields(body, { tag: 2, title: 2, desc: 2, when: 2, code: 3 });
      if (fieldError) return fail(response, 400, fieldError);
      try {
        database.prepare('INSERT INTO offers(tag,title,description,when_text,code) VALUES(?,?,?,?,?)').run(body.tag.trim(), body.title.trim(), body.desc.trim(), body.when.trim(), body.code.trim().toUpperCase());
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return fail(response, 409, 'An offer with that code already exists.');
        throw error;
      }
      sendJson(response, 201, body);
      return;
    }
    return fail(response, 404, 'Admin API route not found.');
  }
  return fail(response, 404, 'API route not found.');
}

async function handleMongoApi(request, response, url) {
  const writeHead = response.writeHead.bind(response);
  const end = response.end.bind(response);
  let responseHead;
  let responseBody;
  response.writeHead = (...args) => { responseHead = args; return response; };
  response.end = (...args) => { responseBody = args; return response; };
  try {
    await handleApi(request, response, url);
    if (databaseDirty) {
      await mongoStore.persist();
      databaseDirty = false;
    }
    if (responseHead) writeHead(...responseHead);
    end(...(responseBody || []));
  } catch (error) {
    if (response.headersSent || response.destroyed) return;
    const status = error.status || 503;
    const message = error.status ? error.message : 'The database could not save this request. Please try again.';
    writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    end(JSON.stringify({ error: message }));
  }
}

function enqueueMongoApi(request, response, url) {
  const operation = mongoRequestQueue.then(() => handleMongoApi(request, response, url));
  mongoRequestQueue = operation.catch(() => {});
  return operation;
}

const server = http.createServer(async (request, response) => {
  applySecurityHeaders(request, response);
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      if (mongoEnabled) await enqueueMongoApi(request, response, url);
      else await handleApi(request, response, url);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Method not allowed');
      return;
    }
    const decoded = decodeURIComponent(url.pathname);
    const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
    if (!publicFiles.has(relative)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(`${root}${path.sep}`) && filename !== path.join(root, 'index.html')) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }
    const data = await fs.promises.readFile(filename).catch(() => null);
    if (!data) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filename)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch (error) {
    if (response.headersSent || response.destroyed) return;
    console.error(error);
    fail(response, error.status || 500, error.status ? error.message : 'An internal server error occurred.');
  }
});

async function startServer() {
  if (mongoEnabled) {
    mongoClient = new MongoClient(process.env.MONGO_URL);
    await mongoClient.connect();
    const uriDatabase = decodeURIComponent(new URL(process.env.MONGO_URL).pathname.replace(/^\/+/, ''));
    const mongoDb = mongoClient.db(process.env.MONGO_DB_NAME || uriDatabase || 'wrench');
    mongoStore = createMongoStore({ database, mongoDb, mongoClient });
    const storageState = await mongoStore.initialize();
    databaseDirty = false;
    console.log(`MongoDB connected; workshop records ${storageState === 'migrated' ? 'migrated from SQLite' : 'loaded'}.`);
  }
  server.listen(port, host, () => console.log(`Wrench & Co. is running at http://${host}:${port}`));
}

startServer().catch(async error => {
  console.error(`Backend startup failed: ${error.codeName || error.name}. Check MONGO_URL and the MongoDB user permissions.`);
  database.close();
  await mongoClient?.close().catch(() => {});
  process.exitCode = 1;
});
server.on('close', () => {
  database.close();
  void mongoClient?.close();
});
