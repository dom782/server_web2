'use strict';

// ── Stato globale condiviso ───────────────────────────────────────
let token = null, myName = '';
let ws = null, pcOnline = false;
let onlineUsers = [], registeredUsers = [];
const ordersMap = new Map();
let unreadOrders = 0, curTab = 'com';
let cart = [];

// ── Helpers DOM ───────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function uid() {
  return 'ORD-' + Math.random().toString(36).slice(2,7).toUpperCase()
       + '-' + Date.now().toString(36).toUpperCase();
}
function rid() {
  return Math.random().toString(36).slice(2,14) + Date.now().toString(36);
}
function round(v) { return Math.round(v * 1e10) / 1e10; }
function fmtQty(v) {
  if (v === Math.floor(v) && isFinite(v)) return String(Math.round(v));
  return String(v).replace('.', ',');
}

// ── Toast ─────────────────────────────────────────────────────────
let _toastTm;
function toast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'show ' + (type || '');
  clearTimeout(_toastTm);
  _toastTm = setTimeout(() => t.className = '', 3200);
}

// ── Tabs ──────────────────────────────────────────────────────────
function switchTab(tab) {
  if (scanActive && tab !== 'new') stopScan();
  curTab = tab;
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const key = tab.charAt(0).toUpperCase() + tab.slice(1);
  $('tab' + key).classList.add('active');
  $('tab' + key + 'Btn').classList.add('active');
  if (tab === 'com') { unreadOrders = 0; updateBadge(); }
}
