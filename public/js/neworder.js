'use strict';

// ── Carrello ──────────────────────────────────────────────────────
function addToCart(cod, desc, umList, umBase, fattori) {
  const ex = cart.find(c => c.cod_art === cod);
  if (ex) { ex.qty = round(ex.qty + ex.step); renderCart(); return; }
  const ul = umList || [];
  const um = ul.length ? ul[0] : '';
  cart.push({
    cod_art:             cod,
    descrizione:         desc,
    qty:                 1,
    step:                1,
    unitaMisura:         um,
    nota:                '',
    unita_misura_list:   ul,
    um_base:             umBase || um,
    fattori_conversione: fattori || {}
  });
  renderCart();
}

function renderCart() {
  const c = $('cartItems');
  c.innerHTML = '';
  $('cartN').textContent = cart.length;
  $('btnSendOrder').disabled = !cart.length;
  if (!cart.length) { c.innerHTML = '<div class="cart-ph">Aggiungi articoli con ricerca o fotocamera</div>'; return; }
  cart.forEach((it, i) => {
    const qtyStr = fmtQty(it.qty) + (it.unitaMisura ? ' ' + it.unitaMisura : '');
    const sub    = it.nota ? '📝 ' + esc(it.nota) : '';
    const d = document.createElement('div'); d.className = 'cart-item';
    d.style.flexDirection = 'column'; d.style.alignItems = 'stretch'; d.style.gap = '3px';
    d.innerHTML = `<div style="display:flex;align-items:center;gap:7px">
      <div class="ci-cod" style="cursor:pointer;text-decoration:underline" onclick="openItemPage(${i})">${esc(it.cod_art)}</div>
      <div class="ci-desc">${esc(it.descrizione)}</div>
      <div class="ci-qty">
        <button class="ci-qbtn" onclick="cQ(${i},-1)">−</button>
        <div class="ci-qval" id="cqv${i}">${qtyStr}</div>
        <button class="ci-qbtn" onclick="cQ(${i},+1)">+</button>
      </div>
      <button class="ci-del" onclick="cDel(${i})">×</button>
    </div>
    ${sub ? `<div style="font-size:10px;color:var(--dim);font-family:var(--mono);padding-left:4px">${sub}</div>` : ''}`;
    c.appendChild(d);
  });
}

function cQ(i, d) {
  cart[i].qty = round(Math.max(0, cart[i].qty + d * cart[i].step));
  const el = $('cqv' + i);
  if (el) el.textContent = fmtQty(cart[i].qty) + (cart[i].unitaMisura ? ' ' + cart[i].unitaMisura : '');
}
function cDel(i)  { cart.splice(i, 1); renderCart(); }
function clearCart() { cart = []; renderCart(); }

// ── Invia comanda al PC ───────────────────────────────────────────
function sendOrder() {
  if (!cart.length || !ws || ws.readyState !== 1) {
    if (!ws || ws.readyState !== 1) toast('⚠ Non connesso', 'warn'); return;
  }
  const cliente = ($('orderCliente').value || '').trim();
  const order = {
    order_id:    uid(),
    created_by:  myName,
    destination: 'PC',
    status:      'pending',
    cliente,
    items: cart.map(c => ({
      cod_art:             c.cod_art,
      descrizione:         c.descrizione,
      qty:                 c.qty,
      unitaMisura:         c.unitaMisura         || '',
      nota:                c.nota                || '',
      unita_misura_list:   c.unita_misura_list   || [],
      um_base:             c.um_base             || '',
      fattori_conversione: c.fattori_conversione || {}
    })),
    note:      $('orderNote').value.trim(),
    timestamp: new Date().toISOString()
  };
  ws.send(JSON.stringify({ type: 'new_order', order }));
  toast('📤 Comanda inviata al PC', 'ok');
  clearCart();
  $('orderNote').value = ''; $('orderCliente').value = '';
}

// ── Pagina dettaglio articolo (carrello) ──────────────────────────
let ipIdx = -1;

function openItemPage(i) {
  ipIdx = i;
  const it = cart[i];
  $('ipCodArt').textContent     = it.cod_art;
  $('ipDesc').textContent       = it.descrizione;
  $('ipQtyInput').value         = fmtQty(it.qty);
  $('ipStepInfo').textContent   = 'Step: ' + fmtQty(it.step);
  $('ipNota').value             = it.nota || '';
  const sel = $('ipUmSelect');
  sel.innerHTML = '<option value="">—</option>';
  (it.unita_misura_list || it.umList || []).forEach(um => {
    const opt = document.createElement('option'); opt.value = um; opt.textContent = um;
    if (um === it.unitaMisura) opt.selected = true;
    sel.appendChild(opt);
  });
  if (it.unitaMisura && !(it.unita_misura_list || it.umList || []).includes(it.unitaMisura)) {
    const opt = document.createElement('option'); opt.value = it.unitaMisura; opt.textContent = it.unitaMisura; opt.selected = true;
    sel.appendChild(opt);
  }
  $('itemPage').classList.add('show');
}
function closeItemPage() { $('itemPage').classList.remove('show'); ipIdx = -1; }

function ipQty(dir) {
  if (ipIdx < 0) return;
  const it = cart[ipIdx];
  it.qty = round(Math.max(0, it.qty + dir * it.step));
  $('ipQtyInput').value = fmtQty(it.qty);
  renderCart();
}
function ipApplyQty() {
  if (ipIdx < 0) return;
  const it  = cart[ipIdx];
  const raw = $('ipQtyInput').value.trim().replace(',', '.');
  const v   = parseFloat(raw);
  if (!isNaN(v) && v >= 0) {
    const r = round(v); it.qty = r;
    if (r > 0) { it.step = r; $('ipStepInfo').textContent = 'Step: ' + fmtQty(r); }
    $('ipQtyInput').value = fmtQty(r); renderCart();
  } else { $('ipQtyInput').value = fmtQty(it.qty); }
}
function ipUmChange()  { if (ipIdx >= 0) { cart[ipIdx].unitaMisura = $('ipUmSelect').value; renderCart(); } }
function ipConfirm()   { if (ipIdx < 0) return; ipApplyQty(); cart[ipIdx].nota = $('ipNota').value.trim(); cart[ipIdx].unitaMisura = $('ipUmSelect').value; renderCart(); closeItemPage(); }
function ipRemove()    { if (ipIdx < 0) return; cart.splice(ipIdx, 1); renderCart(); closeItemPage(); }
