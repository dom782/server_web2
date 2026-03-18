'use strict';

// ── Pagina Giacenze ───────────────────────────────────────────────
function openGiacenzePage() {
  closeHamburger();
  $('giacenzePage').classList.add('show');
  $('giacenzeResults').innerHTML = '';
  $('giacenzeStatus').textContent = 'Cerca un articolo per visualizzare la giacenza';
  $('giacenzeInput').value = '';
  setTimeout(() => $('giacenzeInput').focus(), 200);
}
function closeGiacenzePage() { $('giacenzePage').classList.remove('show'); }

// ── Hamburger menu ────────────────────────────────────────────────
function openHamburger()  { $('hamburgerMenu').classList.add('show'); }
function closeHamburger() { $('hamburgerMenu').classList.remove('show'); }

// ── Ricerca articolo per giacenza ─────────────────────────────────
let gMode = 'cod_art';
function gToggleMode(mode) {
  gMode = mode;
  $('gBtnCod').className  = 'sp-btn' + (mode === 'cod_art'    ? ' active' : '');
  $('gBtnDesc').className = 'sp-btn' + (mode === 'descrizione' ? ' active' : '');
  $('giacenzeInput').placeholder = mode === 'cod_art' ? 'Codice articolo…' : 'Parola nella descrizione…';
}

function gSearch() {
  const q = $('giacenzeInput').value.trim();
  if (!q) { $('giacenzeStatus').textContent = 'Inserisci un testo di ricerca'; return; }
  if (!pcOnline) { $('giacenzeStatus').textContent = '⚠ PC non connesso'; return; }
  if (!ws || ws.readyState !== 1) { $('giacenzeStatus').textContent = '⚠ Non connesso'; return; }

  $('giacenzeStatus').textContent = `Ricerca "${q}"…`;
  $('giacenzeResults').innerHTML  = '<div class="g-loading">⏳ Ricerca in corso…</div>';

  // Usa la ricerca articoli esistente, poi al click carica la giacenza
  ws.send(JSON.stringify({
    type: 'search_request',
    request_id: 'G-' + rid(),
    search_type: gMode,
    query: q,
    source: 'giacenza'
  }));
}

// ── Risposta ricerca articoli per giacenza ────────────────────────
function onGiacenzaSearchResponse(msg) {
  const results = msg.results || [];
  if (!results.length) {
    $('giacenzeStatus').textContent = 'Nessun articolo trovato';
    $('giacenzeResults').innerHTML  = '<div class="g-empty">🤷 Nessun risultato</div>';
    return;
  }
  if (results.length === 1) {
    // Direttamente alla giacenza
    loadGiacenza(results[0].cod_art);
    return;
  }
  // Mostra lista articoli da scegliere
  $('giacenzeStatus').textContent = results.length + ' articoli trovati — seleziona';
  $('giacenzeResults').innerHTML  = '';
  results.forEach(a => {
    const row = document.createElement('div');
    row.className = 'g-article-row';
    row.innerHTML = `<span class="g-art-cod">${esc(a.cod_art)}</span>
                     <span class="g-art-desc">${esc(a.descrizione)}</span>`;
    row.addEventListener('click', () => loadGiacenza(a.cod_art));
    $('giacenzeResults').appendChild(row);
  });
}

// ── Carica giacenza ───────────────────────────────────────────────
let pendingGiacenza = false;
let giacenzaReqId   = null;

function loadGiacenza(codArt) {
  if (!ws || ws.readyState !== 1) { $('giacenzeStatus').textContent = '⚠ Non connesso'; return; }
  if (!pcOnline) { $('giacenzeStatus').textContent = '⚠ PC non connesso'; return; }

  giacenzaReqId   = 'GR-' + rid();
  pendingGiacenza = true;

  $('giacenzeStatus').textContent = `Caricamento giacenza per ${codArt}…`;
  $('giacenzeResults').innerHTML  = '<div class="g-loading">⏳ Interrogazione database…</div>';

  ws.send(JSON.stringify({
    type:       'giacenza_request',
    request_id: giacenzaReqId,
    cod_art:    codArt
  }));
}

// ── Risposta giacenza ─────────────────────────────────────────────
function onGiacenzaResponse(msg) {
  pendingGiacenza = false;
  giacenzaReqId   = null;

  const results = msg.results || [];
  const codArt  = msg.cod_art || '';

  if (msg.error && msg.error !== '') {
    $('giacenzeStatus').textContent = '⚠ Errore: ' + msg.error;
    $('giacenzeResults').innerHTML  = `<div class="g-empty">❌ ${esc(msg.error)}</div>`;
    return;
  }
  if (!results.length) {
    $('giacenzeStatus').textContent = 'Nessuna giacenza trovata per ' + codArt;
    $('giacenzeResults').innerHTML  = '<div class="g-empty">📭 Nessuna giacenza</div>';
    return;
  }

  $('giacenzeStatus').textContent = `Giacenza: ${codArt}`;
  $('giacenzeResults').innerHTML  = '';

  // Tabella risultati
  const table = document.createElement('div');
  table.className = 'g-table';

  // Header
  table.innerHTML = `<div class="g-row g-header">
    <div class="g-cell g-cod">Cod. Articolo</div>
    <div class="g-cell g-nome">Nome Articolo</div>
    <div class="g-cell g-um">UM</div>
    <div class="g-cell g-for">Fornitore</div>
    <div class="g-cell g-giac">Giacenza</div>
  </div>`;

  results.forEach(r => {
    const giac   = r.giacenza || 0;
    const gColor = giac >= 0 ? 'var(--green)' : 'var(--red)';
    const gFmt   = Number.isInteger(giac) ? String(giac) : String(giac).replace('.', ',');
    const row    = document.createElement('div');
    row.className = 'g-row';
    row.innerHTML = `
      <div class="g-cell g-cod">${esc(r.cod_art||'')}</div>
      <div class="g-cell g-nome">${esc(r.nome_articolo||'')}</div>
      <div class="g-cell g-um">${esc(r.unita_misura||'')}</div>
      <div class="g-cell g-for">${esc(r.fornitore||'')}</div>
      <div class="g-cell g-giac" style="color:${gColor};font-weight:700">${gFmt}</div>`;
    table.appendChild(row);
  });

  $('giacenzeResults').appendChild(table);
}
