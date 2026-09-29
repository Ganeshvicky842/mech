const customerForm = document.querySelector('#customer-login-form');
const customerError = document.querySelector('#customer-login-error');

customerForm?.addEventListener('submit', async event => {
  event.preventDefault();
  event.stopImmediatePropagation();

  const form = new FormData(customerForm);
  const name = String(form.get('name') || '').trim();
  const phone = String(form.get('phone') || '').trim();
  const button = customerForm.querySelector('[type="submit"]');

  if (name.length < 2 || phone.replace(/\D/g, '').length < 8) {
    customerError.textContent = 'Please enter a valid name and mobile number.';
    customerError.classList.add('show');
    return;
  }

  button.disabled = true;
  customerError.classList.remove('show');
  try {
    const customer = await window.wrenchApi.send('/api/customer/login', 'POST', { name, phone });
    localStorage.setItem('wrench_customer', JSON.stringify({ name: customer.name, phone: customer.phone }));
    document.querySelector('#booking-form [name="name"]').value = customer.name;
    document.querySelector('#booking-form [name="phone"]').value = customer.phone;
    document.querySelectorAll('.customer-open').forEach(trigger => {
      trigger.textContent = `Hi, ${customer.name.split(/\s+/)[0]}`;
    });
    document.querySelector('#customer-modal').classList.remove('is-open');
    document.querySelector('#customer-modal').setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    document.querySelector('#booking').scrollIntoView({ behavior: 'smooth' });
    document.querySelector('#booking-form [name="name"]').focus({ preventScroll: true });
    document.querySelector('#toast').textContent = 'Your profile was saved for this device.';
    document.querySelector('#toast').classList.add('show');
  } catch (error) {
    customerError.textContent = error.message;
    customerError.classList.add('show');
  } finally {
    button.disabled = false;
  }
}, true);
