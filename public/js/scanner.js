'use strict';

let scanActive = false, scanStream = null, scanRafId = null, scanQTimer = null, scanQBusy = false;
let pendingScan = false;
const DEBOUNCE = 1300;
let _dbVal = '', _dbTime = 0;

// ── Guard: fotocamera solo se PC connesso ─────────────────────────
function toggleScanGuarded() {
  if (!scanActive && !pcOnline) {
    toast('⚠ La fotocamera è disponibile solo quando il PC è connesso', 'warn');
    return;
  }
  toggleScan();
}

function updateScanCardState() {
  const card = $('scanCard'); if (!card) return;
  if (!pcOnline && !scanActive) { card.style.opacity = '0.45'; card.title = 'Disponibile solo con PC connesso'; }
  else { card.style.opacity = ''; card.title = ''; }
}

// ── Avvia/ferma fotocamera ────────────────────────────────────────
async function toggleScan() { if (scanActive) stopScan(); else await startScan(); }

async function startScan() {
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    const vid = $('newVideo'); vid.srcObject = scanStream; await vid.play();
    $('newCamView').style.height = Math.round(window.innerHeight * .28) + 'px';
    $('newCamView').classList.add('show'); $('vfLine').classList.add('animate');
    scanActive = true; $('scanCard').classList.add('active');
    $('scanIco').textContent = '⏹'; $('scanLbl').textContent = 'Stop';
    startJsQR(); startQuagga();
  } catch (e) { toast('⚠ Fotocamera: ' + e.message, 'err'); }
}

function stopScan() {
  scanActive = false;
  if (scanRafId)  { cancelAnimationFrame(scanRafId); scanRafId = null; }
  if (scanQTimer) { clearInterval(scanQTimer); scanQTimer = null; }
  scanQBusy = false;
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
  $('newVideo').srcObject = null;
  $('newCamView').classList.remove('show'); $('vfLine').classList.remove('animate');
  $('scanCard').classList.remove('active');
  $('scanIco').textContent = '📷'; $('scanLbl').textContent = 'Fotocamera';
}

// ── Codice rilevato ───────────────────────────────────────────────
function onScanDetected(value, type) {
  if (!value || typeof value !== 'string') return;
  doFlash(); doVib(); doChip('✓ ' + value); stopScan();
  if (!ws || ws.readyState !== 1) { toast('⚠ Non connesso', 'warn'); return; }
  if (!pcOnline) { toast('⚠ PC offline', 'warn'); return; }
  const st = type === 'QR' ? 'cod_art' : (type.startsWith('EAN') || type.startsWith('UPC') ? 'barcode' : 'cod_art');
  pendingScan = true;
  toast(`🔍 Ricerca "${value}"…`, 'info');
  ws.send(JSON.stringify({ type: 'search_request', request_id: rid(), search_type: st, query: value, source: type.toLowerCase() }));
}

// ── Motore jsQR (QR code) ─────────────────────────────────────────
function startJsQR() {
  const vid = $('newVideo'), cv = $('newCanvas');
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  function tick() {
    if (!scanActive) return;
    if (vid.readyState === vid.HAVE_ENOUGH_DATA) {
      cv.width = vid.videoWidth; cv.height = vid.videoHeight; ctx.drawImage(vid, 0, 0, cv.width, cv.height);
      let id = ctx.getImageData(0, 0, cv.width, cv.height);
      let qr = jsQR(id.data, id.width, id.height, { inversionAttempts: 'dontInvert' });
      if (qr && qr.data && db(qr.data)) { onScanDetected(qr.data, 'QR'); return; }
      const r = rot(cv, 90); id = r.getContext('2d').getImageData(0, 0, r.width, r.height);
      qr = jsQR(id.data, id.width, id.height, { inversionAttempts: 'dontInvert' });
      if (qr && qr.data && db(qr.data)) { onScanDetected(qr.data, 'QR'); return; }
    }
    scanRafId = requestAnimationFrame(tick);
  }
  scanRafId = requestAnimationFrame(tick);
}

// ── Motore Quagga (barcode 1D) ────────────────────────────────────
function startQuagga() {
  const R = ['ean_reader','ean_8_reader','upc_reader','upc_e_reader','code_128_reader','code_39_reader','code_93_reader','codabar_reader','i2of5_reader'];
  const td = (src, cb) => Quagga.decodeSingle({ src, numOfWorkers: 0, inputStream: { size: 800 }, locator: { patchSize: 'medium', halfSample: true }, decoder: { readers: R }, locate: true }, cb);
  scanQTimer = setInterval(() => {
    if (!scanActive || scanQBusy) return;
    const cv = $('newCanvas'); if (!cv.width) return;
    scanQBusy = true;
    td(cv.toDataURL('image/jpeg', .85), r1 => {
      if (r1?.codeResult?.code && db(r1.codeResult.code)) { scanQBusy = false; onScanDetected(r1.codeResult.code, fmt(r1.codeResult.format)); return; }
      if (!scanActive) { scanQBusy = false; return; }
      td(rot($('newCanvas'), 90).toDataURL('image/jpeg', .85), r2 => {
        scanQBusy = false;
        if (r2?.codeResult?.code && db(r2.codeResult.code)) onScanDetected(r2.codeResult.code, fmt(r2.codeResult.format));
      });
    });
  }, 400);
}

// ── Helpers ───────────────────────────────────────────────────────
function db(v) { const n = Date.now(); if (v === _dbVal && n - _dbTime < DEBOUNCE) return false; _dbVal = v; _dbTime = n; return true; }
function rot(src, deg) { const w = src.width, h = src.height, c = document.createElement('canvas'); if (deg === 90 || deg === 270) { c.width = h; c.height = w; } else { c.width = w; c.height = h; } const ctx = c.getContext('2d'); ctx.translate(c.width/2, c.height/2); ctx.rotate(deg * Math.PI / 180); ctx.drawImage(src, -w/2, -h/2); return c; }
function fmt(f) { if (!f) return 'BARCODE'; const m = { ean_13:'EAN13', ean_8:'EAN8', upc_a:'UPC-A', upc_e:'UPC-E', code_128:'CODE128', code_39:'CODE39', code_93:'CODE93', codabar:'CODABAR', i2of5:'ITF' }; return m[f.toLowerCase()] || f.toUpperCase().slice(0, 8); }
function doFlash() { const f = $('vfFlash'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 130); }
function doVib()   { if (navigator.vibrate) navigator.vibrate(80); }
function doChip(t) { const c = $('vfChip'); c.textContent = t; c.classList.add('show'); clearTimeout(c._t); c._t = setTimeout(() => c.classList.remove('show'), 2500); }
