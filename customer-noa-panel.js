// customer-noa-panel.js
// CNOAPORTAL1: the broker's customer NOA on Customer Approvals (status chip,
// Send NOA, AP contacts, NOA bell). Contract: NOA Center hand-offs 2026-11-03
// and 2026-11-19. Loaded by customer-approvals.html; on the portal it must be
// in broker_portal.ALLOWED_ASSETS or it 404s silently (the page then behaves
// exactly as it did before this file existed).
//
// 🚨 DARK. While CNOA_PORTAL_ENABLED is false a broker sees nothing and this
// file makes ZERO /customer-noa/* calls. The only viewer who sees it is OperFi
// staff impersonating a broker, tagged "Preview: hidden from clients". The API
// is live and a send really emails the customer's AP. Flip only on Tom's word.
const CNOA_PORTAL_ENABLED = false;

(function () {
  'use strict';

  var CHUNK = 200;                       // /customer-noa/statuses max ids per call
  var config = { recheckMs: 250, recheckMax: 40 };   // whoami can land after the list

  var state = {
    email: '', apiBase: '', rerender: null,
    chips: {},          // submission_id -> chip
    seq: 0,             // guards against a stale load overtaking a newer one
    recheckTimer: null
  };

  function imp() { return (typeof window !== 'undefined' && window.OPERFI_IMP) || null; }

  // Staff impersonating a broker. isStaff() is false until /whoami returns, and
  // a broker can hand-set the localStorage target, so BOTH must hold.
  function staffPreviewing() {
    var i = imp();
    try { return !!(i && i.isStaff && i.isStaff() && i.target && i.target()); }
    catch (e) { return false; }
  }

  function visible() { return CNOA_PORTAL_ENABLED || staffPreviewing(); }
  function isPreview() { return !CNOA_PORTAL_ENABLED && staffPreviewing(); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function getJson(path) {
    try {
      return fetch(state.apiBase + path).then(function (res) {
        return res.ok ? res.json() : null;
      }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  function fetchStatuses(ids, seq) {
    var chunks = [];
    for (var i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
    return Promise.all(chunks.map(function (c) {
      return getJson('/customer-noa/statuses?email=' + encodeURIComponent(state.email) +
                     '&submission_ids=' + c.map(encodeURIComponent).join(','));
    })).then(function (payloads) {
      if (seq !== state.seq) return;            // a newer load overtook this one
      var chips = {};
      payloads.forEach(function (p) {
        var c = p && p.chips;
        if (!c || typeof c !== 'object') return;
        Object.keys(c).forEach(function (k) { chips[k] = c[k]; });
      });
      state.chips = chips;
      if (typeof state.rerender === 'function') state.rerender();
    });
  }

  function start(records, seq) {
    var ids = [];
    (records || []).forEach(function (r) { if (r && r.ID) ids.push(String(r.ID)); });
    if (!ids.length) return;
    fetchStatuses(ids, seq);
  }

  // Called once per list load by customer-approvals.html onRecordsLoaded.
  function onRecords(records, opts) {
    opts = opts || {};
    state.email = opts.email || '';
    state.apiBase = opts.apiBase || '';
    state.rerender = opts.rerender || null;
    state.chips = {};
    var seq = ++state.seq;
    clearTimeout(state.recheckTimer);
    if (!state.email) return;
    if (visible()) { start(records, seq); return; }
    // Not visible yet. Only a possible staff preview is worth waiting for.
    var i = imp();
    var hasTarget = false;
    try { hasTarget = !!(i && i.target && i.target()); } catch (e) {}
    if (!hasTarget) return;
    var tries = 0;
    (function recheck() {
      if (seq !== state.seq) return;
      if (visible()) { start(records, seq); return; }
      if (++tries >= config.recheckMax) return;
      state.recheckTimer = setTimeout(recheck, config.recheckMs);
    })();
  }

  function chipFor(id) {
    if (!visible()) return null;
    return state.chips[String(id)] || null;
  }

  var api = {
    visible: visible, isPreview: isPreview, onRecords: onRecords, chipFor: chipFor,
    esc: esc, _state: state, _config: config
  };
  if (typeof window !== 'undefined') { window.OperFiCustomerNoa = api; }
})();
