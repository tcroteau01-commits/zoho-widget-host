// customer-noa-panel.js
// CNOAPORTAL1: the broker's customer NOA on Customer Approvals (status chip,
// Send NOA to the one AP address on file, NOA bell). Contract: NOA Center hand-offs 2026-11-03
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
    clientSend: false,  // statuses.client_send: this account may send (NOA Center #1158)
    seq: 0,            // guards against a stale load overtaking a newer one
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
      var clientSend = payloads.length > 0;
      payloads.forEach(function (p) {
        if (!p || p.client_send !== true) clientSend = false;   // every chunk must say yes
        var c = p && p.chips;
        if (!c || typeof c !== 'object') return;
        Object.keys(c).forEach(function (k) { chips[k] = c[k]; });
      });
      state.chips = chips;
      state.clientSend = clientSend;
      if (typeof state.rerender === 'function') state.rerender();
    });
  }

  function start(records, seq) {
    var ids = [];
    (records || []).forEach(function (r) { if (r && r.ID) ids.push(String(r.ID)); });
    injectStyles();
    bindOnce();
    fetchAttention(seq);
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
    state.clientSend = false;
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

  // The one AP address the client may send to, picked by the API (approved
  // submission's billing email or an OperFi-confirmed AP address). Tom 11-22.
  function sendTo(chip) {
    var t = chip && chip.send_to;
    return (t && typeof t === 'object' && typeof t.email === 'string' && t.email) ? t : null;
  }
  // Send NOA needs all three: the account may send at all (client_send), the API
  // says this customer is sendable, AND it names the recipient.
  function canSend(chip) {
    return !!(state.clientSend === true && chip && chip.can_send === true && sendTo(chip));
  }

  function rowChipHtml(rec) {
    var chip = rec && chipFor(rec.ID);
    if (!chip) return '';
    var id = String(rec.ID);
    // class row-action: the page's row-click guard skips it (no drawer open).
    // NO data-action: the page's own action binder must not see it.
    var send = canSend(chip)
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

  function shortDate(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ── Drawer section ─────────────────────────────────────────────────────
  // No Letter of Release link here: LOR requests are staff-only (Tom 11-22).
  // No contact list or Add contact: the client sends only to the one AP address
  // the API names in chip.send_to (Tom 11-22). They cannot pick or type one.
  var NO_AP_TEXT = 'No approved AP contact on file for this customer. Contact brokersupport@operfi.com.';

  function panelHtml(rec) {
    var chip = rec && chipFor(rec.ID);
    if (!chip) return '';
    var id = String(rec.ID);
    var sent = shortDate(chip.last_sent_at);
    var to = sendTo(chip);
    return '<div class="cnoa-panel" id="cnoa-panel">' +
      '<div class="cnoa-panel-head">Customer NOA ' + (isPreview() ? PREVIEW_TAG : '') + '</div>' +
      '<div class="cnoa-row"><span class="cnoa-chip ' + chipToneClass(chip) + '"><span class="cnoa-label">' +
        esc(chip.label) + '</span></span>' +
        (canSend(chip)
          ? '<button type="button" class="btn cnoa-send-btn" data-cnoa-send="' + esc(id) + '">Send NOA</button>'
          : '') +
      '</div>' +
      (sent ? '<div class="cnoa-sub">Last sent ' + esc(sent) + '</div>' : '') +
      (to ? '<div class="cnoa-sub">NOA goes to <strong>' + esc(to.email) + '</strong></div>'
          : (chip.status === 'not_sent' ? '<div class="cnoa-sub">' + esc(NO_AP_TEXT) + '</div>' : '')) +
    '</div>';
  }

  // Kept so customer-approvals.html's mount call stays valid. Nothing to wire.
  function wirePanel() {}

  // ── Send window ────────────────────────────────────────────────────────
  // One recipient, locked: chip.send_to. The email preview loads on open and
  // Send stays disabled until it does. No note, no other address, no override.
  var CHECK_TEXT = {
    free_mail: "Free email address (Gmail, Yahoo...). Use the customer's company address.",
    lookalike_domain: "Looks like the customer's domain but is not.",
    client_domain: "That is your own company's address.",
    client_user: "That is your own company's address.",
    credit_contact: 'That is the credit contact, not accounts payable.',
    bad_email: 'Not a valid email address.'
  };
  function checkText(code) { return CHECK_TEXT[code] || "This address can't be used for an NOA."; }

  var BLOCKED_TEXT = "This customer's AP contact can't be used for an NOA. Contact brokersupport@operfi.com.";
  var SEND_ERRORS = {
    no_master: "We don't have a signed NOA on file for your company yet. OperFi will reach out.",
    bad_state: 'This customer has already acknowledged or confirmed the NOA.',
    recipient_not_on_file: BLOCKED_TEXT,
    blocked_contact: BLOCKED_TEXT
  };
  function errorText(r) {
    // Acting as is read-only server-side: every POST under impersonation is refused.
    if (r.status === 403 && r.body && r.body.code === 'impersonation_read_only') {
      return 'Acting as is view-only. Sign in as the client to send.';
    }
    if (r.status === 403) return "You don't have permission to send NOAs. Ask your account owner.";
    if (r.status === 503 || r.status === 0) return 'Sending is unavailable right now. Try again in a few minutes.';
    return SEND_ERRORS[r.body && r.body.error] || 'Something went wrong. Try again.';
  }

  function blocksHtml(checks) {
    return ((checks && checks.blocks) || []).map(function (c) {
      return '<div class="cnoa-check cnoa-check-block">' + esc(checkText(c)) + '</div>';
    }).join('');
  }

  function closeSendForm() {
    var m = document.getElementById('cnoa-send-modal');
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }

  function toast(text) {
    var t = document.getElementById('cnoa-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'cnoa-toast';
      t.className = 'cnoa-toast';
      t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = text;
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.textContent = ''; }, 6000);
  }

  function refreshChip(id) {
    getJson('/customer-noa/status?email=' + encodeURIComponent(state.email) +
            '&submission_id=' + encodeURIComponent(id)).then(function (p) {
      if (p && p.chip) {
        state.chips[String(id)] = p.chip;
        if (typeof state.rerender === 'function') state.rerender();
      }
    });
  }

  function isBlocked(r) {
    return r.status === 409 && !!r.body && SEND_ERRORS[r.body.error] === BLOCKED_TEXT;
  }

  function openSendForm(id) {
    if (!visible() || typeof document === 'undefined') return;
    id = String(id);
    var chip = chipFor(id);
    if (!canSend(chip)) return;
    var to = sendTo(chip);
    closeSendForm();
    var m = document.createElement('div');
    m.id = 'cnoa-send-modal';
    m.className = 'cnoa-modal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.innerHTML =
      '<div class="cnoa-modal-box">' +
        '<div class="cnoa-panel-head">Send customer NOA ' + (isPreview() ? PREVIEW_TAG : '') + '</div>' +
        '<label class="cnoa-field"><span>To</span>' +
          '<input name="cnoa-s-to" type="email" value="' + esc(to.email) + '" readonly disabled></label>' +
        '<div class="cnoa-field" id="cnoa-s-subject-row" hidden><span>Subject</span><div id="cnoa-s-subject"></div></div>' +
        '<div id="cnoa-checks"></div>' +
        '<div id="cnoa-send-msg" class="cnoa-msg" role="status">Loading the email...</div>' +
        '<iframe id="cnoa-preview-frame" class="cnoa-preview-frame" sandbox="" title="NOA email" hidden></iframe>' +
        '<div class="cnoa-modal-actions">' +
          '<button type="button" class="btn" id="cnoa-cancel">Cancel</button>' +
          '<button type="button" class="btn primary" id="cnoa-send-self" disabled>Send NOA</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(m);

    var q = function (sel) { return m.querySelector(sel); };
    var msg = q('#cnoa-send-msg');
    var sendBtn = q('#cnoa-send-self');
    var frame = q('#cnoa-preview-frame');
    var busy = false;
    var contact = { email: to.email, name: to.name || '' };
    function stillOpen() { return document.getElementById('cnoa-send-modal') === m; }
    function blocked(r) {
      q('#cnoa-checks').innerHTML = blocksHtml(r.body && r.body.checks);
      msg.textContent = BLOCKED_TEXT;
      sendBtn.hidden = true;
      frame.hidden = true;
    }

    q('#cnoa-cancel').addEventListener('click', closeSendForm);

    postJson('/customer-noa/preview', {
      email: state.email, submission_id: id, contact: contact
    }).then(function (r) {
      if (!stillOpen()) return;
      var blocks = r.body && r.body.checks && r.body.checks.blocks;
      if (r.status === 200 && !(blocks && blocks.length)) {
        q('#cnoa-s-subject').textContent = String(r.body.subject || '');
        q('#cnoa-s-subject-row').hidden = !r.body.subject;
        frame.setAttribute('srcdoc', String(r.body.html || ''));   // sandboxed, never innerHTML
        frame.hidden = false;
        msg.textContent = '';
        sendBtn.disabled = false;
      } else if (r.status === 200 || isBlocked(r)) {
        blocked(r);
      } else {
        msg.textContent = errorText(r);
      }
    });

    sendBtn.addEventListener('click', function () {
      if (busy || sendBtn.disabled) return;
      busy = true;
      sendBtn.disabled = true;
      msg.textContent = '';
      postJson('/customer-noa/send', {
        email: state.email, submission_id: id, contact: contact, mode: 'self'
      }).then(function (r) {
        busy = false;
        if (r.status === 200) {
          closeSendForm();
          toast('NOA sent to ' + contact.email);
          refreshChip(id);
        } else if (isBlocked(r)) {
          blocked(r);
        } else {
          sendBtn.disabled = false;
          msg.textContent = errorText(r);
        }
      });
    });
  }
  sendHandler = openSendForm;

  // ── NOA bell ───────────────────────────────────────────────────────────
  // /attention is fetched once per list load (in start). buildChips reruns on
  // every filter click and rebuilds #chips, so mountBell only paints.
  var bellState = { items: [], chipsEl: null, openFn: null };

  function fetchAttention(seq) {
    getJson('/customer-noa/attention?email=' + encodeURIComponent(state.email)).then(function (p) {
      if (seq !== state.seq) return;
      bellState.items = (p && Array.isArray(p.items)) ? p.items : [];
      if (bellState.chipsEl) paintBell();
    });
  }

  function itemLine(it) {
    return it.kind === 'confirmed' ? 'NOA confirmed' : ((it.chip && it.chip.label) || 'Needs your attention');
  }

  function paintBell() {
    var host = bellState.chipsEl;
    if (!host) return;
    var old = host.querySelector('#cnoa-bell');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (!visible() || !bellState.items.length) return;
    var bell = document.createElement('span');
    bell.id = 'cnoa-bell';
    bell.className = 'chip cnoa-bell';
    bell.tabIndex = 0;
    bell.setAttribute('role', 'button');
    bell.title = 'Customer NOA updates';
    bell.innerHTML = '🔔 NOA updates <span class="count">' + bellState.items.length + '</span>' +
      (isPreview() ? ' ' + PREVIEW_TAG : '');
    bell.addEventListener('click', toggleBellMenu);
    bell.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleBellMenu(); }
    });
    host.insertBefore(bell, host.firstChild);
  }

  function closeBellMenu() {
    var m = document.getElementById('cnoa-bell-menu');
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }

  function toggleBellMenu() {
    if (document.getElementById('cnoa-bell-menu')) { closeBellMenu(); return; }
    var items = bellState.items.slice();
    if (!items.length) return;
    var menu = document.createElement('div');
    menu.id = 'cnoa-bell-menu';
    menu.className = 'cnoa-bell-menu';
    menu.innerHTML = items.map(function (it) {
      var when = shortDate(it.at);
      return '<button type="button" class="cnoa-bell-item" data-cnoa-open="' + esc(it.submission_id) + '">' +
        '<strong>' + esc(it.debtor_name || 'Customer') + '</strong>' +
        '<span class="cnoa-bell-line ' + (it.kind === 'confirmed' ? 'cnoa-tone-done' : 'cnoa-tone-action') + '">' +
          esc(itemLine(it)) + '</span>' +
        (when ? '<span class="cnoa-sub">' + esc(when) + '</span>' : '') +
      '</button>';
    }).join('');
    menu.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-cnoa-open]');
      if (!b) return;
      closeBellMenu();
      if (typeof bellState.openFn === 'function') bellState.openFn(b.getAttribute('data-cnoa-open'));
    });
    var bell = bellState.chipsEl && bellState.chipsEl.querySelector('#cnoa-bell');
    (bell && bell.parentNode ? bell.parentNode : document.body).appendChild(menu);
    // Anchor under the bell (same offsetParent as the menu), not over it, so
    // the bell stays clickable to close. Any click outside also closes it.
    if (bell) {
      menu.style.left = bell.offsetLeft + 'px';
      menu.style.top = (bell.offsetTop + bell.offsetHeight + 4) + 'px';
    }
    setTimeout(function () {
      document.addEventListener('click', function outside(e) {
        var m = document.getElementById('cnoa-bell-menu');
        if (!m) { document.removeEventListener('click', outside); return; }
        if (m.contains(e.target) || (e.target.closest && e.target.closest('#cnoa-bell'))) return;
        document.removeEventListener('click', outside);
        closeBellMenu();
      });
    }, 0);
    // Mark seen. The count clears only once the server agrees.
    postJson('/customer-noa/seen', {
      email: state.email,
      submission_ids: items.map(function (it) { return String(it.submission_id); })
    }).then(function (r) {
      if (r.status !== 200) return;
      var shown = {};
      items.forEach(function (it) { shown[String(it.submission_id)] = true; });
      bellState.items = bellState.items.filter(function (it) { return !shown[String(it.submission_id)]; });
      var cnt = bellState.chipsEl && bellState.chipsEl.querySelector('#cnoa-bell .count');
      if (cnt && cnt.parentNode) cnt.parentNode.removeChild(cnt);
    });
  }

  function mountBell(chipsEl, openFn) {
    if (!visible() || !chipsEl) return;
    bellState.chipsEl = chipsEl;
    bellState.openFn = openFn || null;
    paintBell();
  }

  // 🚨 [hidden] must win over this file's own display rules (.cnoa-field is block,
  // .btn is inline-flex in the page). Without it a "hidden" Send button stays
  // on screen after a blocked address. Seen in the rendered page, not in jsdom.
  var STYLES =
    '.cnoa-modal [hidden],.cnoa-panel [hidden],.cnoa-bell-menu [hidden]{display:none !important;}' +
    '.cnoa-modal{position:fixed;inset:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:1000;}' +
    '.cnoa-modal-box{background:#fff;border-radius:10px;padding:16px;width:min(560px,94vw);max-height:90vh;overflow:auto;}' +
    '.cnoa-field{display:block;font-size:12px;margin-top:8px;}' +
    '.cnoa-field span{display:block;font-weight:600;margin-bottom:3px;}' +
    '.cnoa-field input{width:100%;font-size:12px;padding:5px 7px;box-sizing:border-box;}' +
    '.cnoa-field input[disabled]{background:#f1f1f1;color:#555;border:1px solid #ddd;cursor:not-allowed;}' +
    '.cnoa-check{font-size:12px;margin-top:4px;padding:3px 6px;border-radius:4px;}' +
    '.cnoa-check-block{background:#fdecea;color:#c62828;}' +
    '.cnoa-preview-frame{width:100%;height:260px;border:1px solid #ddd;border-radius:6px;margin-top:8px;}' +
    '.cnoa-modal-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;margin-top:12px;}' +
    '.chip.cnoa-bell{border-color:#b8d4f0;background:#eaf3fc;color:#0d4a8a;cursor:pointer;}' +
    '.cnoa-bell-menu{position:absolute;z-index:900;background:#fff;border:1px solid #ddd;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.12);padding:4px;min-width:260px;margin-top:4px;}' +
    '.cnoa-bell-item{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;text-align:left;background:none;border:0;border-radius:6px;padding:6px 8px;font-size:12px;cursor:pointer;}' +
    '.cnoa-bell-item:hover{background:#f5f7fa;}' +
    '.cnoa-bell-line{font-size:11px;font-weight:600;padding:1px 6px;border-radius:8px;}' +
    '.cnoa-toast{position:fixed;bottom:16px;right:16px;background:#1f2937;color:#fff;font-size:12px;border-radius:6px;padding:0;z-index:1001;}' +
    '.cnoa-toast:not(:empty){padding:8px 12px;}' +
    '.cnoa-panel{border:1px solid #e3e3e3;border-radius:8px;padding:10px 12px;margin-bottom:14px;}' +
    '.cnoa-panel-head{font-weight:700;font-size:13px;margin-bottom:4px;}' +
    '.cnoa-sub{font-size:12px;color:#777;margin-top:4px;}' +
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
    panelHtml: panelHtml, wirePanel: wirePanel, canSend: canSend,
    openSendForm: openSendForm, checkText: checkText, mountBell: mountBell,
    esc: esc, _state: state, _config: config
  };
  if (typeof window !== 'undefined') { window.OperFiCustomerNoa = api; }
})();
