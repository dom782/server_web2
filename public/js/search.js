'use strict';

let spMode = 'cod_art', spTimer = null;

// ── Apri/chiudi pagina ricerca ────────────────────────────────────
function openSearchPage(mode) {
  if (!ws || ws.readyState !== 1) { toast('⚠ Non connesso', 'warn'); return; }
  if (!pcOnline) { toast('⚠ PC non connesso', 'warn'); return; }
  spMode = mode;
  $('spTitle').textContent    = mode === 'cod_art' ? 'Cerca per Codice Articolo' : 'Cerca per Descrizione';
  $('spBtnCod').className     = 'sp-btn' + (mode === 'cod_art'    ? ' active' : '');
  $('spBtnDesc').className    = 'sp-btn' + (mode === 'descrizione' ? ' active' : '');
  $('spInput').value          = '';
  $('spInput').placeholder    = mode === 'cod_art' ? 'Codice articolo…' : 'Parola nella descrizione…';
  $('spCount').textContent    = '';
  $('spStatusTxt').textContent = 'Digita per cercare nel database';
  $('spSpinner').classList.remove('show');
  $('spResults').innerHTML    = `<div class="sp-ph"><div class="pi">🔍</div><p>Cerca per ${mode === 'cod_art' ? 'codice articolo' : 'descrizione'}.</p></div>`;
  $('searchPage').classList.add('show');
  setTimeout(() => $('spInput').focus(), 200);
}

function closeSearchPage() {
  $('searchPage').classList.remove('show');
  clearTimeout(spTimer);
  if (opAddMode) {
    opAddMode = false;
    if (currentOrderId) $('orderPage').classList.add('show');
  }
}

// ── Cambia modo COD/DESC senza cercare ────────────────────────────
function spToggleMode(mode) {
  spMode = mode;
  $('spBtnCod').className  = 'sp-btn' + (mode === 'cod_art'    ? ' active' : '');
  $('spBtnDesc').className = 'sp-btn' + (mode === 'descrizione' ? ' active' : '');
  $('spInput').placeholder = mode === 'cod_art' ? 'Codice articolo…' : 'Parola nella descrizione…';
  if ($('spInput').value.trim()) spSearch(mode);
}

// ── Ricerca ───────────────────────────────────────────────────────
function onSpInput() {
  clearTimeout(spTimer);
  const q = $('spInput').value.trim();
  if (q.length > 0) spTimer = setTimeout(() => spSearch(spMode), 420);
}

function spSearch(type) {
  spMode = type;
  $('spBtnCod').className  = 'sp-btn' + (type === 'cod_art'    ? ' active' : '');
  $('spBtnDesc').className = 'sp-btn' + (type === 'descrizione' ? ' active' : '');
  const q = $('spInput').value.trim(); if (!q) return;
  if (!pcOnline) { toast('⚠ PC non connesso', 'warn'); return; }
  $('spSpinner').classList.add('show');
  $('spStatusTxt').textContent = `Ricerca "${q}"…`;
  $('spResults').innerHTML = '';
  ws.send(JSON.stringify({ type: 'search_request', request_id: rid(), search_type: type, query: q, source: 'manual' }));
}

// ── Risposta ricerca ──────────────────────────────────────────────
function onSearchResponse(msg) {
  const results = msg.results || [];

  // Risposta a scan fotocamera
  if (pendingScan) {
    pendingScan = false;
    $('spSpinner').classList.remove('show');
    if (msg.error && msg.error !== '') { toast('⚠ ' + msg.error, 'err'); return; }
    if (!results.length) { toast('Nessun articolo trovato', 'warn'); return; }
    if (results.length === 1) {
      const r0 = results[0];
      if (opAddMode) {
        opAddMode = false;
        const o = ordersMap.get(currentOrderId);
        if (o) {
          const um = (r0.unita_misura_list && r0.unita_misura_list.length) ? r0.unita_misura_list[0] : '';
          o.items.push({ cod_art: r0.cod_art, descrizione: r0.descrizione, qty: 1, step: 1, unitaMisura: um, nota: '', um_base: r0.cod_un_mis_base || '', unita_misura_list: r0.unita_misura_list || [], fattori_conversione: r0.fattori_conversione || {} });
          closeSearchPage(); openOrderPage(currentOrderId);
          toast('✓ ' + r0.cod_art + ' aggiunto alla comanda', 'ok'); return;
        }
      }
      addToCart(r0.cod_art, r0.descrizione, r0.unita_misura_list || [], r0.cod_un_mis_base || '', r0.fattori_conversione || {});
      toast(`✓ ${r0.cod_art} aggiunto`, 'ok'); return;
    }
    // Più risultati → mostra nella pagina
    spMode = 'cod_art';
    $('spTitle').textContent     = 'Risultati scansione';
    $('spInput').value           = msg.query || '';
    $('spCount').textContent     = results.length + ' risultati';
    $('spStatusTxt').textContent = results.length + ' risultati';
    $('spSpinner').classList.remove('show');
    $('spResults').innerHTML = '';
    results.forEach(a => $('spResults').appendChild(buildSpResult(a)));
    $('searchPage').classList.add('show');
    return;
  }

  // Risposta normale (pagina ricerca aperta)
  if ($('searchPage').classList.contains('show')) {
    $('spSpinner').classList.remove('show');
    $('spCount').textContent = results.length + ' risultati';
    if (msg.error && msg.error !== '') { $('spStatusTxt').textContent = '⚠ ' + msg.error; return; }
    $('spStatusTxt').textContent = results.length + ` risultato/i per "${msg.query || ''}"`;
    $('spResults').innerHTML = '';
    if (!results.length) { $('spResults').innerHTML = '<div class="sp-ph"><div class="pi" style="font-size:28px">🤷</div><p>Nessun risultato.</p></div>'; return; }
    results.forEach(a => $('spResults').appendChild(buildSpResult(a)));
  }
}

// ── Costruisce card risultato ─────────────────────────────────────
function buildSpResult(a) {
  const d    = document.createElement('div'); d.className = 'sp-result';
  const ico  = document.createElement('div'); ico.className  = 'sp-result-ico';  ico.textContent  = '📦';
  const info = document.createElement('div'); info.className = 'sp-result-info';
  const cod  = document.createElement('div'); cod.className  = 'sp-result-cod';  cod.textContent  = a.cod_art;
  const desc = document.createElement('div'); desc.className = 'sp-result-desc'; desc.textContent = a.descrizione;
  info.appendChild(cod); info.appendChild(desc);

  const btn = document.createElement('button'); btn.className = 'sp-add-btn'; btn.id = 'spbtn-' + a.cod_art; btn.textContent = '+';
  btn.addEventListener('click', () => {
    const um = (a.unita_misura_list && a.unita_misura_list.length) ? a.unita_misura_list[0] : '';
    if (opAddMode) {
      opAddMode = false;
      const o = ordersMap.get(currentOrderId);
      if (o) {
        o.items.push({ cod_art: a.cod_art, descrizione: a.descrizione, qty: 1, step: 1, unitaMisura: um, nota: '', um_base: a.cod_un_mis_base || '', unita_misura_list: a.unita_misura_list || [], fattori_conversione: a.fattori_conversione || {} });
        closeSearchPage(); openOrderPage(currentOrderId);
        toast('✓ ' + a.cod_art + ' aggiunto alla comanda', 'ok'); return;
      }
    }
    addToCart(a.cod_art, a.descrizione, a.unita_misura_list || [], a.cod_un_mis_base || '', a.fattori_conversione || {});
    btn.textContent = '✓'; btn.classList.add('added');
    setTimeout(() => { btn.textContent = '+'; btn.classList.remove('added'); }, 1400);
    toast(`✓ ${a.cod_art} aggiunto al carrello`, 'ok');
  });

  d.appendChild(ico); d.appendChild(info); d.appendChild(btn);
  return d;
}
