/* CNOA NOA Center: pure helpers. No DOM, no fetch. Loaded by noa-center.html as a
   plain script (window.NoaCenter) and by the tests through require. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NoaCenter = api;
})(typeof window !== 'undefined' ? window : this, function () {
  var CHIPS = {
    not_sent: 'Not sent', sent: 'Sent', viewed: 'Viewed', acknowledged: 'Acknowledged',
    confirmed: 'Confirmed', action_needed: 'Action needed', grandfathered: 'Grandfathered',
    released: 'Released'
  };
  var FLAGS = {
    verify: 'Needs verification call', stale: 'No response in 7 days', bounce: 'Bounced',
    reply: 'AP replied by email', dispute: 'Question or dispute', vendor_setup: 'Vendor setup / W-9',
    contact_review: 'AP named a contact to review', operfi_send: 'Client asked OperFi to send',
    open_payables: 'Open payables reported'
  };
  var CHECKS = {
    free_mail: 'Free email address (Gmail, Yahoo, ...)', lookalike_domain: 'Looks like the debtor domain but is not',
    client_domain: "The client's own domain", client_user: "One of the client's portal users",
    credit_contact: 'The credit-check contact, not AP', bad_email: 'Not a valid email address',
    domain_mismatch: "Does not match the debtor's verified domain",
    verified_domain_match: "Matches the debtor's verified domain", directory_match: 'Confirmed before in the directory',
    role_address: 'An AP role address (ap@, payables@)'
  };
  var NUMBER_SOURCES = [
    { value: 'creditsafe', label: 'Creditsafe report' },
    { value: 'debtor_website', label: "Debtor's own website" },
    { value: 'fmcsa', label: 'FMCSA record' },
    { value: 'directory', label: 'NOA directory (confirmed before)' },
    { value: 'other_independent', label: 'Other independent source' }
  ];

  function chipLabel(status) { return CHIPS[status] || status; }
  function flagLabel(flag) { return FLAGS[flag] || flag; }
  function waitingOnText(row) { return row && row.waiting_on ? 'Waiting on ' + row.waiting_on : ''; }
  function confirmAllowed(source) {
    return NUMBER_SOURCES.some(function (s) { return s.value === source; });
  }
  function renderChecks(checks) {
    if (!checks) return [];
    var out = [];
    [['blocks', 'block'], ['warnings', 'warning'], ['positives', 'positive']].forEach(function (p) {
      (checks[p[0]] || []).forEach(function (code) { out.push({ level: p[1], code: code, text: CHECKS[code] || code }); });
    });
    return out;
  }
  var SKIPS = { free_mail: 'Free email address, not sent', no_address: 'No AP address on file',
                bad_email: 'Address is not valid' };
  function norm(s) { return String(s || '').split(/\s+/).filter(Boolean).join(' ').toLowerCase(); }
  function nameMatches(typed, name) { return !!norm(name) && norm(typed) === norm(name); }
  function skipLabel(code) { return SKIPS[code] || code || ''; }
  function summaryText(s) {
    s = s || {};
    return (s.sent || 0) + ' sent, ' + (s.skipped || 0) + ' skipped, ' + (s.bounced || 0) + ' bounced, ' +
      (s.acknowledged || 0) + ' acknowledged, ' + (s.confirmed || 0) + ' confirmed, ' +
      (s.open_payables || 0) + ' open payables ($' + Number(s.open_amount_total || 0).toFixed(2) + ')';
  }
  var LOR_STATUS = {
    waiting_ar: 'Waiting on AR', requested: 'To review', approved: 'Approved, sending', sent: 'Sent',
    rejected: 'Rejected', expired: 'Expired', failed: 'Failed to send'
  };
  var SEND_TO_SOURCES = { noa_record: 'Confirmed NOA contact', directory: 'NOA directory',
                          fv_email_noa: 'FactorView NOA email', fv_email_billing: 'FactorView billing email' };
  function lorStatusLabel(status) { return LOR_STATUS[status] || status; }
  function money(n) { return '$' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function sendToSourceLabel(src) {
    if (!src) return 'No address';
    if (String(src).indexOf('staff:') === 0) return 'Staff (' + String(src).slice(6) + ')';
    return SEND_TO_SOURCES[src] || src;
  }
  function lorArText(check) {
    if (!check) return 'Not checked';
    if (check.unknown) return 'Balance unknown';
    var t = money(check.open_balance) + ' open';
    if (check.pending_loads) t += ', ' + check.pending_loads + ' load(s) in flight';
    return t;
  }
  function lorRowView(row) {
    row = row || {};
    var check = row.last_ar_check || null;
    var flags = [];
    if (row.ar_unknown || (check && check.unknown)) flags.push('AR unknown');
    if (row.remit_changed) flags.push('Remit changed by client');
    if (!row.send_to) flags.push('No send-to address');
    if (row.verify_reply) flags.push('Debtor replied');
    if (row.fv_block_pending) flags.push('Block in FV');
    return { client: (row.client || {}).name || '', debtor: (row.debtor || {}).name || 'General release',
             status: lorStatusLabel(row.status), ar: lorArText(check), arUnknown: !!(check && check.unknown) || !!row.ar_unknown,
             flags: flags, canReview: row.status === 'requested' };
  }
  function ageText(days) {
    if (!days) return 'today';
    return days === 1 ? '1 day' : days + ' days';
  }
  return { chipLabel: chipLabel, flagLabel: flagLabel, waitingOnText: waitingOnText,
           confirmAllowed: confirmAllowed, renderChecks: renderChecks, ageText: ageText,
           nameMatches: nameMatches, skipLabel: skipLabel, summaryText: summaryText,
           lorStatusLabel: lorStatusLabel, lorArText: lorArText, lorRowView: lorRowView,
           sendToSourceLabel: sendToSourceLabel, NUMBER_SOURCES: NUMBER_SOURCES };
});
