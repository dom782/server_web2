'use strict';

// ── Auth UI ───────────────────────────────────────────────────────
function showAuthTab(tab) {
  $('tabLogin').classList.toggle('active', tab === 'login');
  $('tabRegister').classList.toggle('active', tab === 'register');
  $('loginForm').style.display = tab === 'login' ? '' : 'none';
  $('registerForm').style.display = tab === 'register' ? '' : 'none';
  hideAuthError();
}
function showAuthError(msg) { const e = $('authError'); e.textContent = msg; e.classList.add('show'); }
function hideAuthError()    { $('authError').classList.remove('show'); }

// ── Login ─────────────────────────────────────────────────────────
async function doLogin() {
  const user = $('loginUser').value.trim();
  const pass = $('loginPass').value;
  if (!user || !pass) { showAuthError('Inserisci nome e password'); return; }
  $('loginBtn').disabled = true;
  $('loginSpinner').classList.add('show');
  hideAuthError();
  try {
    const r = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: user, password: pass })
    });
    const d = await r.json();
    if (!r.ok) { showAuthError(d.error || 'Errore login'); return; }
    saveAndStart(d.token, d.userName);
  } catch (e) { showAuthError('Errore di rete'); }
  finally { $('loginBtn').disabled = false; $('loginSpinner').classList.remove('show'); }
}

// ── Registrazione ─────────────────────────────────────────────────
async function doRegister() {
  const user  = $('regUser').value.trim();
  const pass  = $('regPass').value;
  const pass2 = $('regPass2').value;
  if (!user || !pass)  { showAuthError('Compila tutti i campi'); return; }
  if (pass !== pass2)  { showAuthError('Le password non coincidono'); return; }
  if (pass.length < 4) { showAuthError('Password minimo 4 caratteri'); return; }
  $('regBtn').disabled = true;
  $('regSpinner').classList.add('show');
  hideAuthError();
  try {
    const r = await fetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: user, password: pass })
    });
    const d = await r.json();
    if (!r.ok) { showAuthError(d.error || 'Errore registrazione'); return; }
    saveAndStart(d.token, d.userName);
  } catch (e) { showAuthError('Errore di rete'); }
  finally { $('regBtn').disabled = false; $('regSpinner').classList.remove('show'); }
}

// ── Avvia app dopo login/registrazione ───────────────────────────
function saveAndStart(tok, name) {
  token = tok; myName = name;
  localStorage.setItem('scanpc_token', tok);
  localStorage.setItem('scanpc_user', name);
  showApp();
}

function showApp() {
  $('authScreen').style.display = 'none';
  $('appHeader').style.display  = 'flex';
  $('main').classList.add('show');
  $('userChip').textContent = '👤 ' + myName;
  connectWS();
  initPush();
}

// ── Logout ────────────────────────────────────────────────────────
function doLogout() {
  localStorage.removeItem('scanpc_token');
  localStorage.removeItem('scanpc_user');
  token = null; myName = '';
  if (ws) { ws.close(); ws = null; }
  stopScan();
  $('main').classList.remove('show');
  $('appHeader').style.display = 'none';
  $('authScreen').style.display = 'flex';
  $('loginUser').value = ''; $('loginPass').value = '';
  showAuthTab('login');
}

// ── Auto-login ────────────────────────────────────────────────────
async function tryAutoLogin() {
  const tok  = localStorage.getItem('scanpc_token');
  const name = localStorage.getItem('scanpc_user');
  if (!tok || !name) return;
  try {
    const r = await fetch('/auth/verify', { headers: { 'Authorization': 'Bearer ' + tok } });
    if (r.ok) { token = tok; myName = name; showApp(); }
    else { localStorage.removeItem('scanpc_token'); localStorage.removeItem('scanpc_user'); }
  } catch (_) {}
}

// ── Push notifications ────────────────────────────────────────────
async function initPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const res = await fetch('/vapid-public-key');
    const { key } = await res.json();
    if (!key) return;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64(key)
    });
    await fetch('/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ subscription: sub })
    });
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'push_subscribe', subscription: sub }));
  } catch (e) { console.warn('[PUSH]', e.message); }
}
function urlB64(b) {
  const p = '='.repeat((4 - b.length % 4) % 4);
  const r = atob((b + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...r].map(c => c.charCodeAt(0)));
}
