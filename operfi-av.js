/* OperFi Account/Vendor surfacing — reusable carrier vetting badge + customer
 * credit callout. Warn-only. Reads /noa-status and /funding-credit.
 *
 *   OperFiAV.carrierBadge(containerEl, { vendorId, email, apiBase });
 *   OperFiAV.customerCredit(containerEl, { customerId, email, apiBase });
 *
 * email/apiBase fall back to window.brokerEmail / window.BROKER_API_BASE.
 */
(function (global) {
  var STYLE_ID = 'opf-av-styles';
  function injectStyles() {
    if (global.document.getElementById(STYLE_ID)) return;
    var s = global.document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '.opf-av-badges{display:flex;flex-wrap:wrap;gap:6px;align-items:center}' +
      '.opf-av-badge{font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;border:1px solid}' +
      '.opf-av-ok{background:#e8f5e9;color:#2e7d32;border-color:#bfe3c2}' +
      '.opf-av-terms{background:#f3f4f6;color:#374151;border-color:#e1e3e8}' +
      '.opf-av-warn{background:#fff8e1;color:#856404;border-color:#ffe082}' +
      '.opf-av-dnu{background:#ffebee;color:#c62828;border-color:#ef9a9a}' +
      '.opf-av-credit{border-radius:10px;padding:12px 14px;border:1px solid;display:flex;align-items:center;gap:14px;font-size:12px}' +
      '.opf-av-credit .lead{font-weight:700}' +
      '.opf-av-credit .bar{flex:1;max-width:180px;height:8px;border-radius:999px;background:#0001;overflow:hidden}' +
      '.opf-av-credit .bar i{display:block;height:100%}' +
      '.opf-av-credit.ok{background:#f3faf4;border-color:#cfe9d2;color:#2e7d32}' +
      '.opf-av-credit.amber{background:#fff9ed;border-color:#f0e2c4;color:#8a6d1b}' +
      '.opf-av-credit.red{background:#fdf4f4;border-color:#f0d3d3;color:#a3322b}' +
      '.opf-av-credit.muted{background:#fafafa;border-color:#eee;color:#888;font-style:italic}';
    global.document.head.appendChild(s);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]); }); }
  function resolveEmail(opts) { var e = opts.email; if (typeof e === 'function') e = e(); return e || global.brokerEmail || ''; }
  function resolveBase(opts) { return opts.apiBase || global.BROKER_API_BASE || ''; }
  function num(v) { return parseFloat(String(v == null ? '' : v).replace(/[%,$\s]/g, '')) || 0; }

  var _carrierCache = {};
  function carrierBadge(el, opts) {
    if (!el) return;
    opts = opts || {};
    var vid = opts.vendorId, usdot = opts.usdot;
    var key, queryParam;
    if (vid) {
      key = 'v' + vid;
      queryParam = '&vendor_id=' + encodeURIComponent(vid);
    } else if (usdot) {
      key = 'u' + usdot;
      queryParam = '&usdot=' + encodeURIComponent(usdot);
    } else {
      el.innerHTML = ''; return;
    }
    el._opfVid = key;
    injectStyles();
    var email = resolveEmail(opts), base = resolveBase(opts);
    var showAuthority = opts.authorityChip !== false;
    function render(row) {
      if (el._opfVid !== key) return;  // selection changed — drop stale response
      el.innerHTML = carrierHtml(row, showAuthority);
    }
    if (_carrierCache[key]) { render(_carrierCache[key]); return; }
    global.fetch(base + '/noa-status?email=' + encodeURIComponent(email) + queryParam)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { var row = (d && d.carriers && d.carriers[0]) || null; if (row) _carrierCache[key] = row; render(row); })
      .catch(function () { /* leave empty */ });
  }
  // Exception-only: render only the backend's vetting_flags (Denied, Do Not Use,
  // Payment Change, Missing NOA, Missing Bank Document, Bank Info). A clean carrier
  // shows no status badge — just pay terms + factor as plain info. We do NOT show
  // "approved/pending/good-to-book" reassurance, and the old pay-term NOA heuristic
  // is gone — the authoritative signals come from the Vendor record server-side.
  function carrierHtml(row, showAuthority) {
    if (!row) return '';
    var out = '<div class="opf-av-badges">';
    var flags = row.vetting_flags || [];
    for (var i = 0; i < flags.length; i++) {
      var cls = flags[i].level === 'danger' ? 'opf-av-dnu' : 'opf-av-warn';
      out += '<span class="opf-av-badge ' + cls + '">⚠ ' + esc(flags[i].label || '') + '</span>';
    }
    if (showAuthority !== false) {
      if (row.authority_class === 'dual') {
        out += '<span class="opf-av-badge opf-av-dnu">⚠ Dual authority: double-broker risk</span>';
      } else if (row.authority_class === 'broker_only') {
        out += '<span class="opf-av-badge opf-av-dnu">⚠ Broker authority, not a carrier</span>';
      }
    }
    if (row.pay_term) out += '<span class="opf-av-badge opf-av-terms">Pay terms: ' + esc(row.pay_term) + '</span>';
    if (row.factoring_company) out += '<span class="opf-av-badge opf-av-terms">Factor: ' + esc(row.factoring_company) + '</span>';
    out += '</div>';
    return out;
  }

  var _creditCache = {};
  function customerCredit(el, opts) {
    if (!el) return;
    opts = opts || {};
    var cid = opts.customerId;
    if (!cid) { el.innerHTML = ''; return; }
    el._opfCid = String(cid);
    injectStyles();
    var email = resolveEmail(opts), base = resolveBase(opts);
    function render(d) {
      if (el._opfCid !== String(cid)) return;  // selection changed — drop stale response
      el.innerHTML = creditHtml(d);
    }
    if (_creditCache[cid]) { render(_creditCache[cid]); return; }
    global.fetch(base + '/funding-credit?email=' + encodeURIComponent(email) + '&customer_id=' + encodeURIComponent(cid))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) _creditCache[cid] = d; render(d); })
      .catch(function () { el.innerHTML = creditHtml(null); });
  }
  function creditHtml(d) {
    if (!d || !d.available) return '<div class="opf-av-credit muted">Credit availability unavailable</div>';
    var pct = num(d.Percent_Used);
    var cls = pct >= 100 ? 'red' : (pct >= 80 ? 'amber' : 'ok');
    var lead = pct >= 100 ? '⚠ Over credit limit' : (pct >= 80 ? '⚠ Near credit limit' : 'Credit OK');
    var barColor = pct >= 100 ? '#c0392b' : (pct >= 80 ? '#c8951f' : '#2e7d32');
    var barW = Math.max(0, Math.min(100, pct));
    return '<div class="opf-av-credit ' + cls + '">' +
      '<div class="lead">' + lead + '</div>' +
      '<div class="bar"><i style="width:' + barW + '%;background:' + barColor + '"></i></div>' +
      '<div class="nums">' + esc(d.Percent_Used) + ' used · <b>$' + esc(d.Remaining_Credit) + '</b> remaining of $' + esc(d.Buy_Limit) + '</div>' +
      '</div>';
  }

  global.OperFiAV = { carrierBadge: carrierBadge, customerCredit: customerCredit, _carrierHtml: carrierHtml };
})(window);
