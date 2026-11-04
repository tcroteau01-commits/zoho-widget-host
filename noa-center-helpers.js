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
    contact_review: 'AP named a contact to review', operfi_send: 'Client asked OperFi to send'
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
  function ageText(days) {
    if (!days) return 'today';
    return days === 1 ? '1 day' : days + ' days';
  }
  return { chipLabel: chipLabel, flagLabel: flagLabel, waitingOnText: waitingOnText,
           confirmAllowed: confirmAllowed, renderChecks: renderChecks, ageText: ageText,
           NUMBER_SOURCES: NUMBER_SOURCES };
});
