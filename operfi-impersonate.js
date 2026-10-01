/* OperFi portal admin impersonation. Include once per logged-in widget:
   <script src="https://app.operfi.com/operfi-impersonate.js?v=1"></script>
   For admins it renders a top admin bar with a client picker; the choice (a client
   contact email) is stored in localStorage and appended as ?impersonate= to every
   broker-API call by the fetch wrapper below. Non-admins are unaffected. */
(function () {
  var API_HOST = 'operfi-broker-api.onrender.com';
  var KEY = 'operfiImpersonate';
  var staff = false;          // set once /whoami confirms an OperFi admin

  function target(){ try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }

  // Append the impersonate target to a backend URL. Safe to call on any URL:
  // no-op when no target is set, when the URL isn't a backend call, or when
  // impersonate= is already present. Used by the fetch wrapper AND by widgets
  // that download via window.open() (which bypasses the fetch wrapper).
  function decorate(url){
    try {
      var imp = target();
      // Never blob:/data: -- on /portal/w/ API_HOST is the page's own host, so a
      // page-minted blob URL contains it and a query string breaks the lookup.
      if (imp && typeof url === 'string' && !/^(blob|data):/i.test(url) &&
          url.indexOf(API_HOST) !== -1 && url.indexOf('impersonate=') === -1) {
        return url + (url.indexOf('?') === -1 ? '?' : '&') + 'impersonate=' + encodeURIComponent(imp);
      }
    } catch (e) {}
    return url;
  }

  // wrap fetch immediately so it's in place before widget code runs
  var _fetch = window.fetch ? window.fetch.bind(window) : null;
  if (_fetch) {
    window.fetch = function (url, opts) {
      return _fetch(decorate(url), opts);
    };
  }

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

  function renderAdminBar(info) {
    if (!info || !info.is_admin) return;
    if (document.getElementById('operfi-admin-bar')) return;
    if (!document.getElementById('operfi-imp-style')) {
      var st = document.createElement('style');
      st.id = 'operfi-imp-style';
      st.textContent =
        '@media (max-width:640px){' +
        '#operfi-admin-bar{flex-wrap:wrap;gap:8px;padding:8px 10px}' +
        '#operfi-imp-search{flex:1 1 100%;min-width:0}' +
        '#operfi-imp-exit{margin-left:0}' +
        '#operfi-imp-list{left:10px;right:10px;width:auto}}';
      document.head.appendChild(st);
    }
    var cur = target();
    var clients = info.clients || [];
    var bar = document.createElement('div');
    bar.id = 'operfi-admin-bar';
    bar.setAttribute('style', 'position:fixed;top:0;left:0;right:0;z-index:100000;background:#1f2a44;color:#fff;font:600 13px Inter,system-ui,sans-serif;display:flex;align-items:center;gap:12px;padding:8px 14px;box-shadow:0 2px 10px rgba(16,24,40,.25)');
    var curName = '';
    for (var i = 0; i < clients.length; i++) if (clients[i].contact_email === cur) curName = clients[i].name;
    bar.innerHTML =
      '<span style="background:#f59e0b;color:#231a02;padding:2px 8px;border-radius:6px">&#128737; OPERFI ADMIN</span>'
      + '<span>Acting as:</span>'
      + '<input id="operfi-imp-search" placeholder="' + (curName ? esc(curName) : 'All clients') + '" '
      + 'style="flex:0 0 260px;padding:6px 10px;border-radius:6px;border:0;font:inherit" autocomplete="off">'
      + (cur ? '<button id="operfi-imp-exit" style="background:#33425f;color:#fff;border:0;padding:6px 12px;border-radius:6px;cursor:pointer">Exit Client View</button>' : '')
      + '<div id="operfi-imp-list" style="display:none;position:absolute;top:42px;left:120px;width:320px;max-height:300px;overflow:auto;background:#fff;color:#101828;border-radius:8px;box-shadow:0 8px 24px rgba(16,24,40,.25)"></div>';
    document.body.appendChild(bar);
    document.body.style.marginTop = '44px';

    var search = document.getElementById('operfi-imp-search');
    var list = document.getElementById('operfi-imp-list');
    var active = -1;           // keyboard-highlighted row; -1 = none
    function paint(q) {
      q = (q || '').toLowerCase();
      var rows = clients.filter(function (c) { return !q || (c.name || '').toLowerCase().indexOf(q) !== -1; }).slice(0, 50);
      list.innerHTML = rows.map(function (c) {
        return '<div data-email="' + esc(c.contact_email) + '" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #f2f4f7">' + esc(c.name) + '</div>';
      }).join('') || '<div style="padding:8px 12px;color:#667085">No match</div>';
      list.style.display = 'block';
      active = -1;
    }
    function rowsEls() { return list.querySelectorAll('[data-email]'); }
    function highlight(i) {
      var rows = rowsEls();
      if (!rows.length) return;
      active = Math.max(0, Math.min(i, rows.length - 1));
      for (var k = 0; k < rows.length; k++) {
        rows[k].style.background = k === active ? '#fef3c7' : '';
        rows[k].setAttribute('aria-selected', k === active ? 'true' : 'false');
      }
      if (rows[active].scrollIntoView) rows[active].scrollIntoView({ block: 'nearest' });
    }
    function pick(email) {
      try { localStorage.setItem(KEY, email); } catch (x) {}
      location.reload();
    }
    // Clicking away (anywhere in the widget, the portal shell around it, or tabbing
    // off) cancels: the list closes, the typed text clears, the current client stays.
    function cancel() { list.style.display = 'none'; search.value = ''; active = -1; }
    search.addEventListener('focus', function () { paint(search.value); });
    search.addEventListener('input', function () { paint(search.value); });
    search.addEventListener('blur', cancel);
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { search.blur(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (list.style.display === 'none') paint(search.value);
        highlight(e.key === 'ArrowDown' ? active + 1 : active - 1);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        var rows = rowsEls();
        // nothing highlighted: Enter only commits when the typed text narrowed to one client
        var row = active >= 0 ? rows[active] : (rows.length === 1 ? rows[0] : null);
        if (row) pick(row.getAttribute('data-email'));
      }
    });
    // keep focus on the input while picking, so the blur above doesn't close the list first
    list.addEventListener('mousedown', function (e) { e.preventDefault(); });
    list.addEventListener('click', function (e) {
      var row = e.target.closest('[data-email]'); if (!row) return;
      pick(row.getAttribute('data-email'));
    });
    var exit = document.getElementById('operfi-imp-exit');
    if (exit) exit.addEventListener('click', function () { try { localStorage.removeItem(KEY); } catch (x) {} location.reload(); });
    paint('');                 // pre-render the full client list (hidden) so it's queryable
    list.style.display = 'none';
  }

  function init() {
    try {
      if (typeof ZOHO === 'undefined' || !ZOHO.CREATOR || !ZOHO.CREATOR.UTIL) return;
      var r = ZOHO.CREATOR.UTIL.getInitParams();
      if (!r || typeof r.then !== 'function') return;
      r.then(function (p) {
        var email = (p && (p.loginUser || p.login_user || p.email)) || '';
        if (!email) return;
        window.fetch('https://' + API_HOST + '/whoami?email=' + encodeURIComponent(email))
          .then(function (res) { return res.json(); })
          .then(function (info) { staff = !!(info && info.is_admin); renderAdminBar(info); })
          .catch(function () {});
      });
    } catch (e) {}
  }

  // Troubleshooting pointers ("open DevTools, F12") are for OperFi staff only; a
  // client gets a support line instead. Unknown (whoami not back yet, or failed)
  // counts as a client, so the failure mode is a staff member seeing the client text.
  var CLIENT_HINT = 'If this keeps happening, contact OperFi support.';
  function hint(staffText) { return staff ? staffText : CLIENT_HINT; }

  window.OPERFI_IMP = { renderAdminBar: renderAdminBar, target: target, esc: esc, decorate: decorate,
                        isStaff: function () { return staff; }, hint: hint, CLIENT_HINT: CLIENT_HINT };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
