'use strict';

const express   = require('express');
const { WebSocketServer } = require('ws');
const http      = require('http');
const path      = require('path');
const fs        = require('fs');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const webpush   = require('web-push');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── SEGRETI ────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'scanpc-dev-secret-change-me';
const JWT_EXPIRY = '30d';

// ── VAPID ──────────────────────────────────────────────────────────
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE;
const VAPID_EMAIL   = process.env.VAPID_EMAIL || 'mailto:admin@scanpc.local';
if (VAPID_PUBLIC && VAPID_PRIVATE)
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

app.get('/vapid-public-key', (req, res) => res.json({ key: VAPID_PUBLIC || '' }));

// ── PERSISTENZA ────────────────────────────────────────────────────
const DATA_DIR    = path.join(__dirname, 'data');
const USERS_FILE  = path.join(DATA_DIR, 'users.json');   // { userName: { passwordHash, pushSub, registeredAt } }
const QUEUE_FILE  = path.join(DATA_DIR, 'queue.json');   // { userName: [ ...orders ] }

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJSON(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

let users      = loadJSON(USERS_FILE, {});  // { userName: { passwordHash, pushSub, registeredAt } }
let orderQueue = loadJSON(QUEUE_FILE, {});  // { userName: [ order, ... ] }

// ── STATO WS ───────────────────────────────────────────────────────
let   pcClient     = null;
const webClients   = new Map();   // userName → ws
const pendingSearch = new Map();  // request_id → ws

// ── HELPERS ────────────────────────────────────────────────────────
function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcastUserList() {
  const online     = [...webClients.keys()];
  const registered = Object.keys(users);
  const msg = { type: 'user_list', online, registered, pcConnected: pcClient !== null };
  wss.clients.forEach(ws => send(ws, msg));
}

async function pushNotify(userName, title, body) {
  const u = users[userName];
  if (!u?.pushSub || !VAPID_PUBLIC || !VAPID_PRIVATE) return;
  try {
    await webpush.sendNotification(u.pushSub, JSON.stringify({ title, body }));
  } catch (e) {
    if (e.statusCode === 410) { delete users[userName].pushSub; saveJSON(USERS_FILE, users); }
  }
}

async function flushQueue(userName) {
  const queue = orderQueue[userName];
  if (!queue?.length) return;
  const ws = webClients.get(userName);
  console.log(`[QUEUE] Consegna ${queue.length} comande a ${userName}`);
  for (const order of queue) {
    send(ws, { type: 'new_order', order });
    await pushNotify(userName, '📦 Comanda in attesa', `Da: ${order.created_by}`);
  }
  delete orderQueue[userName];
  saveJSON(QUEUE_FILE, orderQueue);
}

// ── MIDDLEWARE AUTH ────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token mancante' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token non valido o scaduto' });
  }
}

// ══════════════════════════════════════════════════════════════════
//  REST API
// ══════════════════════════════════════════════════════════════════

// Registrazione
app.post('/auth/register', async (req, res) => {
  const { userName, password } = req.body;
  if (!userName || !password)
    return res.status(400).json({ error: 'userName e password richiesti' });
  if (userName.length < 2 || userName.length > 32)
    return res.status(400).json({ error: 'Nome: 2-32 caratteri' });
  if (password.length < 4)
    return res.status(400).json({ error: 'Password: minimo 4 caratteri' });
  if (users[userName])
    return res.status(409).json({ error: 'Utente già esistente' });

  const passwordHash = await bcrypt.hash(password, 10);
  users[userName] = { passwordHash, pushSub: null, registeredAt: new Date().toISOString() };
  saveJSON(USERS_FILE, users);
  console.log(`[REG] Nuovo utente: ${userName}`);
  const token = jwt.sign({ userName }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  res.json({ ok: true, token, userName });
  broadcastUserList();
});

// Login
app.post('/auth/login', async (req, res) => {
  const { userName, password } = req.body;
  if (!userName || !password)
    return res.status(400).json({ error: 'userName e password richiesti' });
  const u = users[userName];
  if (!u) return res.status(401).json({ error: 'Utente non trovato' });
  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Password errata' });
  const token = jwt.sign({ userName }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  console.log(`[LOGIN] ${userName}`);
  res.json({ ok: true, token, userName });
});

// Verifica token (per auto-login all'avvio)
app.get('/auth/verify', authMiddleware, (req, res) => {
  res.json({ ok: true, userName: req.user.userName });
});



// Aggiorna push subscription (richiede auth)
app.post('/push-subscribe', authMiddleware, (req, res) => {
  const { subscription } = req.body;
  const { userName } = req.user;
  if (users[userName]) {
    users[userName].pushSub = subscription;
    saveJSON(USERS_FILE, users);
  }
  res.json({ ok: true });
});

// Elimina utente (solo admin, futuro)

// Lista utenti registrati — accessibile con JWT utente OPPURE con PC_TOKEN (client Java)
app.get('/registered-users', (req, res) => {
  const pcToken = process.env.PC_TOKEN || 'scanpc-pc-client';
  const auth    = (req.headers['authorization'] || '').replace('Bearer ', '');
  let allowed   = false;
  if (auth === pcToken) { allowed = true; }
  else { try { jwt.verify(auth, JWT_SECRET); allowed = true; } catch (_) {} }
  if (!allowed) return res.status(401).json({ error: 'Non autorizzato' });
  res.json({ users: Object.keys(users) });
});

app.delete('/auth/user/:name', authMiddleware, (req, res) => {
  const { name } = req.params;
  if (req.user.userName !== name && req.user.userName !== 'admin')
    return res.status(403).json({ error: 'Non autorizzato' });
  delete users[name];
  delete orderQueue[name];
  saveJSON(USERS_FILE, users);
  saveJSON(QUEUE_FILE, orderQueue);
  broadcastUserList();
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════════
//  WEBSOCKET
// ══════════════════════════════════════════════════════════════════
wss.on('connection', (ws, req) => {
  const params     = new URL(req.url, 'http://localhost').searchParams;
  const clientType = params.get('type') || 'web';
  const token      = params.get('token') || '';
  const pcSecret   = params.get('secret') || '';

  // Autenticazione
  if (clientType === 'pc') {
    // PC si autentica con JWT_SECRET (token speciale per client PC)
    const pcToken = process.env.PC_TOKEN || 'scanpc-pc-client';
    if (pcSecret !== pcToken) {
      console.warn('[WS] PC rifiutato: token errato');
      ws.close(4001, 'Unauthorized');
      return;
    }
    ws.userName   = params.get('name') || 'PC';
    ws.clientType = 'pc';
    if (pcClient) pcClient.close();
    pcClient = ws;
    console.log(`[+] PC connesso: ${ws.userName}`);
    // Invia subito user_list al PC con gli utenti web gia connessi
    const onlineNow = [...webClients.keys()];
    const regNow    = Object.keys(users);
    send(ws, { type: 'user_list', online: onlineNow, registered: regNow, pcConnected: true });
  } else {
    // Client web: verifica JWT
    let userName = null;
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      userName = decoded.userName;
    } catch {
      console.warn('[WS] Web client rifiutato: token non valido');
      ws.close(4001, 'Unauthorized');
      return;
    }
    if (!users[userName]) {
      ws.close(4002, 'User not found');
      return;
    }
    ws.userName   = userName;
    ws.clientType = 'web';
    if (webClients.has(userName)) {
      try { webClients.get(userName).close(); } catch (_) {}
    }
    webClients.set(userName, ws);
    console.log(`[+] Web: ${userName}`);
    setTimeout(() => flushQueue(userName), 600);
  }

  broadcastUserList();

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const t = msg.type;

    // Aggiorna push subscription via WS
    if (t === 'push_subscribe' && ws.clientType === 'web') {
      if (users[ws.userName]) {
        users[ws.userName].pushSub = msg.subscription;
        saveJSON(USERS_FILE, users);
      }
      return;
    }

    // PC richiede lista utenti online
    if (t === 'get_user_list') {
      const online     = [...webClients.keys()];
      const registered = Object.keys(users);
      send(ws, { type: 'user_list', online, registered, pcConnected: true });
      return;
    }

    // Scan batch: web → PC
    if (t === 'scan_batch') {
      if (pcClient) { send(pcClient, msg); send(ws, { type: 'batch_ack', count: msg.total }); }
      else send(ws, { type: 'error', message: 'PC non connesso' });
      return;
    }

    // Ricerca: web → PC
    if (t === 'search_request') {
      if (!pcClient) {
        send(ws, { type: 'search_response', request_id: msg.request_id,
          error: 'PC non connesso', results: [], found: 0 });
        return;
      }
      if (msg.request_id) {
        pendingSearch.set(msg.request_id, ws);
        setTimeout(() => pendingSearch.delete(msg.request_id), 30000);
      }
      send(pcClient, msg);
      return;
    }

    // Risposta ricerca: PC → web richiedente
    if (t === 'search_response' && ws.clientType === 'pc') {
      const rid = msg.request_id;
      if (rid && pendingSearch.has(rid)) {
        send(pendingSearch.get(rid), msg);
        pendingSearch.delete(rid);
      }
      return;
    }

    // Nuova comanda
    if (t === 'new_order') {
      const { destination: dest, ..._ } = msg.order;
      const order = msg.order;
      console.log(`[ORDER] ${order.order_id}: ${order.created_by} → ${dest}`);

      if (dest === 'PC' || dest === 'pc') {
        if (pcClient) send(pcClient, msg);
        else console.warn('[ORDER] PC offline — comanda persa');
        return;
      }

      // Verifica che il destinatario esista
      if (!users[dest]) {
        send(ws, { type: 'error', message: `Utente "${dest}" non trovato` });
        return;
      }

      const destWs = webClients.get(dest);
      if (destWs) {
        // Online → consegna immediata
        send(destWs, msg);
        pushNotify(dest, '📦 Nuova comanda', `Da: ${order.created_by}`);
      } else {
        // Offline → accoda (persiste su file)
        if (!orderQueue[dest]) orderQueue[dest] = [];
        orderQueue[dest].push(order);
        saveJSON(QUEUE_FILE, orderQueue);
        console.log(`[QUEUE] Accodata per ${dest} (offline)`);
        send(ws, { type: 'order_queued', destination: dest, order_id: order.order_id });
        // Prova push anche se offline (browser può riceverla)
        pushNotify(dest, '📦 Nuova comanda in attesa', `Da: ${order.created_by} — apri ScanPC`);
      }
      return;
    }

    // Modifica comanda: web → PC
    if (t === 'order_update') {
      if (pcClient) send(pcClient, msg);
      const orig = msg.order?.created_by;
      if (orig && orig !== ws.userName && webClients.has(orig))
        send(webClients.get(orig), { type: 'order_modified_notify',
          order_id: msg.order.order_id, modified_by: ws.userName });
      return;
    }

    // Conferma comanda: PC → web destinatario
    if (t === 'order_confirm' && ws.clientType === 'pc') {
      const destWs = webClients.get(msg.destination);
      if (destWs) send(destWs, msg);
      return;
    }

    // Broadcast PC → tutti web
    if (ws.clientType === 'pc') {
      webClients.forEach(w => send(w, msg));
    }
  });

  ws.on('close', () => {
    console.log(`[-] ${ws.clientType}: ${ws.userName}`);
    if (ws.clientType === 'pc') pcClient = null;
    else if (webClients.get(ws.userName) === ws) webClients.delete(ws.userName);
    broadcastUserList();
  });

  ws.on('error', err => console.error(`WS error (${ws.userName}):`, err.message));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`ScanPC v3 porta ${PORT}`));
