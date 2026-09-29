const emergencyForm = document.querySelector('#emergency-form');
const emergencyStatus = document.querySelector('#emergency-form-status');
const mechanicSelect = document.querySelector('#emergency-mechanic');
const requestedMechanic = new URLSearchParams(window.location.search).get('mechanic');

window.wrenchApi.request('/api/mechanics').then(mechanics => {
  mechanicSelect.replaceChildren(new Option('Match me to the right available mechanic', ''));
  mechanics.forEach(mechanic => mechanicSelect.add(new Option(`${mechanic.name} · ${mechanic.specialty}`, mechanic.name)));
  mechanicSelect.value = mechanics.some(mechanic => mechanic.name === requestedMechanic) ? requestedMechanic : '';
}).catch(error => {
  emergencyStatus.textContent = `The mechanic list could not be refreshed: ${error.message}. You can still submit a request for the next available specialist.`;
  emergencyStatus.hidden = false;
  emergencyStatus.classList.add('error');
});

try {
  const savedCustomer = JSON.parse(localStorage.getItem('wrench_customer') || 'null');
  if (savedCustomer && typeof savedCustomer.name === 'string' && typeof savedCustomer.phone === 'string') {
    emergencyForm.elements.name.value = savedCustomer.name;
    emergencyForm.elements.phone.value = savedCustomer.phone;
  }
} catch {
  emergencyStatus.textContent = 'Your saved customer details could not be read. Please enter them below.';
  emergencyStatus.hidden = false;
  emergencyStatus.classList.add('error');
}

emergencyForm.addEventListener('submit', event => {
  event.preventDefault();
  const request = Object.fromEntries(new FormData(emergencyForm).entries());
  const submit = emergencyForm.querySelector('[type="submit"]');
  submit.disabled = true;
  emergencyStatus.hidden = true;
  window.wrenchApi.send('/api/roadside-requests', 'POST', request).then(saved => {
    emergencyForm.reset();
    emergencyStatus.classList.remove('error');
    emergencyStatus.textContent = `Request ${saved.id} has been sent to our team. Call 1800 555 0123 now to confirm mechanic availability and an arrival estimate.`;
    emergencyStatus.hidden = false;
  }).catch(error => {
    emergencyStatus.textContent = `${error.message} For urgent assistance, call 1800 555 0123.`;
    emergencyStatus.hidden = false;
    emergencyStatus.classList.add('error');
  }).finally(() => {
    submit.disabled = false;
  });
});

document.querySelector('.emergency-page .menu-toggle').addEventListener('click', () => {
  document.querySelector('.emergency-page .main-nav').classList.toggle('open');
});
