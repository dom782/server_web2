'use strict';

// ── Comande ricevute ──────────────────────────────────────────────
function onOrderReceived(order) {
  ordersMap.set(order.order_id, order);
  if (curTab !== 'com') { unreadOrders++; updateBadge(); }
  renderOrders();
  toast(`📦 Nuova comanda da ${order.created_by}`, 'info');
}

function updateBadge() {
  const b = $('comBadge');
  b.textContent = unreadOrders || '';
  b.classList.toggle('show', unreadOrders > 0);
  $('ordersCount').textContent = ordersMap.size;
}

function renderOrders() {
  const c = $('ordersList');
  [...c.children].forEach(el => { if (el.id !== 'emptyOrders') el.remove(); });
  $('emptyOrders').style.display = ordersMap.size ? 'none' : 'flex';
  $('ordersCount').textContent = ordersMap.size;
  [...ordersMap.values()]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .forEach(o => c.appendChild(buildOrderCard(o)));
}

function buildOrderCard(order) {
  const card = document.createElement('div');
  card.className = 'order-card' + (order.status === 'pending' ? ' isnew' : '');
  const ts  = new Date(order.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const stM = { pending: 'in attesa', modified: 'modificata', confirmed: 'confermata' };

  const previewItems = (order.items || []).slice(0, 3).map(it => {
    const um = it.unitaMisura ? ` ${it.unitaMisura}` : '';
    return `<div style="display:flex;gap:8px;align-items:center;padding:3px 0">
      <span style="font-family:var(--mono);font-size:10px;color:var(--blue);font-weight:700;min-width:80px">${esc(it.cod_art)}</span>
      <span style="font-family:var(--mono);font-size:11px;color:var(--text2)">x${fmtQty(it.qty || 1)}${um}</span>
      <span style="font-size:11px;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.descrizione)}</span>
    </div>`;
  }).join('');
  const moreItems = (order.items || []).length > 3
    ? `<div style="font-size:11px;color:var(--dim);font-style:italic">... e altri ${order.items.length - 3} articoli</div>` : '';

  card.innerHTML = `
    <div class="oc-head" style="cursor:pointer" onclick="openOrderPage('${order.order_id}')">
      <div>
        <div class="oc-from">📦 Da: ${esc(order.created_by)}${order.cliente ? ' — ' + esc(order.cliente) : ''}</div>
        <div class="oc-id">${order.order_id} • ${ts}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="oc-status ${order.status}">${stM[order.status] || order.status}</div>
        <span style="font-size:12px;color:var(--dim)">→</span>
      </div>
    </div>
    <div style="padding:10px 14px;display:flex;flex-direction:column;gap:4px">
      ${previewItems}${moreItems}
      ${order.note ? `<div class="oc-note" style="margin-top:4px">📝 ${esc(order.note)}</div>` : ''}
    </div>`;
  return card;
}

// ── Pagina comanda ricevuta ───────────────────────────────────────
let currentOrderId = null;

function openOrderPage(oid) {
  const o = ordersMap.get(oid); if (!o) return;
  currentOrderId = oid;
  $('opFrom').textContent = 'Da: ' + o.created_by + (o.cliente ? ' — Cliente: ' + o.cliente : '');
  $('opId').textContent   = o.order_id + ' • ' + new Date(o.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const body = $('opBody'); body.innerHTML = '';
  if (o.note && o.note.trim()) {
    const n = document.createElement('div'); n.className = 'op-note';
    n.textContent = '📝 ' + o.note; body.appendChild(n);
  }
  (o.items || []).forEach((it, idx) => body.appendChild(buildOpItem(o, it, idx)));
  $('orderPage').classList.add('show');
}

function closeOrderPage() { $('orderPage').classList.remove('show'); currentOrderId = null; }

function buildOpItem(order, it, idx) {
  const box = document.createElement('div'); box.className = 'op-item'; box.dataset.idx = idx;

  const head = document.createElement('div'); head.className = 'op-item-head';
  const cod  = document.createElement('div'); cod.className  = 'op-item-cod';  cod.textContent  = it.cod_art;
  const desc = document.createElement('div'); desc.className = 'op-item-desc'; desc.textContent = it.descrizione;
  head.appendChild(cod); head.appendChild(desc);

  const qtyRow = document.createElement('div'); qtyRow.className = 'op-qty-row';
  const btnM   = document.createElement('button'); btnM.className = 'op-qty-btn'; btnM.textContent = '−';
  const inp    = document.createElement('input');  inp.className  = 'op-qty-input'; inp.type = 'text'; inp.inputMode = 'decimal';
  inp.value    = fmtQty(it.qty || 1);
  const btnP   = document.createElement('button'); btnP.className = 'op-qty-btn'; btnP.textContent = '+';

  const umSel  = document.createElement('select'); umSel.className = 'op-um-select';
  const umList = it.unita_misura_list || it.umList || [];
  if (umList.length) {
    umList.forEach(um => {
      const opt = document.createElement('option'); opt.value = um; opt.textContent = um;
      if (um === it.unitaMisura) opt.selected = true;
      umSel.appendChild(opt);
    });
  } else {
    const opt = document.createElement('option'); opt.value = it.unitaMisura || ''; opt.textContent = it.unitaMisura || '—';
    umSel.appendChild(opt);
  }

  const convLabel = document.createElement('div'); convLabel.className = 'op-conversion';
  const updateConv = () => { convLabel.textContent = umSel.value ? 'UM: ' + umSel.value : ''; };

  const applyInp = () => {
    const v = parseOpQty(inp.value);
    if (v >= 0) { it.qty = v; if (v > 0) it.step = v; inp.value = fmtQty(v); updateConv(); }
    else inp.value = fmtQty(it.qty || 1);
  };

  btnM.addEventListener('click', () => { it.qty = round(Math.max(0, (it.qty||1) - (it.step||1))); inp.value = fmtQty(it.qty); updateConv(); });
  btnP.addEventListener('click', () => { it.qty = round((it.qty||1) + (it.step||1)); inp.value = fmtQty(it.qty); updateConv(); });
  inp.addEventListener('change', applyInp);
  inp.addEventListener('blur',   applyInp);
  umSel.addEventListener('change', () => { it.unitaMisura = umSel.value; updateConv(); });
  if (umList.length) { it.unita_misura_list = umList; it.umList = umList; }

  qtyRow.appendChild(btnM); qtyRow.appendChild(inp); qtyRow.appendChild(btnP); qtyRow.appendChild(umSel);
  updateConv();

  box.appendChild(head); box.appendChild(qtyRow); box.appendChild(convLabel);
  if (it.nota && it.nota.trim()) {
    const n = document.createElement('div'); n.className = 'op-item-nota'; n.textContent = '📝 ' + it.nota;
    box.appendChild(n);
  }
  return box;
}

function parseOpQty(s) {
  const v = parseFloat(String(s).replace(',', '.'));
  return isNaN(v) ? 0 : Math.round(v * 1e10) / 1e10;
}

// ── Reinoltra al PC ───────────────────────────────────────────────
function opReinoltra() {
  const o = ordersMap.get(currentOrderId); if (!o) return;
  if (!ws || ws.readyState !== 1) { toast('⚠ Non connesso', 'warn'); return; }

  const itemBoxes = [...$('opBody').querySelectorAll('.op-item')];
  const items = (o.items || []).map((it, i) => {
    const box = itemBoxes[i];
    const inp = box ? box.querySelector('.op-qty-input') : null;
    const sel = box ? box.querySelector('.op-um-select')  : null;
    return {
      cod_art:             it.cod_art              || '',
      descrizione:         it.descrizione          || '',
      qty:                 inp ? (parseOpQty(inp.value) || it.qty || 1) : (it.qty || 1),
      unitaMisura:         sel ? (sel.value || it.unitaMisura || '') : (it.unitaMisura || ''),
      nota:                it.nota                 || '',
      um_base:             it.um_base              || '',
      unita_misura_list:   it.unita_misura_list    || it.umList || [],
      fattori_conversione: it.fattori_conversione  || {}
    };
  });

  ws.send(JSON.stringify({ type: 'order_update', order: {
    order_id:    o.order_id,
    created_by:  o.created_by,
    destination: o.destination || 'PC',
    status:      'modified',
    modified_by: myName,
    note:        o.note     || '',
    cliente:     o.cliente  || '',
    timestamp:   o.timestamp || new Date().toISOString(),
    items
  }}));
  toast('↩ Reinoltrata al PC', 'ok');
  closeOrderPage();
}

function opOk() {
  if (!currentOrderId) return;
  ordersMap.delete(currentOrderId); renderOrders();
  toast('✓ Rimossa', 'ok'); closeOrderPage();
}

// ── Aggiungi articolo a comanda ricevuta ──────────────────────────
let opAddMode = false;

function opAddArticolo() {
  if (!pcOnline) { toast('⚠ PC non connesso', 'warn'); return; }
  if (!ws || ws.readyState !== 1) { toast('⚠ Non connesso', 'warn'); return; }
  opAddMode = true;
  spMode = 'cod_art';
  $('spTitle').textContent   = 'Aggiungi articolo alla comanda';
  $('spBtnCod').className    = 'sp-btn active';
  $('spBtnDesc').className   = 'sp-btn';
  $('spInput').value         = ''; $('spInput').placeholder = 'Codice articolo…';
  $('spCount').textContent   = ''; $('spStatusTxt').textContent = 'Cerca articolo da aggiungere';
  $('spSpinner').classList.remove('show');
  $('spResults').innerHTML   = '<div class="sp-ph"><div class="pi">🔍</div><p>Cerca un articolo da aggiungere.</p></div>';
  $('searchPage').classList.add('show');
  setTimeout(() => $('spInput').focus(), 200);
}
