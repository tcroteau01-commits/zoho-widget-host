/* COIHOLD1: the contingent cargo hold on the purchase pages (Quick Submit, Draft Loads,
 * TMS Load Detail). The server is the gate: /funding-submit, /funding-finalize, /tms-submit
 * and /draft-loads/submit answer 403 {error: "coi_hold", message}. This only tells the broker
 * before they fill the form, and turns that 403 into the message instead of "coi_hold".
 *
 *   OperFiCoiHold.check({ email, apiBase }) -> Promise<hold | null>
 *   OperFiCoiHold.render(el, hold)          -> fills (or hides) the banner
 *   OperFiCoiHold.refusal(json)             -> the message for a coi_hold response, else null
 *
 * A failed check resolves null, the same as the server failing open: a network blip must not
 * gray out the submit button. email/apiBase fall back to window.brokerEmail / BROKER_API_BASE.
 */
(function (global) {
  var EMAIL = 'insurance@operfi.com';
  var FALLBACK = 'We need a current certificate of insurance showing contingent cargo coverage before we can ' +
    'fund your invoices. Please have your insurance agent email it to ' + EMAIL + '.';
  var STYLE =
    'background:#fdf4f4;border:1px solid #f0d3d3;color:#a3322b;border-radius:8px;' +
    'padding:12px 16px;margin-bottom:14px;font-size:13px;line-height:1.45';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]); }); }

  function check(opts) {
    opts = opts || {};
    var email = opts.email || global.brokerEmail || '';
    var base = opts.apiBase || global.BROKER_API_BASE || '';
    if (!email) return Promise.resolve(null);
    return global.fetch(base + '/coi-hold?email=' + encodeURIComponent(email))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return (d && d.hold) || null; })
      .catch(function () { return null; });
  }

  function html(hold) {
    var msg = esc((hold && hold.message) || FALLBACK)
      .replace(EMAIL, '<a href="mailto:' + EMAIL + '" style="color:inherit;font-weight:700">' + EMAIL + '</a>');
    return '<div style="font-weight:700;margin-bottom:2px">Funding on hold: contingent cargo insurance needed</div>' + msg;
  }

  function render(el, hold) {
    if (!el) return;
    if (!hold) { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.setAttribute('style', STYLE);
    el.setAttribute('role', 'alert');
    el.innerHTML = html(hold);
  }

  function refusal(json) {
    return json && json.error === 'coi_hold' ? (json.message || FALLBACK) : null;
  }

  global.OperFiCoiHold = { check: check, render: render, refusal: refusal, _html: html };
})(window);
