'use strict';

const express   = require('express');
const { WebSocketServer } = require('ws');
const http      = require('http');
const path      = require('path');
const webpush   = require('web-push');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── VAPID (genera con: npx web-push generate-vapid-keys) ─────────
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC  || 'SOSTITUISCI_CON_TUA_CHIAVE_PUBBLICA';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || 'SOSTITUISCI_CON_TUA_CHIAVE_PRIVATA';
const VAPID_EMAIL   = process.env.VAPID_EMAIL   || 'mailto:admin@scanpc.local';

if (VAPID_PUBLIC !== 'SOSTITUISCI_CON_TUA_CHIAVE_PUBBLICA') {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}

// Espone la chiave pubblica VAPID al client
app.get('/vapid-public-key', (req, res) => {
  res.json({ key: VAPID_PUBLIC });
});

// Registrazione subscription push
const pushSubscriptions = new Map(); // userName → subscription
app.post('/push-subscribe', (req, res) => {
  const { userName, subscription } = req.body;
  if (userName && subscription) {
    pushSubscriptions.set(userName, subscription);
    console.log(`[PUSH] Subscription registrata per: ${userName}`);
  }
  res.json({ ok: true });
});

// ── STATO CONNESSIONI ─────────────────────────────────────────────
let   pcClient     = null;                 // unico client PC Java
const webClients   = new Map();            // userName → ws
const pendingSearch = new Map();           // request_id → ws

// ── HELPERS ───────────────────────────────────────────────────────
function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcastUserList() {
  const users = [...webClients.keys()];
  const msg = { type: 'user_list', users, pcConnected: pcClient !== null };
  wss.clients.forEach(ws => { if (ws.readyState === 1) send(ws, msg); });
}

async function pushNotify(userName, title, body) {
  const sub = pushSubscriptions.get(userName);
  if (!sub || VAPID_PUBLIC === 'SOSTITUISCI_CON_TUA_CHIAVE_PUBBLICA') return;
  try {
    await webpush.sendNotification(sub, JSON.stringify({ title, body }));
  } catch(e) {
    console.warn(`[PUSH] Errore per ${userName}:`, e.message);
    if (e.statusCode === 410) pushSubscriptions.delete(userName);
  }
}

// ── WEBSOCKET ─────────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  const params    = new URL(req.url, 'http://localhost').searchParams;
  const clientType = params.get('type') || 'web';
  const userName   = params.get('name') || 'Utente';

  ws.clientType = clientType;
  ws.userName   = userName;

  console.log(`[+] ${clientType} connesso: ${userName}`);

  if (clientType === 'pc') {
    if (pcClient) pcClient.close();
    pcClient = ws;
  } else {
    // Disconnetti eventuale vecchia sessione con stesso nome
    if (webClients.has(userName)) {
      try { webClients.get(userName).close(); } catch(_) {}
    }
    webClients.set(userName, ws);
  }

  broadcastUserList();

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    const t = msg.type;

    // ── Scanner: raccolta codici (legacy) ────────────────────────
    if (t === 'scan_batch') {
      if (pcClient) {
        send(pcClient, msg);
        send(ws, { type: 'batch_ack', count: msg.total });
      } else {
        send(ws, { type: 'error', message: 'PC non connesso' });
      }
      return;
    }

    // ── Ricerca articoli: web → PC ───────────────────────────────
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

    // ── Risposta ricerca: PC → scanner corretto ──────────────────
    if (t === 'search_response' && clientType === 'pc') {
      const rid = msg.request_id;
      if (rid && pendingSearch.has(rid)) {
        send(pendingSearch.get(rid), msg);
        pendingSearch.delete(rid);
      }
      return;
    }

    // ── Nuova comanda (PC o web) → destinatario ──────────────────
    if (t === 'new_order') {
      const dest = msg.order.destination;
      console.log(`[ORDER] Nuova comanda ${msg.order.order_id} → ${dest}`);

      if (dest === 'PC' || dest === 'pc') {
        send(pcClient, msg);
      } else {
        const destWs = webClients.get(dest);
        if (destWs) {
          send(destWs, msg);
          pushNotify(dest, '📦 Nuova comanda', `Da: ${msg.order.created_by}`);
        } else {
          send(ws, { type: 'error', message: `Utente "${dest}" non connesso` });
        }
      }
      return;
    }

    // ── Modifica comanda: web → PC ───────────────────────────────
    if (t === 'order_update') {
      console.log(`[ORDER] Modifica comanda ${msg.order.order_id} da ${userName}`);
      send(pcClient, msg);
      // Notifica anche al mittente originale se diverso
      const orig = msg.order.created_by;
      if (orig && orig !== userName && webClients.has(orig)) {
        send(webClients.get(orig), { type: 'order_modified_notify',
          order_id: msg.order.order_id, modified_by: userName });
      }
      return;
    }

    // ── Conferma comanda: PC → web ───────────────────────────────
    if (t === 'order_confirm' && clientType === 'pc') {
      const dest = msg.destination;
      const destWs = webClients.get(dest);
      if (destWs) {
        send(destWs, msg);
      }
      return;
    }

    // ── Broadcast PC → tutti i web ───────────────────────────────
    if (clientType === 'pc') {
      webClients.forEach(w => send(w, msg));
    }
  });

  ws.on('close', () => {
    console.log(`[-] ${clientType} disconnesso: ${userName}`);
    if (clientType === 'pc') {
      pcClient = null;
    } else {
      if (webClients.get(userName) === ws) webClients.delete(userName);
    }
    broadcastUserList();
  });

  ws.on('error', err => console.error(`WS error (${userName}):`, err.message));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`ScanPC v2 server porta ${PORT}`));
