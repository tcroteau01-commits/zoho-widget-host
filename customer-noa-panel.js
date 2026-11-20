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

  // ── Send form ──────────────────────────────────────────────────────────
  // Copied from the 11-03 hand-off table. There is no override for a block.
  var CHECK_TEXT = {
    free_mail: "Free email address (Gmail, Yahoo...). Use the customer's company address.",
    lookalike_domain: "Looks like the customer's domain but is not.",
    client_domain: "That is your own company's address.",
    client_user: "That is your own company's address.",
    credit_contact: 'That is the credit contact, not accounts payable.',
    bad_email: 'Not a valid email address.',
    domain_mismatch: "Does not match the customer's verified domain. Allowed, but OperFi will verify by phone.",
    role_address: 'AP role address. Good.'
  };
  function checkText(code) { return CHECK_TEXT[code] || "This address can't be used for an NOA."; }

  var SEND_ERRORS = {
    no_master: "We don't have a signed NOA on file for your company yet. OperFi will reach out.",
    bad_state: 'This customer has already acknowledged or confirmed the NOA.'
  };
  function errorText(r) {
    if (r.status === 403) return "You don't have permission to send NOAs. Ask your account owner.";
    if (r.status === 503 || r.status === 0) return 'Sending is unavailable right now. Try again in a few minutes.';
    return SEND_ERRORS[r.body && r.body.error] || 'Something went wrong. Try again.';
  }

  function checksHtml(checks) {
    if (!checks) return '';
    var out = '';
    (checks.blocks || []).forEach(function (c) { out += '<div class="cnoa-check cnoa-check-block">' + esc(checkText(c)) + '</div>'; });
    (checks.warnings || []).forEach(function (c) { out += '<div class="cnoa-check cnoa-check-warn">' + esc(checkText(c)) + '</div>'; });
    (checks.positives || []).forEach(function (c) { out += '<div class="cnoa-check cnoa-check-ok">' + esc(checkText(c)) + '</div>'; });
    return out;
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

  function openSendForm(id) {
    if (!visible() || typeof document === 'undefined') return;
    id = String(id);
    closeSendForm();
    var m = document.createElement('div');
    m.id = 'cnoa-send-modal';
    m.className = 'cnoa-modal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.innerHTML =
      '<div class="cnoa-modal-box">' +
        '<div class="cnoa-panel-head">Send customer NOA ' + (isPreview() ? PREVIEW_TAG : '') + '</div>' +
        '<label class="cnoa-field"><span>Send to</span><select name="cnoa-s-contact"></select></label>' +
        '<div id="cnoa-s-new" class="cnoa-add">' +
          '<input name="cnoa-s-email" type="email" placeholder="AP email">' +
          '<input name="cnoa-s-name" type="text" placeholder="Name">' +
          '<input name="cnoa-s-phone" type="tel" placeholder="Phone">' +
          '<input name="cnoa-s-role" type="text" placeholder="Role (e.g. AP)">' +
        '</div>' +
        '<label class="cnoa-field"><span>Note (optional)</span><textarea name="cnoa-s-note" rows="2"></textarea></label>' +
        '<div id="cnoa-checks"></div>' +
        '<div id="cnoa-send-msg" class="cnoa-msg" role="status"></div>' +
        '<iframe id="cnoa-preview-frame" class="cnoa-preview-frame" sandbox="" title="NOA email preview" hidden></iframe>' +
        '<div class="cnoa-modal-actions">' +
          '<button type="button" class="btn" id="cnoa-cancel">Cancel</button>' +
          '<button type="button" class="btn" id="cnoa-change-address" hidden>Use a different address</button>' +
          '<button type="button" class="btn" id="cnoa-preview">Preview email</button>' +
          '<button type="button" class="btn" id="cnoa-send-operfi">Have OperFi send it for me</button>' +
          '<button type="button" class="btn primary" id="cnoa-send-self">Send now</button>' +
        '</div>' +
        '<div class="cnoa-sub">Have OperFi send it: OperFi sends it for you. Nothing is emailed until we do.</div>' +
      '</div>';
    document.body.appendChild(m);

    var q = function (sel) { return m.querySelector(sel); };
    var sel = q('[name="cnoa-s-contact"]');
    var newBox = q('#cnoa-s-new');
    var msg = q('#cnoa-send-msg');
    var checksEl = q('#cnoa-checks');
    var frame = q('#cnoa-preview-frame');
    var actionBtns = ['#cnoa-preview', '#cnoa-send-operfi', '#cnoa-send-self'].map(q);
    var busy = false;

    function fillContacts(list) {
      list = list || [];
      var opts = list.map(function (c, i) {
        return '<option value="' + i + '"' + (c.primary ? ' selected' : '') + '>' +
          esc(c.email + (c.name ? ' (' + c.name + ')' : '')) + '</option>';
      });
      opts.push('<option value="__new"' + (list.length ? '' : ' selected') + '>New contact...</option>');
      sel.innerHTML = opts.join('');
      newBox.hidden = sel.value !== '__new';
    }
    sel.addEventListener('change', function () { newBox.hidden = sel.value !== '__new'; });

    if (contactsBySub[id]) fillContacts(contactsBySub[id]);
    else {
      fillContacts([]);
      getWithStatus('/customer-noa/contacts?email=' + encodeURIComponent(state.email) +
                    '&submission_id=' + encodeURIComponent(id)).then(function (r) {
        if (r.status === 200 && document.getElementById('cnoa-send-modal') === m) {
          contactsBySub[id] = r.body.contacts || [];
          fillContacts(contactsBySub[id]);
        }
      });
    }

    function contact() {
      if (sel.value !== '__new') {
        var c = (contactsBySub[id] || [])[parseInt(sel.value, 10)] || {};
        return { email: c.email || '', name: c.name || '', phone: c.phone || '', role: c.role || '' };
      }
      var v = function (n) { return q('[name="cnoa-s-' + n + '"]').value.trim(); };
      return { email: v('email'), name: v('name'), phone: v('phone'), role: v('role') };
    }
    function note() { return q('[name="cnoa-s-note"]').value.trim(); }

    function setBusy(on) {
      busy = on;
      actionBtns.forEach(function (b) { b.disabled = on; });
    }
    function blocked(checks) {
      checksEl.innerHTML = checksHtml(checks);
      msg.textContent = 'Use a different address.';
      actionBtns.forEach(function (b) { b.hidden = true; });
      q('#cnoa-change-address').hidden = false;
    }

    q('#cnoa-cancel').addEventListener('click', closeSendForm);
    q('#cnoa-change-address').addEventListener('click', function () {
      sel.value = '__new';
      newBox.hidden = false;
      checksEl.innerHTML = '';
      msg.textContent = '';
      actionBtns.forEach(function (b) { b.hidden = false; });
      q('#cnoa-change-address').hidden = true;
      var e = q('[name="cnoa-s-email"]'); if (e) e.focus();
    });

    q('#cnoa-preview').addEventListener('click', function () {
      if (busy) return;
      var c = contact();
      if (!c.email) { msg.textContent = 'Choose or enter an AP email address.'; return; }
      setBusy(true);
      msg.textContent = '';
      postJson('/customer-noa/preview', {
        email: state.email, submission_id: id, contact: { email: c.email, name: c.name }, note: note()
      }).then(function (r) {
        setBusy(false);
        if (r.status === 200) {
          checksEl.innerHTML = checksHtml(r.body.checks);
          frame.setAttribute('srcdoc', String(r.body.html || ''));   // sandboxed, never innerHTML
          frame.hidden = false;
          if (r.body.checks && (r.body.checks.blocks || []).length) blocked(r.body.checks);
        } else {
          msg.textContent = errorText(r);
        }
      });
    });

    function send(mode) {
      if (busy) return;
      var c = contact();
      if (!c.email) { msg.textContent = 'Choose or enter an AP email address.'; return; }
      setBusy(true);
      msg.textContent = '';
      postJson('/customer-noa/send', {
        email: state.email, submission_id: id, contact: c, note: note(), mode: mode
      }).then(function (r) {
        setBusy(false);
        if (r.status === 200) {
          closeSendForm();
          toast(mode === 'operfi' ? 'Request sent. OperFi will send it.' : 'NOA sent to ' + c.email);
          refreshChip(id);
        } else if (r.status === 409 && r.body.error === 'blocked_contact') {
          blocked(r.body.checks);
        } else {
          msg.textContent = errorText(r);
        }
      });
    }
    q('#cnoa-send-self').addEventListener('click', function () { send('self'); });
    q('#cnoa-send-operfi').addEventListener('click', function () { send('operfi'); });
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

  var STYLES =
    '.cnoa-modal{position:fixed;inset:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:1000;}' +
    '.cnoa-modal-box{background:#fff;border-radius:10px;padding:16px;width:min(560px,94vw);max-height:90vh;overflow:auto;}' +
    '.cnoa-field{display:block;font-size:12px;margin-top:8px;}' +
    '.cnoa-field span{display:block;font-weight:600;margin-bottom:3px;}' +
    '.cnoa-field select,.cnoa-field textarea{width:100%;font-size:12px;padding:4px 6px;box-sizing:border-box;}' +
    '.cnoa-check{font-size:12px;margin-top:4px;padding:3px 6px;border-radius:4px;}' +
    '.cnoa-check-block{background:#fdecea;color:#c62828;}' +
    '.cnoa-check-warn{background:#fff8e1;color:#8a5a00;}' +
    '.cnoa-check-ok{background:#e8f5e9;color:#1f6321;}' +
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
    openSendForm: openSendForm, checkText: checkText, mountBell: mountBell,
    esc: esc, _state: state, _config: config
  };
  if (typeof window !== 'undefined') { window.OperFiCustomerNoa = api; }
})();
