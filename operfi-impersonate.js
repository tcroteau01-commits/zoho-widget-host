/* OperFi portal admin impersonation. Include once per logged-in widget:
   <script src="https://tcroteau01-commits.github.io/zoho-widget-host/operfi-impersonate.js?v=1"></script>
   For admins it renders a top admin bar with a client picker; the choice (a client
   contact email) is stored in localStorage and appended as ?impersonate= to every
   broker-API call by the fetch wrapper below. Non-admins are unaffected. */
(function () {
  var API_HOST = 'operfi-broker-api.onrender.com';
  var KEY = 'operfiImpersonate';

  function target(){ try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }

  // wrap fetch immediately so it's in place before widget code runs
  var _fetch = window.fetch ? window.fetch.bind(window) : null;
  if (_fetch) {
    window.fetch = function (url, opts) {
      try {
        var imp = target();
        if (imp && typeof url === 'string' && url.indexOf(API_HOST) !== -1) {
          url += (url.indexOf('?') === -1 ? '?' : '&') + 'impersonate=' + encodeURIComponent(imp);
        }
      } catch (e) {}
      return _fetch(url, opts);
    };
  }

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

  function renderAdminBar(info) {
    if (!info || !info.is_admin) return;
    if (document.getElementById('operfi-admin-bar')) return;
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
      + '<input id="operfi-imp-search" placeholder="' + (curName ? esc(curName) : 'Select a client&hellip;') + '" '
      + 'style="flex:0 0 260px;padding:6px 10px;border-radius:6px;border:0;font:inherit" autocomplete="off">'
      + (cur ? '<button id="operfi-imp-exit" style="margin-left:auto;background:#33425f;color:#fff;border:0;padding:6px 12px;border-radius:6px;cursor:pointer">Exit</button>' : '')
      + '<div id="operfi-imp-list" style="display:none;position:absolute;top:42px;left:120px;width:320px;max-height:300px;overflow:auto;background:#fff;color:#101828;border-radius:8px;box-shadow:0 8px 24px rgba(16,24,40,.25)"></div>';
    document.body.appendChild(bar);
    document.body.style.marginTop = '44px';

    var search = document.getElementById('operfi-imp-search');
    var list = document.getElementById('operfi-imp-list');
    function paint(q) {
      q = (q || '').toLowerCase();
      var rows = clients.filter(function (c) { return !q || (c.name || '').toLowerCase().indexOf(q) !== -1; }).slice(0, 50);
      list.innerHTML = rows.map(function (c) {
        return '<div data-email="' + esc(c.contact_email) + '" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #f2f4f7">' + esc(c.name) + '</div>';
      }).join('') || '<div style="padding:8px 12px;color:#667085">No match</div>';
      list.style.display = 'block';
    }
    search.addEventListener('focus', function () { paint(search.value); });
    search.addEventListener('input', function () { paint(search.value); });
    list.addEventListener('click', function (e) {
      var row = e.target.closest('[data-email]'); if (!row) return;
      try { localStorage.setItem(KEY, row.getAttribute('data-email')); } catch (x) {}
      location.reload();
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
          .then(function (info) { renderAdminBar(info); })
          .catch(function () {});
      });
    } catch (e) {}
  }

  window.OPERFI_IMP = { renderAdminBar: renderAdminBar, target: target, esc: esc };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
