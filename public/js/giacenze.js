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

  // Card verticale per ogni risultato
  results.forEach(r => {
    const giac   = r.giacenza || 0;
    const gFmt   = Number.isInteger(giac) ? String(giac) : String(giac).replace('.', ',');
    const giacCls = giac >= 0 ? 'g-value giac-pos' : 'g-value giac-neg';

    const card = document.createElement('div');
    card.className = 'g-card';
    card.innerHTML = `
      <div class="g-field">
        <div class="g-label">Cod. Articolo</div>
        <div class="g-value mono">${esc(r.cod_art||'')}</div>
      </div>
      <div class="g-divider"></div>
      <div class="g-field">
        <div class="g-label">Descrizione</div>
        <div class="g-value">${esc(r.nome_articolo||'')}</div>
      </div>
      <div class="g-field">
        <div class="g-label">Fornitore</div>
        <div class="g-value">${esc(r.fornitore||'')}</div>
      </div>
      <div class="g-field">
        <div class="g-label">Unità di misura</div>
        <div class="g-value mono">${esc(r.unita_misura||'')}</div>
      </div>
      <div class="g-divider"></div>
      <div class="g-field">
        <div class="g-label">Giacenza</div>
        <div class="${giacCls}">${gFmt}</div>
      </div>`;
    $('giacenzeResults').appendChild(card);
  });
}
