'use strict';

const express  = require('express');
const { WebSocketServer } = require('ws');
const http     = require('http');
const path     = require('path');
const fs       = require('fs');
const webpush  = require('web-push');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── VAPID ─────────────────────────────────────────────────────────
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE;
const VAPID_EMAIL   = process.env.VAPID_EMAIL || 'mailto:admin@scanpc.local';
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}
app.get('/vapid-public-key', (req, res) => res.json({ key: VAPID_PUBLIC || '' }));

// ── PERSISTENZA SU FILE ───────────────────────────────────────────
const DATA_DIR   = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJSON(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// registeredUsers: { userName → { pushSubscription, registeredAt } }
let registeredUsers = loadJSON(USERS_FILE, {});
// orderQueue: { userName → [ ...orders ] }
let orderQueue      = loadJSON(QUEUE_FILE, {});

// ── STATO CONNESSIONI ─────────────────────────────────────────────
let   pcClient      = null;
const webClients    = new Map();
const pendingSearch = new Map();

// ── HELPERS ───────────────────────────────────────────────────────
function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcastUserList() {
  const online     = [...webClients.keys()];
  const registered = Object.keys(registeredUsers);
  const msg = { type: 'user_list', online, registered, pcConnected: pcClient !== null };
  wss.clients.forEach(ws => { if (ws.readyState === 1) send(ws, msg); });
}

async function pushNotify(userName, title, body) {
  const user = registeredUsers[userName];
  if (!user || !user.pushSubscription || !VAPID_PUBLIC || !VAPID_PRIVATE) return;
  try {
    await webpush.sendNotification(user.pushSubscription, JSON.stringify({ title, body }));
  } catch (e) {
    console.warn(`[PUSH] Errore ${userName}:`, e.message);
    if (e.statusCode === 410) {
      delete registeredUsers[userName].pushSubscription;
      saveJSON(USERS_FILE, registeredUsers);
    }
  }
}

async function flushQueue(userName) {
  const queue = orderQueue[userName];
  if (!queue || queue.length === 0) return;
  const ws = webClients.get(userName);
  console.log(`[QUEUE] Consegna ${queue.length} comande a ${userName}`);
  for (const order of queue) {
    send(ws, { type: 'new_order', order });
    await pushNotify(userName, '📦 Comanda in attesa', `Da: ${order.created_by}`);
  }
  delete orderQueue[userName];
  saveJSON(QUEUE_FILE, orderQueue);
}

// ── REST: registrazione + lista utenti ───────────────────────────
app.post('/register', (req, res) => {
  const { userName, pushSubscription } = req.body;
  if (!userName) return res.status(400).json({ error: 'userName richiesto' });
  registeredUsers[userName] = {
    pushSubscription: pushSubscription || null,
    registeredAt: new Date().toISOString()
  };
  saveJSON(USERS_FILE, registeredUsers);
  console.log(`[REG] Registrato: ${userName}`);
  res.json({ ok: true });
});

app.get('/registered-users', (req, res) => {
  res.json({ users: Object.keys(registeredUsers) });
});

app.delete('/registered-users/:name', (req, res) => {
  delete registeredUsers[req.params.name];
  delete orderQueue[req.params.name];
  saveJSON(USERS_FILE, registeredUsers);
  saveJSON(QUEUE_FILE, orderQueue);
  broadcastUserList();
  res.json({ ok: true });
});

// ── WEBSOCKET ─────────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  const params     = new URL(req.url, 'http://localhost').searchParams;
  const clientType = params.get('type') || 'web';
  const userName   = params.get('name') || 'Utente';

  ws.clientType = clientType;
  ws.userName   = userName;
  console.log(`[+] ${clientType}: ${userName}`);

  if (clientType === 'pc') {
    if (pcClient) pcClient.close();
    pcClient = ws;
  } else {
    if (webClients.has(userName)) {
      try { webClients.get(userName).close(); } catch (_) {}
    }
    webClients.set(userName, ws);
    if (!registeredUsers[userName]) {
      registeredUsers[userName] = { pushSubscription: null, registeredAt: new Date().toISOString() };
      saveJSON(USERS_FILE, registeredUsers);
    }
    setTimeout(() => flushQueue(userName), 600);
  }

  broadcastUserList();

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const t = msg.type;

    if (t === 'push_subscribe') {
      if (registeredUsers[userName]) {
        registeredUsers[userName].pushSubscription = msg.subscription;
        saveJSON(USERS_FILE, registeredUsers);
      }
      return;
    }

    if (t === 'scan_batch') {
      if (pcClient) { send(pcClient, msg); send(ws, { type: 'batch_ack', count: msg.total }); }
      else send(ws, { type: 'error', message: 'PC non connesso' });
      return;
    }

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

    if (t === 'search_response' && clientType === 'pc') {
      const rid = msg.request_id;
      if (rid && pendingSearch.has(rid)) {
        send(pendingSearch.get(rid), msg);
        pendingSearch.delete(rid);
      }
      return;
    }

    if (t === 'new_order') {
      const dest  = msg.order.destination;
      const order = msg.order;
      console.log(`[ORDER] ${order.order_id} → ${dest}`);

      if (dest === 'PC' || dest === 'pc') {
        if (pcClient) send(pcClient, msg);
        return;
      }

      const destWs = webClients.get(dest);
      if (destWs) {
        send(destWs, msg);
        pushNotify(dest, '📦 Nuova comanda', `Da: ${order.created_by}`);
      } else {
        if (!orderQueue[dest]) orderQueue[dest] = [];
        orderQueue[dest].push(order);
        saveJSON(QUEUE_FILE, orderQueue);
        console.log(`[QUEUE] Accodata per ${dest}`);
        send(ws, { type: 'order_queued', destination: dest, order_id: order.order_id });
        // Prova push anche se offline
        pushNotify(dest, '📦 Nuova comanda (in attesa)', `Da: ${order.created_by}`);
      }
      return;
    }

    if (t === 'order_update') {
      if (pcClient) send(pcClient, msg);
      const orig = msg.order.created_by;
      if (orig && orig !== userName && webClients.has(orig))
        send(webClients.get(orig), { type: 'order_modified_notify',
          order_id: msg.order.order_id, modified_by: userName });
      return;
    }

    if (t === 'order_confirm' && clientType === 'pc') {
      const destWs = webClients.get(msg.destination);
      if (destWs) send(destWs, msg);
      return;
    }

    if (clientType === 'pc') {
      webClients.forEach(w => send(w, msg));
    }
  });

  ws.on('close', () => {
    console.log(`[-] ${clientType}: ${userName}`);
    if (clientType === 'pc') pcClient = null;
    else if (webClients.get(userName) === ws) webClients.delete(userName);
    broadcastUserList();
  });

  ws.on('error', err => console.error(`WS error (${userName}):`, err.message));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`ScanPC v2 porta ${PORT}`));
