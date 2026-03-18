'use strict';

// ── Connessione WebSocket ─────────────────────────────────────────
function connectWS() {
  if (!token) return;
  try {
    const p = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${p}//${location.host}?type=web&token=${encodeURIComponent(token)}`);
    ws.onopen = () => { $('pill').classList.add('on'); $('pillLabel').textContent = 'connesso'; };
    ws.onmessage = e => { try { handleMsg(JSON.parse(e.data)); } catch (_) {} };
    ws.onclose = ev => {
      $('pill').classList.remove('on'); $('pillLabel').textContent = 'offline';
      if (ev.code === 4001 || ev.code === 4002) {
        toast('Sessione scaduta, effettua di nuovo il login', 'err');
        doLogout(); return;
      }
      setTimeout(connectWS, 4000);
    };
    ws.onerror = () => { $('pill').classList.remove('on'); $('pillLabel').textContent = 'offline'; };
  } catch (_) { setTimeout(connectWS, 4000); }
}

// ── Gestione messaggi in arrivo ───────────────────────────────────
function handleMsg(msg) {
  switch (msg.type) {
    case 'user_list':
      pcOnline = !!msg.pcConnected;
      onlineUsers    = msg.online     || [];
      registeredUsers = msg.registered || [];
      updateStatusBar();
      updateScanCardState();
      break;
    case 'search_response':
      // Se è una ricerca per giacenza, gestiscila separatamente
      if (pendingGiacenza || (msg.request_id && msg.request_id.startsWith('G-')))
        onGiacenzaSearchResponse(msg);
      else
        onSearchResponse(msg);
      break;
    case 'giacenza_response':      onGiacenzaResponse(msg); break;
    case 'new_order':              onOrderReceived(msg.order); break;
    case 'order_confirm':          toast('✅ Confermata dal PC', 'ok'); break;
    case 'order_queued':           toast(`📬 Comanda accodata per ${msg.destination}`, 'info'); break;
    case 'order_modified_notify':  toast(`✏ Modificata da ${msg.modified_by}`, 'warn'); break;
    case 'error':                  toast('⚠ ' + msg.message, 'err'); break;
  }
}

// ── Stato barra status ────────────────────────────────────────────
function updateStatusBar() {
  $('pcStatusLabel').textContent = pcOnline ? '● PC connesso' : '● PC offline';
  $('pcStatusLabel').style.color = pcOnline ? 'var(--green)' : 'var(--dim)';
  const others = onlineUsers.filter(u => u !== myName);
  $('usersOnlineLabel').textContent = others.length ? '👥 ' + others.join(', ') : '';
}
