// credit-app-fraud-panel.js
// CREDFRAUD1: the whole-application fraud verdict for OperFi staff.
// Pure render, no network. Data comes from /credit-app/risk (staff-only).
// Loaded by customer-approvals.html; on the portal it must be in
// broker_portal.ALLOWED_ASSETS or it 404s silently.
(function () {
  var LEVELS = {
    high: 'High fraud risk',
    review: 'Some fraud signals',
    clean: 'No fraud signals',
    unknown: 'Fraud check incomplete'
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function cell(value, repeated) {
    if (value == null || value === '') return '<td class="cfp-muted">-</td>';
    var cls = repeated ? ' class="cfp-repeat" title="Same as another party"' : '';
    return '<td><span' + cls + '>' + esc(value) + '</span></td>';
  }

  function time(iso) {
    if (!iso) return '';
    return String(iso).replace('T', ' ').slice(0, 16) + ' UTC';
  }

  function has(list, v) { return !!v && (list || []).indexOf(v) !== -1; }

  function render(fraud) {
    if (!fraud || !fraud.level) return '';
    var rep = fraud.repeats || {};
    var html = '<div class="cfp">';
    html += '<div class="cfp-head cfp-level-' + esc(fraud.level) + '">' +
      esc(LEVELS[fraud.level] || fraud.level) + '</div>';
    var reasons = fraud.reasons || [];
    if (reasons.length) {
      html += '<ul class="cfp-reasons">' + reasons.map(function (r) {
        return '<li class="cfp-' + esc(r.strength) + '">' + esc(r.text) + '</li>';
      }).join('') + '</ul>';
    }
    var parties = fraud.parties || [];
    if (parties.length) {
      html += '<div class="cfp-scroll"><table class="cfp-table"><thead><tr>' +
        '<th>Party</th><th>Email domain</th><th>Domain age</th><th>Opened</th><th>Submitted</th>' +
        '<th>Minutes</th><th>IP</th><th>Network</th><th>Browser</th><th>Phone carrier</th>' +
        '</tr></thead><tbody>';
      parties.forEach(function (p) {
        var ip = p.ip_captured ? p.ip : 'not captured (before 10-09 fix)';
        var net = p.network ? p.network + (p.connection_type ? ', ' + p.connection_type : '') : '';
        html += '<tr>' +
          '<td><strong>' + esc(p.label) + '</strong><div class="cfp-muted">' + esc(p.company) + '</div></td>' +
          cell(p.email_domain, false) +
          cell(p.domain_age_days == null ? '' : p.domain_age_days + ' days', false) +
          cell(time(p.opened_at), false) +
          cell(time(p.completed_at), false) +
          cell(p.minutes_open_to_submit == null ? '' : String(p.minutes_open_to_submit), false) +
          cell(ip, has(rep.ip, p.ip)) +
          cell(net, false) +
          cell(p.browser, has(rep.user_agent, p.user_agent)) +
          cell(p.phone_carrier, has(rep.phone_carrier, p.phone_carrier)) +
          '</tr>';
      });
      html += '</tbody></table></div>';
    }
    return html + '</div>';
  }

  var STYLES =
    '.cfp{margin:0 0 16px;}' +
    '.cfp-head{font-weight:700;font-size:14px;padding:8px 12px;border-radius:8px;}' +
    '.cfp-level-high{background:#fdecea;color:#c62828;}' +
    '.cfp-level-review{background:#fff4e0;color:#b25e00;}' +
    '.cfp-level-clean{background:#e8f5e9;color:#2e7d32;}' +
    '.cfp-level-unknown{background:#eee;color:#666;}' +
    '.cfp-reasons{margin:8px 0 10px 18px;padding:0;font-size:12.5px;}' +
    '.cfp-reasons li{margin:3px 0;}' +
    '.cfp-reasons li.cfp-supporting{color:#777;}' +
    '.cfp-scroll{overflow-x:auto;}' +
    '.cfp-table{border-collapse:collapse;font-size:12px;width:100%;}' +
    '.cfp-table th,.cfp-table td{border-bottom:1px solid #eee;padding:5px 8px;text-align:left;vertical-align:top;white-space:nowrap;}' +
    '.cfp-table th{color:#555;font-weight:600;}' +
    '.cfp-repeat{background:#fdecea;color:#c62828;font-weight:700;padding:1px 4px;border-radius:4px;}' +
    '.cfp-muted{color:#999;font-size:11px;}';

  function injectStyles() {
    if (typeof document === 'undefined' || document.getElementById('cfp-styles')) return;
    var s = document.createElement('style');
    s.id = 'cfp-styles';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  var api = { render: render, injectStyles: injectStyles, esc: esc };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.OperFiCreditFraudPanel = api; }
})();
