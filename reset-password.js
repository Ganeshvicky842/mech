const form=document.querySelector('#reset-password-form');
const message=document.querySelector('#reset-message');
const token=new URLSearchParams(location.search).get('token')||'';
if(!/^[a-f0-9]{64}$/i.test(token)){
  form.hidden=true;
  message.textContent='This password reset link is invalid or expired. Request a new link from the administrator sign-in page.';
  message.classList.add('show');
}
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=form.querySelector('[type="submit"]');
  const password=form.elements.password.value;
  if(password!==form.elements.confirmPassword.value){
    message.textContent='The passwords do not match.';
    message.classList.add('show');
    message.classList.remove('success');
    return;
  }
  button.disabled=true;
  message.classList.remove('show','success');
  try{
    const result=await window.wrenchApi.send('/api/admin/reset-password','POST',{token,password});
    form.hidden=true;
    message.textContent=result.message;
    message.classList.add('show','success');
  }catch(error){
    message.textContent=error.message;
    message.classList.add('show');
  }finally{
    button.disabled=false;
  }
});
