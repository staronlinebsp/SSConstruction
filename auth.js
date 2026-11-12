(function () {
  const form = document.getElementById('loginForm');
  const message = document.getElementById('message');
  const conf = window.SS_CONFIG || {};
  function invalidConfig() {
    return !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(conf.supabaseUrl || '') || !String(conf.supabaseKey || '').startsWith('sb_publishable_');
  }
  if (invalidConfig() || !window.supabase) {
    message.textContent = 'Setup required: add your Supabase project URL and public key to config.js.';
    form.querySelector('button').disabled = true;
    return;
  }
  const client = window.supabase.createClient(conf.supabaseUrl, conf.supabaseKey);
  form.addEventListener('submit', async function (e) {
    e.preventDefault(); const btn = form.querySelector('button'); btn.disabled = true; message.textContent = '';
    try {
      const {error} = await client.auth.signInWithPassword({email:document.getElementById('username').value.trim(), password:document.getElementById('password').value});
      if (error) { message.textContent = 'Could not sign in. Check your email and password.'; return; }
      location.href = 'app.html#dashboard';
    } catch (_) { message.textContent = 'Could not connect. Please try again.'; }
    finally { btn.disabled = false; }
  });
})();
