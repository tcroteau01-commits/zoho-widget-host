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
    injectStyles();
    bindOnce();
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

  // ── Row chip ───────────────────────────────────────────────────────────
  // 🚨 Acknowledged is not Confirmed: "Waiting on OperFi verification" takes
  // the waiting tone like every other in-flight state. Only confirmed is done.
  function chipToneClass(chip) {
    var s = chip && chip.status;
    if (s === 'confirmed' || s === 'grandfathered' ||
        (chip && chip.label === 'Confirmed')) return 'cnoa-tone-done';
    if (s === 'action_needed') return 'cnoa-tone-action';
    if (s === 'not_sent' || s === 'released') return 'cnoa-tone-muted';
    return 'cnoa-tone-wait';
  }

  var PREVIEW_TAG = '<span class="cnoa-preview-tag">Preview: hidden from clients</span>';

  function rowChipHtml(rec) {
    var chip = rec && chipFor(rec.ID);
    if (!chip) return '';
    var id = String(rec.ID);
    // class row-action: the page's row-click guard skips it (no drawer open).
    // NO data-action: the page's own action binder must not see it.
    var send = chip.can_send === true
      ? '<button type="button" class="row-action cnoa-send-btn" data-cnoa-send="' + esc(id) + '">Send NOA</button>'
      : '';
    return '<div class="cnoa-row">' +
      '<span class="cnoa-chip ' + chipToneClass(chip) + '">NOA: <span class="cnoa-label">' +
        esc(chip.label) + '</span></span>' + send +
      (isPreview() ? PREVIEW_TAG : '') +
      '</div>';
  }

  var sendHandler = function () {};
  function onSendClick(fn) { if (typeof fn === 'function') sendHandler = fn; }

  var bound = false;
  function bindOnce() {
    if (bound || typeof document === 'undefined') return;
    bound = true;
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('[data-cnoa-send]');
      if (!btn || !visible()) return;
      e.preventDefault();
      sendHandler(btn.getAttribute('data-cnoa-send'));
    });
  }

  // POST with the body exactly as given. Resolves {status, body}; status 0 on
  // a network failure. Callers build bodies from allow lists only.
  function postJson(path, body) {
    try {
      return fetch(state.apiBase + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      }).then(function (res) {
        return res.json().catch(function () { return {}; })
          .then(function (b) { return { status: res.status, body: b || {} }; });
      }).catch(function () { return { status: 0, body: {} }; });
    } catch (e) { return Promise.resolve({ status: 0, body: {} }); }
  }

  function getWithStatus(path) {
    try {
      return fetch(state.apiBase + path).then(function (res) {
        return res.json().catch(function () { return {}; })
          .then(function (b) { return { status: res.status, body: b || {} }; });
      }).catch(function () { return { status: 0, body: {} }; });
    } catch (e) { return Promise.resolve({ status: 0, body: {} }); }
  }

  function shortDate(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ── Drawer section ─────────────────────────────────────────────────────
  var LOR_URL = 'https://lor-request.operfi.com';

  function panelHtml(rec) {
    var chip = rec && chipFor(rec.ID);
    if (!chip) return '';
    var id = String(rec.ID);
    var sent = shortDate(chip.last_sent_at);
    return '<div class="cnoa-panel" id="cnoa-panel">' +
      '<div class="cnoa-panel-head">Customer NOA ' + (isPreview() ? PREVIEW_TAG : '') + '</div>' +
      '<div class="cnoa-row"><span class="cnoa-chip ' + chipToneClass(chip) + '"><span class="cnoa-label">' +
        esc(chip.label) + '</span></span>' +
        (chip.can_send === true
          ? '<button type="button" class="btn cnoa-send-btn" data-cnoa-send="' + esc(id) + '">Send NOA</button>'
          : '') +
      '</div>' +
      (sent ? '<div class="cnoa-sub">Last sent ' + esc(sent) + '</div>' : '') +
      '<div class="cnoa-subhead">Accounts payable contacts</div>' +
      '<div id="cnoa-contacts" class="cnoa-contacts"><div class="cnoa-sub">Loading contacts...</div></div>' +
      '<div id="cnoa-add-form" class="cnoa-add">' +
        '<input name="cnoa-c-email" type="email" placeholder="AP email">' +
        '<input name="cnoa-c-name" type="text" placeholder="Name">' +
        '<input name="cnoa-c-phone" type="tel" placeholder="Phone">' +
        '<input name="cnoa-c-role" type="text" placeholder="Role (e.g. AP)">' +
        '<button type="button" class="btn" id="cnoa-add-contact">Add contact</button>' +
      '</div>' +
      '<div id="cnoa-contact-msg" class="cnoa-msg" role="status"></div>' +
      '<div class="cnoa-sub"><a href="' + LOR_URL + '" target="_blank" rel="noopener">Request a Letter of Release</a></div>' +
    '</div>';
  }

  var contactsBySub = {};   // submission_id -> last contacts list (Task 4 picker reads it)

  function contactsHtml(list) {
    if (!list || !list.length) return '<div class="cnoa-sub">No AP contacts yet.</div>';
    return list.map(function (c) {
      var tags = [];
      if (c.primary) tags.push('Primary');
      if (c.source === 'submission') tags.push('Suggested from the credit submission');
      return '<div class="cnoa-contact"><strong>' + esc(c.email) + '</strong>' +
        (c.name ? ' ' + esc(c.name) : '') + (c.role ? ' (' + esc(c.role) + ')' : '') +
        (c.phone ? ' ' + esc(c.phone) : '') +
        (tags.length ? ' <span class="cnoa-tag">' + esc(tags.join(', ')) + '</span>' : '') + '</div>';
    }).join('');
  }

  var CONTACT_ERRORS = {
    bad_email: 'Not a valid email address.',
    too_many_contacts: 'A customer can have up to 10 AP contacts.'
  };

  function wirePanel(rec, root) {
    if (!visible() || !rec || !root) return;
    var sec = root.querySelector('#cnoa-panel');
    if (!sec) return;
    var id = String(rec.ID);
    var listEl = sec.querySelector('#cnoa-contacts');
    var msg = sec.querySelector('#cnoa-contact-msg');
    getWithStatus('/customer-noa/contacts?email=' + encodeURIComponent(state.email) +
                  '&submission_id=' + encodeURIComponent(id)).then(function (r) {
      if (r.status === 200) {
        contactsBySub[id] = r.body.contacts || [];
        listEl.innerHTML = contactsHtml(contactsBySub[id]);
      } else {
        listEl.innerHTML = '<div class="cnoa-sub">Contacts could not be loaded.</div>';
      }
    });
    var addBtn = sec.querySelector('#cnoa-add-contact');
    addBtn.addEventListener('click', function () {
      var v = function (n) { var el = sec.querySelector('[name="cnoa-c-' + n + '"]'); return el ? el.value.trim() : ''; };
      if (!v('email')) { msg.textContent = 'Enter an email address.'; return; }
      addBtn.disabled = true;
      msg.textContent = '';
      postJson('/customer-noa/contacts', {
        email: state.email, submission_id: id,
        contact: { email: v('email'), name: v('name'), phone: v('phone'), role: v('role') }
      }).then(function (r) {
        addBtn.disabled = false;
        if (r.status === 200) {
          contactsBySub[id] = r.body.contacts || contactsBySub[id] || [];
          listEl.innerHTML = contactsHtml(contactsBySub[id]);
          ['email', 'name', 'phone', 'role'].forEach(function (n) { sec.querySelector('[name="cnoa-c-' + n + '"]').value = ''; });
          msg.textContent = 'Contact saved.';
        } else if (r.status === 403) {
          sec.querySelector('#cnoa-add-form').hidden = true;
          msg.textContent = "You don't have permission to change NOA contacts. Ask your account owner.";
        } else {
          msg.textContent = CONTACT_ERRORS[r.body.error] || 'The contact could not be saved. Try again.';
        }
      });
    });
  }

  var STYLES =
    '.cnoa-panel{border:1px solid #e3e3e3;border-radius:8px;padding:10px 12px;margin-bottom:14px;}' +
    '.cnoa-panel-head{font-weight:700;font-size:13px;margin-bottom:4px;}' +
    '.cnoa-subhead{font-weight:600;font-size:12px;margin-top:10px;}' +
    '.cnoa-sub{font-size:12px;color:#777;margin-top:4px;}' +
    '.cnoa-contact{font-size:12px;margin-top:4px;}' +
    '.cnoa-tag{font-size:10px;color:#555;background:#f1f1f1;border-radius:4px;padding:1px 4px;}' +
    '.cnoa-add{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}' +
    '.cnoa-add input{font-size:12px;padding:4px 6px;flex:1 1 120px;}' +
    '.cnoa-msg{font-size:12px;color:#8a5a00;margin-top:4px;}' +
    '.cnoa-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px;}' +
    '.cnoa-chip{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;border:1px solid;}' +
    '.cnoa-tone-done{background:#e8f5e9;color:#1f6321;border-color:#b9dcbb;}' +
    '.cnoa-tone-wait{background:#fff8e1;color:#8a5a00;border-color:#f0d58a;}' +
    '.cnoa-tone-action{background:#fdecea;color:#c62828;border-color:#f3b8b3;}' +
    '.cnoa-tone-muted{background:#f4f4f4;color:#666;border-color:#ddd;}' +
    '.cnoa-send-btn{font-size:11px;padding:2px 8px;}' +
    '.cnoa-preview-tag{font-size:10px;color:#6a1b9a;background:#f3e5f5;border:1px dashed #ce93d8;border-radius:4px;padding:1px 5px;}';

  function injectStyles() {
    if (typeof document === 'undefined' || document.getElementById('cnoa-styles')) return;
    var s = document.createElement('style');
    s.id = 'cnoa-styles';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  var api = {
    visible: visible, isPreview: isPreview, onRecords: onRecords, chipFor: chipFor,
    rowChipHtml: rowChipHtml, chipToneClass: chipToneClass, onSendClick: onSendClick,
    panelHtml: panelHtml, wirePanel: wirePanel, _contacts: contactsBySub,
    esc: esc, _state: state, _config: config
  };
  if (typeof window !== 'undefined') { window.OperFiCustomerNoa = api; }
})();
