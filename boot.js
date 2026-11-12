(async function () {
  const notice = document.getElementById('bootNotice');
  const conf = window.SS_CONFIG || {};
  function show(text) {
    notice.replaceChildren();
    const p=document.createElement('p'); p.textContent=text; notice.appendChild(p);
    const a=document.createElement('a'); a.href='index.html'; a.textContent='Return to sign in'; notice.appendChild(a);
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(conf.supabaseUrl || '') || !String(conf.supabaseKey || '').startsWith('sb_publishable_') || !window.supabase) {
    show('Setup required: add your Supabase project URL and public key to config.js.'); return;
  }
  try {
    const client = window.supabase.createClient(conf.supabaseUrl, conf.supabaseKey);
    window.ssClient = client;
    const {data: userData, error: userError} = await client.auth.getUser();
    if (userError || !userData.user) { location.replace('index.html'); return; }
    const user = userData.user;
    const profileResult = await client.from('workspace_profiles').select('role').eq('user_id', user.id).maybeSingle();
    if (profileResult.error) { show('Could not check workspace access. Check your connection and Supabase setup.'); return; }
    if (!profileResult.data) { await client.auth.signOut(); show('This account is not approved for the workspace. Ask the administrator to grant access.'); return; }
    const {data: rows, error: dataError} = await client.from('workspace_data').select('key,value,revision');
    if (dataError) { show('Could not load workspace data. Check your connection and Supabase setup.'); return; }
    const data={}, revisions={};
    for (const row of rows) { data[row.key]=row.value; revisions[row.key]=row.revision; }
    window.__BOOT__={data, revisions, user:{username:user.email || 'User',role:profileResult.data.role}};
    const script=document.createElement('script'); script.src='app.js';
    script.onload=() => { document.documentElement.classList.remove('boot-wait'); notice.remove(); };
    script.onerror=() => show('Could not load the workspace application.');
    document.body.appendChild(script);
  } catch (_) { show('Could not connect to the workspace. Check your connection and Supabase configuration.'); }
})();
