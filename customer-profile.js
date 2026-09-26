/* OperFi Customer Profile -- the page a credit analyst reads before approving a
 * customer for a credit limit. One payload in, one HTML string out.
 *
 * The engine already decided what it could; a broker's typed name and Creditsafe's
 * candidate list often leave real ambiguity (e.g. two OperFi book rows for the same
 * company). This view says what the engine decided and why, lets the analyst
 * resolve that ambiguity once, then shows what OperFi already knows before
 * anything a credit bureau says.
 *
 *   OperFiCustomerProfile.render(payload) -> htmlString   (pure -- no DOM, no network)
 *   OperFiCustomerProfile.mount(root, payload, handlers)  -> wires the rendered HTML
 *
 * handlers (all optional):
 *   onDecide(decision, limitValue)   -- decision is 'Approved' | 'Denied'
 *   onCsPick(connectId)
 *   onFvPick(companyId)
 *   onCsAbsent()
 *
 * ES5 only: this file is served straight to a browser inside a Creator iframe.
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// 🚨 A URL goes in an href, so escaping is NOT enough: "javascript:alert(1)"
// survives esc() intact and runs on click. These values come from a broker
// typing into a Creator form, so only http and https are ever rendered as a
// link; anything else is shown as plain text and cannot be clicked.
function link(url) {
  if (!url) { return emptyDash(); }
  var u = String(url).trim();
  if (!/^https?:\/\//i.test(u)) { return esc(u); }
  var label = u.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  return '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' +
         esc(label) + '</a>';
}

// Tom, 2026-09-25: "Can we have the address link out to google maps so they can
// see that corporate address?" Street View is how an analyst tells a warehouse
// from a mailbox store, which is a fraud signal no API returns cleanly.
function mapLink(address) {
  if (!address) { return emptyDash(); }
  var a = String(address).trim();
  return '<a href="https://www.google.com/maps/search/?api=1&query=' +
         encodeURIComponent(a) + '" target="_blank" rel="noopener noreferrer">' +
         esc(a) + '</a>';
}

function money(n) {
  // 🚨 Number(null) is 0, so without this an ABSENT limit renders as "$0" --
  // the one reading Tom called out as wrong: "$0 could just mean we dropped
  // their credit limit because we haven't purchased that customer in a while."
  // A decided zero and no limit on file are different facts to an analyst.
  if (n === null || n === undefined || n === '') { return '—'; }
  var v = Number(n);
  if (!isFinite(v)) { return '—'; }
  return '$' + Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

var ENGINE_LABELS = { auto_approve: 'Auto-Approve', review_required: 'Review Required' };

function engineLabel(suggested) {
  if (ENGINE_LABELS[suggested]) { return ENGINE_LABELS[suggested]; }
  return suggested ? String(suggested) : 'Unscored';
}

function emptyDash() {
  return '<span class="empty">—</span>';
}

function field(label, valueHtml) {
  return '' +
    '<div class="field">' +
      '<div class="field-label">' + esc(label) + '</div>' +
      '<div class="field-val">' + valueHtml + '</div>' +
    '</div>';
}

function section(title, bodyHtml, extraClass) {
  return '' +
    '<div class="panel-section' + (extraClass ? ' ' + extraClass : '') + '">' +
      '<div class="panel-section-title">' + esc(title) + '</div>' +
      bodyHtml +
    '</div>';
}

// ---- header: customer, broker, status, engine verdict, decision controls ----
// Colour carries the decision, because that is what a glance reads. Green for
// approved, red for denied, amber for waiting on the customer -- matching the
// chip the customer list already shows for the same record.
// 🚨 EVERY status gets its own colour, not just the three a person sets. A
// record sitting at "Credit App Sent - Awaiting Customer" wore the same grey
// chip as one nobody had touched, so the two read identically at a glance --
// which is the whole job of the chip.
var STATUS_TONES = {
  'approved': 'cp-status-approved',                          // green, done
  'denied': 'cp-status-denied',                              // red, done
  'pending credit application': 'cp-status-pending',         // amber, we act next
  'credit app sent - awaiting customer': 'cp-status-sent',   // blue, THEY act next
  "credit app rec'd - pending review": 'cp-status-back',     // violet, back to us
  'credit boost requested': 'cp-status-back',                // violet, back to us
  'expired': 'cp-status-expired'                             // slate, lapsed
};

function statusTone(status) {
  return STATUS_TONES[String(status || '').trim().toLowerCase()]
         || 'cp-status-open';
}

// 🚨 "Has this record moved past the opening state", NOT "is it finished".
//
// It first read approved-or-denied, then gained Pending Credit App, and both
// times the miss looked the same to Tom: the engine's stale "Review Required"
// stayed in the header beside a status the record had plainly moved on from,
// and the banner explaining that a decision already exists never appeared.
// Listing the states that COUNT keeps reproducing that bug as statuses are
// added, so the test is inverted -- only an untouched record is open.
function isDecided(status) {
  var s = String(status || '').trim().toLowerCase();
  return !!s && s !== 'awaiting credit decision';
}

function renderHeader(p) {
  var engine = p.engine;
  // 🚨 ONE status in the header. Tom, seeing APPROVED and REVIEW REQUIRED side
  // by side: "These 2 pills don't make sense either. Review Required but
  // Approved?" Once a person has decided, the engine's suggestion is history,
  // not a competing state -- it stays in the Credit Engine card below, which is
  // where a reader goes to ask how the decision was reached. The suggestion
  // belongs in the header only while the decision is still OPEN, because that is
  // the one time it tells the analyst what to do next.
  var verdictHtml = '';
  if (!isDecided(p.status)) {
    if (engine && engine.suggested) {
      var pillClass = engine.suggested === 'auto_approve' ? 'cp-pill-ok' : 'cp-pill-warn';
      verdictHtml = '<span class="cp-pill ' + pillClass + '">' +
        esc(engineLabel(engine.suggested)) + '</span>';
    } else {
      verdictHtml = '<span class="cp-pill cp-pill-muted">No automated read yet</span>';
    }
  }

  // Tom, 2026-09-25: "Show decision on both." Decision controls live in the
  // header so an analyst who has read the whole page never navigates back to act.
  var decisionHtml = '';
  if (p.can_act) {
    // 🚨 The button does NOT name an amount. It used to read "Approve $5,000"
    // from the engine's suggestion and kept saying it while Tom typed 15000 into
    // the box beside it -- the click would have approved $15,000, so the label
    // was simply wrong. The box is the amount; the button is the verb.
    var approveLabel = 'Approved';
    var prefill = '';
    if (engine && engine.suggested === 'auto_approve' && engine.limit != null) {
      var n = Math.round(Number(engine.limit));
      // The suggestion still PREFILLS, which is the useful half: a starting
      // number the analyst can accept or overwrite, and whatever ends up in the
      // box is what gets approved.
      if (isFinite(n)) { prefill = String(n); }
    }
    // 🚨 Neither button is pre-coloured. Tom: "maybe the Approved or Denied
    // buttons need to be the same color to start and they have to select their
    // decision from there." An orange Approve sitting next to a plain Denied
    // reads as the recommended action on every single customer, including the
    // ones we should refuse.
    // Three tones, not two: a binary yes/no painted Pending Credit App red, as
    // though waiting on the customer were a refusal.
    var DECIDED_TONE = { 'cp-status-approved': 'yes', 'cp-status-denied': 'no',
                         'cp-status-pending': 'wait', 'cp-status-sent': 'sent',
                         'cp-status-back': 'wait', 'cp-status-expired': 'wait' };
    var settledNote = isDecided(p.status)
      ? '<div class="cp-decided cp-decided-' +
        (DECIDED_TONE[statusTone(p.status)] || 'wait') + '">' +
        esc(p.status) + (p.submitted && p.submitted.credit_limit
          ? ' &middot; ' + esc(money(p.submitted.credit_limit)) : '') +
        ' &middot; <span class="muted">changing it below overwrites this</span></div>'
      : '';
    decisionHtml = settledNote +
      '<div class="cp-decision-row">' +
        '<button type="button" class="btn cp-decide cp-decide-approve" data-decide="Approved">' +
          esc(approveLabel) + '</button>' +
        '<button type="button" class="btn cp-decide cp-decide-deny" data-decide="Denied">Denied</button>' +
        // The third decision a person is allowed to set. Everything else --
        // app sent, received, expired, boost requested -- the system sets.
        '<button type="button" class="btn cp-decide" data-decide="Pending Credit Application">' +
          'Pending Credit App</button>' +
        '<input type="number" class="dec-input cp-limit-input" id="cp-limit" min="0" step="1" ' +
          'placeholder="Credit limit" value="' + esc(prefill) + '">' +
      '</div>';
  }

  // 🚨 Tom, 2026-09-25: "it needs to show somewhere prominent so you know who
  // you're searching for." The address in particular: it is what tells one
  // QUADREL, INC. from the other four, and it was on the page nowhere at all.
  var contactsHtml = '';
  var c = p.contacts || {};
  var s = p.submitted || {};
  contactsHtml = '' +
    '<div class="field-grid cp-header-contacts">' +
      field('Address', mapLink(s.address)) +
      field('Phone', s.phone ? esc(s.phone) : emptyDash()) +
      field('Website', link(s.website)) +
      field('LinkedIn', link(s.linkedin)) +
      field('POC', c.poc ? esc(c.poc) : emptyDash()) +
      field('POC Email', c.email ? esc(c.email) : emptyDash()) +
      field('Billing POC', c.billing_poc ? esc(c.billing_poc) : emptyDash()) +
      field('Billing Email', c.billing_email ? esc(c.billing_email) : emptyDash()) +
    '</div>';

  return '' +
    '<div class="cp-header">' +
      '<div class="cp-header-top">' +
        '<div>' +
          '<div class="cp-eyebrow">Credit Submission #' + esc(p.submission_id) + '</div>' +
          '<div class="cp-customer">' + esc(p.customer_name) + '</div>' +
          '<div class="cp-broker">Submitted by ' + esc(p.broker) + '</div>' +
        '</div>' +
        '<div class="cp-header-status">' +
          // 🚨 A settled decision must not read like an open one. Tom, after
          // denying a customer: "nothing really changed on the UI except the
          // denied bubble in the corner... if you glance quickly it looks like
          // we approved it because the DENIED bubble blends in."
          '<span class="cp-status-pill ' + esc(statusTone(p.status)) + '">' +
            esc(p.status) + '</span>' +
          verdictHtml +
        '</div>' +
      '</div>' +
      contactsHtml +
      decisionHtml +
    '</div>';
}

// ---- what the engine decided, and why ----
function renderEngine(p) {
  var e = p.engine;
  var body;
  if (!e) {
    body = '<div class="field-val muted">No automated credit read yet.</div>';
  } else {
    var reasonsHtml;
    if (e.reasons && e.reasons.length) {
      reasonsHtml = '<ul class="cp-reasons">' + e.reasons.map(function (r) {
        return '<li>' + esc(r) + '</li>';
      }).join('') + '</ul>';
    } else {
      reasonsHtml = '<div class="field-val muted">No reasons given.</div>';
    }
    // 🚨 A verdict from submit time and one from after the analyst confirmed the
    // company mean very different things. The stale one is not just old, it is
    // WRONG in a specific way: it reports "no Creditsafe record found" about a
    // company now sitting on the same page. Say which read this is.
    var fresh = /RE-EVALUATED/i.test(e.note || '');
    var basis = fresh
      ? '<span class="cp-pill cp-pill-ok">After the identity was confirmed</span>'
      : '<span class="cp-pill cp-pill-muted">At submission, before the company was confirmed</span>';
    body = '' +
      '<div class="cp-engine-basis">' + basis + '</div>' +
      '<div class="field-grid">' +
        field('Suggested', esc(engineLabel(e.suggested))) +
        field('Suggested Limit', e.limit != null ? esc(money(e.limit)) : emptyDash()) +
        field('Engine Version', e.engine_version ? esc(e.engine_version) : emptyDash()) +
        field('Evaluated', e.at ? esc(String(e.at).replace('T', ' ').slice(0, 19)) : emptyDash()) +
      '</div>' +
      '<div class="cp-reasons-wrap"><div class="field-label">Reasons</div>' + reasonsHtml +
      (fresh ? '' :
        '<div class="field-val muted cp-note">These reasons were produced before anyone ' +
        'confirmed which company this is. Confirm the Creditsafe match below and the ' +
        'engine will read the real file.</div>') +
      '</div>';
  }
  return section('Credit Engine', body);
}

// ---- let the analyst resolve the Creditsafe identity ambiguity ----
function renderIdentity(p) {
  var id = p.identity;
  var body;
  // 🚨 Both resolved states carry a way back. A binding is not a display
  // preference: "Not in Creditsafe" stops the engine searching for this
  // customer forever, and a wrong Connect ID points every future submission at
  // another company's credit file. Neither is something an analyst should be
  // stuck with because they clicked the wrong row once.
  var undoBtn = function (attr, label) {
    return p.can_act
      ? '<button type="button" class="btn cp-undo" ' + attr + '="1">' + label + '</button>'
      : '';
  };
  if (id && id.not_in_creditsafe) {
    body = '' +
      '<div class="cp-identity-resolved">' +
        '<span class="cp-badge cp-badge-muted">Not in Creditsafe</span>' +
        (id.bound_by ? '<div class="field-val muted">Marked by ' + esc(id.bound_by) + '</div>' : '') +
        '<div class="cp-cs-search-row">' +
          undoBtn('data-cs-unabsent', 'Search Creditsafe again') +
        '</div>' +
      '</div>';
  } else if (id && id.connect_id) {
    body = '' +
      '<div class="field-grid">' +
        field('Creditsafe Connect ID', esc(id.connect_id)) +
        field('FactorView Debtor ID', id.fv_debtor_id ? esc(id.fv_debtor_id) : emptyDash()) +
        field('Bound By', id.bound_by ? esc(id.bound_by) : emptyDash()) +
      '</div>' +
      '<div class="cp-cs-search-row">' +
        undoBtn('data-cs-clear', 'Wrong company? Pick again') +
      '</div>';
  } else if (p.cs_search_failed) {
    // An empty picker and a failed search must not look the same -- this is
    // "we don't know" (search error), not "we looked, there is nothing".
    var absentBtnFailed = p.can_act
      ? '<button type="button" class="btn" data-cs-absent="1">Not in Creditsafe</button>'
      : '';
    body = '' +
      '<div class="cp-cs-picker">' +
        '<div class="field-val muted">The Creditsafe search is unavailable right now. Try again shortly, ' +
          'or mark this customer as not present.</div>' +
        '<div class="cp-cs-search-row">' + absentBtnFailed + '</div>' +
      '</div>';
  } else if (p.cs_candidates && p.cs_candidates.length) {
    var total = p.cs_total != null ? Number(p.cs_total) : p.cs_candidates.length;
    var countNote = total > p.cs_candidates.length
      ? esc(String(total)) + ' matches, showing ' + esc(String(p.cs_candidates.length))
      : esc(String(total)) + ' match' + (total === 1 ? '' : 'es');
    var absentBtn = p.can_act
      ? '<button type="button" class="btn" data-cs-absent="1">Not in Creditsafe</button>'
      : '';
    body = '' +
      '<div class="cp-cs-picker">' +
        '<div class="field-val muted">Creditsafe returned ' + countNote +
          ' for this name. Confirm the right company, or mark this customer as not present.</div>' +
        '<div class="cp-candidates">' +
        p.cs_candidates.map(function (c) {
          var pickBtn = p.can_act
            ? '<button type="button" class="btn primary" data-cs-pick="' + esc(c.connect_id) + '">Use this</button>'
            : '';
          // 🚨 Say what actually matched. Two GW COUNTRY rows in Winfield, KS
          // both read "address matches" against a submitted address that was
          // neither of them -- they shared only the town and the zip. Same
          // town is not the same company, and a badge that overstates it is
          // worse than no badge at all.
          var scoreHtml = '';
          if (c.address_street_match) {
            scoreHtml = '<span class="cp-match cp-match-strong">address matches</span>';
          } else if (c.address_same_area) {
            scoreHtml = '<span class="cp-match cp-match-part">same city, different street</span>';
          }
          // Head office vs branch, which is often THE deciding field between
          // two live rows for one company.
          var officeHtml = c.office_type
            ? '<span class="cp-office">' + esc(c.office_type) + '</span>' : '';
          return '' +
            '<div class="cp-cs-candidate-row">' +
              '<div class="cp-candidate-main">' +
                '<div class="cp-candidate-name">' + esc(c.name) + scoreHtml + officeHtml + '</div>' +
                '<div class="cp-candidate-sub">' + (c.address ? esc(c.address) + ' · ' : '') +
                  esc(c.status || '') + '</div>' +
              '</div>' +
              pickBtn +
            '</div>';
        }).join('') +
        '</div>' +
        '<div class="cp-cs-search-row">' + absentBtn + '</div>' +
      '</div>';
  } else {
    var absentBtnEmpty = p.can_act
      ? '<button type="button" class="btn" data-cs-absent="1">Not in Creditsafe</button>'
      : '';
    body = '' +
      '<div class="cp-cs-picker">' +
        '<div class="field-val muted">No Creditsafe match is on file for this name yet.</div>' +
        '<div class="cp-cs-search-row">' + absentBtnEmpty + '</div>' +
      '</div>';
  }
  return section('Creditsafe Match', body);
}

// ---- the credit bureau report, once an identity is bound ----
function num(n) {
  if (n == null) { return emptyDash(); }
  var v = Number(n);
  if (!isFinite(v)) { return esc(String(n)); }
  // 841 trade lines and 15000 employees sit side by side; without separators the
  // second one has to be counted rather than read.
  return esc(String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
}

// A count that means something when it is zero. "0 judgments" is a finding an
// analyst can rely on; a dash is an absence they cannot.
function count(n) { return n == null ? emptyDash() : esc(String(Number(n) || 0)); }

function pct(n) {
  if (n == null) { return emptyDash(); }
  return esc((Math.round(Number(n) * 100) / 100) + '%');
}

// The direction of travel. Creditsafe's own limit collapsing is the single
// loudest signal in the file, and it is invisible from the current value alone.
function trend(now, before, fmt) {
  var f = fmt || num;
  if (before == null) { return f(now); }
  if (now == null) { return emptyDash(); }
  var d = Number(now) - Number(before);
  if (!d) { return f(now) + ' <span class="cp-trend muted">(no change)</span>'; }
  var cls = d < 0 ? 'cp-trend cp-trend-down' : 'cp-trend cp-trend-up';
  // Sign as a WORD, magnitude as a positive number. money(-250000) formats as
  // "$-250,000", which reads as a typo at a glance and is the wrong thing to
  // make an analyst parse twice on the one line that matters most.
  var size = fmt === money ? money(Math.abs(d)) : String(Math.abs(d));
  return f(now) + ' <span class="' + cls + '">(' + (d < 0 ? 'down ' : 'up ') +
         esc(size) + ' from ' + f(before) + ')</span>';
}

function renderSummary(p) {
  var s = p.summary;
  var body;
  if (!s) {
    // 🚨 "Nobody has bought it" and "we bought it and there is nothing" are
    // different facts. Only the first one is fixable by clicking a button.
    var pull = p.can_pull_report && p.can_act
      ? '<div class="cp-cs-search-row">' +
          '<button type="button" class="btn primary" data-pull-report="1">Get credit report</button>' +
        '</div>' +
        '<div class="field-val muted cp-note">Pulls the full Creditsafe file for the ' +
          'company bound above. This is a paid lookup, and it is cached afterwards.</div>'
      : '';
    body = '<div class="field-val muted">' +
             (p.can_pull_report ? 'No Creditsafe report has been pulled for this company yet.'
                                : 'No Creditsafe report on file. Confirm the Creditsafe company above first.') +
           '</div>' + pull;
    return section('Credit Report', body);
  }
  if (!s.scored) {
    // Not Rated is a real answer from a real report, not a missing one.
    body = '<div class="field-val muted">Creditsafe returned a report but has not ' +
           'scored this company. The trade and legal detail below still stands.</div>';
  } else {
    body = '' +
      '<div class="field-grid">' +
        field('Score', trend(s.score, s.previous_score)) +
        field('Grade', s.grade ? esc(s.grade) + (s.grade_label ? ' <span class="muted">' + esc(s.grade_label) + '</span>' : '') : emptyDash()) +
        field('Recommended Limit', trend(s.recommended_limit, s.previous_limit, money)) +
        field('Limit Last Changed', s.limit_changed_at ? esc(String(s.limit_changed_at).slice(0, 10)) : emptyDash()) +
      '</div>';
  }

  // Payment behaviour. DBT against the industry is the comparison that matters:
  // 30 days late means one thing in produce and another in steel.
  body += '<div class="cp-subhead">Payment behaviour</div>' +
    '<div class="field-grid">' +
      field('Days Beyond Terms', num(s.dbt)) +
      field('Industry DBT', num(s.industry_dbt)) +
      field('Active Trade Lines', num(s.active_trade_lines)) +
      field('Total Balance', s.balance != null ? esc(money(s.balance)) : emptyDash()) +
      field('91+ Days', s.range91plus != null ? esc(money(s.range91plus)) : emptyDash()) +
      field('% 91+ Days', pct(s.pct_91plus)) +
    '</div>';

  // The deny signals. These are counts, so zero is the answer and must show as 0.
  body += '<div class="cp-subhead">Legal and risk</div>' +
    '<div class="field-grid">' +
      field('Bankruptcy', s.bankruptcy ? '<span class="cp-flag">Yes</span>' : 'No') +
      field('Possible OFAC', s.possible_ofac ? '<span class="cp-flag">Yes</span>' : 'No') +
      field('Tax Liens', count(s.tax_liens) +
            (Number(s.tax_lien_value) ? ' <span class="muted">' + esc(money(s.tax_lien_value)) + '</span>' : '')) +
      field('Judgments', count(s.judgments)) +
      field('Suits', count(s.suits)) +
      field('UCC Filings', count(s.ucc) +
            (Number(s.cautionary_ucc) ? ' <span class="cp-flag">' + esc(String(s.cautionary_ucc)) + ' cautionary</span>' : '')) +
    '</div>';

  // Firmographics. Tom's gate rests on these, not on the score: age, a real
  // street address and headcount predict our losses where the rating does not.
  body += '<div class="cp-subhead">Company</div>' +
    '<div class="field-grid">' +
      field('Established', s.established_year ? esc(String(s.established_year)) : emptyDash()) +
      field('Employees', num(s.employees)) +
      field('Address Type', s.address_type ? esc(s.address_type) : emptyDash()) +
      field('Tax ID', s.tax_id ? esc(s.tax_id) : emptyDash()) +
    '</div>';

  if (s.dbt_history && s.dbt_history.length) {
    body += '<div class="cp-subhead">DBT history</div><div class="cp-dbt-history">' +
      s.dbt_history.slice(-12).map(function (h) {
        return '<span class="cp-dbt-cell"><b>' + esc(String(h.dbt)) + '</b>' +
               (h.date ? '<i>' + esc(String(h.date).slice(0, 7)) + '</i>' : '') + '</span>';
      }).join('') + '</div>';
  }
  return section('Credit Report', body);
}

// ---- what OperFi's own book (FactorView) already knows ----
function renderFactorView(p) {
  var body;
  if (p.fv_debtor) {
    var d = p.fv_debtor;
    body = '' +
      '<div class="field-grid">' +
        field('Company', esc(d.name)) +
        field('FactorView ID', esc(d.company_id)) +
        field('Buy Limit', d.buy_limit != null ? esc(money(d.buy_limit)) : emptyDash()) +
        field('State', d.state ? esc(d.state) : emptyDash()) +
        field('Active', d.is_active ? 'Yes' : 'No') +
        field('Restricted', d.restricted ? '<span class="cp-badge cp-badge-danger">Restricted</span>' : 'No') +
      '</div>';
  } else if (p.fv_candidates && p.fv_candidates.length) {
    body = '' +
      '<div class="field-val muted">More than one FactorView company could match. Pick the right one.</div>' +
      '<div class="cp-candidates">' +
      p.fv_candidates.map(function (c) {
        var restrictedBadge = c.restricted ? ' <span class="cp-badge cp-badge-danger">Restricted</span>' : '';
        var pickBtn = p.can_act
          ? '<button type="button" class="btn primary" data-fv-pick="' + esc(c.company_id) + '">Use this</button>'
          : '';
        return '' +
          '<div class="cp-candidate-row">' +
            '<div class="cp-candidate-main">' +
              '<div class="cp-candidate-name">' + esc(c.name) + restrictedBadge + '</div>' +
              '<div class="cp-candidate-sub">' + (c.state ? esc(c.state) + ' · ' : '') +
                (c.is_active ? 'Active' : 'Inactive') + '</div>' +
            '</div>' +
            '<div class="cp-candidate-limit">' + (c.buy_limit != null ? esc(money(c.buy_limit)) : emptyDash()) + '</div>' +
            pickBtn +
          '</div>';
      }).join('') +
      '</div>';
  } else {
    body = '<div class="field-val muted">No FactorView match on file.</div>';
  }
  return section('Our FactorView History', body);
}

// ---- other clients who have submitted this customer before ----
function renderPriors(p) {
  var body;
  if (p.priors_unavailable) {
    body = '<div class="field-val muted">Prior decisions are unavailable right now.</div>';
  } else if (p.priors && p.priors.length) {
    body = '<div class="cp-priors">' + p.priors.map(function (pr) {
      return '' +
        '<div class="cp-prior-row">' +
          '<div class="cp-prior-broker">' + esc(pr.broker) + '</div>' +
          '<div class="cp-prior-limit">' + (pr.limit != null ? esc(money(pr.limit)) : emptyDash()) + '</div>' +
          '<div class="cp-prior-date">' + (pr.decided_at ? esc(pr.decided_at) : emptyDash()) + '</div>' +
        '</div>';
    }).join('') + '</div>';
  } else {
    body = '<div class="field-val muted">No other clients have submitted this customer for credit yet.</div>';
  }
  return section('Other Clients’ Limits', body);
}

// ---- the fraud read, the same one the detail pane shows --------------------
// 🚨 OperFi-facing only, and it must never differ from the drawer's: Tom saw
// HIGH RISK with two named reasons there and nothing at all here for the same
// customer, which is worse than either alone -- an analyst who reads only this
// page concludes the customer is clean.
var RISK_WORDS = { high: 'High risk', medium: 'Needs a look', low: 'Nothing flagged',
                   unknown: 'Could not check' };

function renderFraud(p) {
  var f = p.fraud;
  var q = p.quality || {};
  var junk = q.placeholder || [];
  if (!f && !junk.length) { return ''; }
  var body = '';

  var d = f && f.domain;
  if (d) {
    var cls = d.risk === 'high' ? 'cp-risk-high'
            : (d.risk === 'medium' ? 'cp-risk-review'
            : (d.risk === 'unknown' ? 'cp-risk-unknown' : 'cp-risk-ok'));
    body += '<div class="cp-subhead">Email and domain</div>' +
      '<div class="cp-risk ' + cls + '">' + esc(RISK_WORDS[d.risk] || d.risk) + '</div>';
    if (d.reasons && d.reasons.length) {
      body += '<ul class="cp-risk-list">' + d.reasons.map(function (r) {
        return '<li>' + esc(r) + '</li>';
      }).join('') + '</ul>';
    }
    body += '<div class="field-grid">' +
      field('Email Domain', d.email_domain ? esc(d.email_domain) : emptyDash()) +
      field('Website Domain', d.website_domain ? esc(d.website_domain) : emptyDash()) +
      field('Domains Match', d.domain_mismatch ? '<span class="cp-flag">No</span>' : 'Yes') +
      // 🚨 Aged SEPARATELY. One unlabelled "domain age" beside a mismatch reads
      // as if we had checked the pair; on YEARS TRADE the email domain was 2y7m
      // and the website domain six months, and only the second one mattered.
      field('Email Domain Age',
            d.email_domain_age_human || d.domain_age_human
              ? esc(d.email_domain_age_human || d.domain_age_human) : emptyDash()) +
      field('Website Domain Age', d.website_domain_age_human
            ? esc(d.website_domain_age_human)
            : (d.domain_mismatch ? emptyDash()
                                 : '<span class="muted">same domain</span>')) +
      field('Disposable', d.disposable ? '<span class="cp-flag">Yes</span>' : 'No') +
      field('Email Valid', d.email_valid === false ? '<span class="cp-flag">No</span>'
            : (d.email_valid === true ? 'Yes' : emptyDash())) +
      '</div>';
  }

  var ph = f && f.phone;
  if (ph) {
    body += '<div class="cp-subhead">Phone</div>' +
      '<div class="field-grid">' +
        field('Number', ph.number ? esc(ph.number) : emptyDash()) +
        // 🚨 A VOIP number on a corporate AP contact is the classic tell: it is
        // free, instant and disposable, where a landline takes an account.
        field('VOIP', ph.voip ? '<span class="cp-flag">Yes</span>'
              : (ph.voip === false ? 'No' : emptyDash())) +
        field('Line Type', ph.line_type ? esc(ph.line_type) : emptyDash()) +
        field('Carrier', ph.carrier ? esc(ph.carrier) : emptyDash()) +
        field('Valid', ph.valid === false ? '<span class="cp-flag">No</span>'
              : (ph.valid === true ? 'Yes' : emptyDash())) +
        field('Risk', ph.risk_band ? esc(ph.risk_band) : emptyDash()) +
      '</div>';
  }

  if (junk.length) {
    body += '<div class="cp-subhead">Looks like placeholder data</div>' +
      '<ul class="cp-risk-list">' + junk.map(function (j) {
        return '<li>' + esc(j.field) + ' is "' + esc(j.value) + '"</li>';
      }).join('') + '</ul>' +
      '<div class="field-val muted cp-note">Typed to get past the form rather ' +
      'than answered. Worth confirming before funding, but not on its own a ' +
      'fraud signal.</div>';
  }
  if (q.missing && q.missing.length) {
    body += '<div class="field-val muted cp-note">Not provided: ' +
            esc(q.missing.join(', ')) + '</div>';
  }
  return body ? section('Fraud and Data Checks', body) : '';
}

// ---- everything the broker submitted, with a field for every box -----------
// Tom, 2026-09-25: "it should show all the data that the client submitted or at
// least have fields for everything submitted." An empty field is information:
// it says the broker left the box blank, which is different from the page not
// carrying that box at all.
function renderSubmitted(p) {
  var s = p.submitted;
  if (!s) { return ''; }
  var a = s.address_parts || {};
  var body = '<div class="field-grid">' +
      field('Company Name', s.company_name ? esc(s.company_name) : emptyDash()) +
      field('Address', mapLink(s.address)) +
      field('City', a.city ? esc(a.city) : emptyDash()) +
      field('State', a.state ? esc(a.state) : emptyDash()) +
      field('Postal Code', a.postal ? esc(a.postal) : emptyDash()) +
      field('Phone', s.phone ? esc(s.phone) : emptyDash()) +
      field('Website', link(s.website)) +
      field('LinkedIn', link(s.linkedin)) +
      field('Other Social', link(s.social)) +
      field('FactorView ID', s.fv_id ? esc(s.fv_id) : emptyDash()) +
      field('Credit App Sent', s.credit_app_sent ? 'Yes' : 'No') +
      field('Sent To', s.credit_app_sent_to ? esc(s.credit_app_sent_to) : emptyDash()) +
      field('Submitted', s.submitted_at ? esc(s.submitted_at) : emptyDash()) +
      field('Supporting Documents',
            s.supporting_documents ? esc(String(s.supporting_documents)) : '0') +
    '</div>';
  if (s.comments) {
    body += '<div class="cp-subhead">Broker Comments</div>' +
            '<div class="cp-quote">' + esc(s.comments) + '</div>';
  }
  if (s.credit_notes) {
    body += '<div class="cp-subhead">Credit Notes</div>' +
            '<div class="cp-quote">' + esc(s.credit_notes) + '</div>';
  }
  return '<div class="cp-submitted">' + section('As Submitted', body) + '</div>';
}

// ---- internal audit: who did what, and why ---------------------------------
// Tom, 2026-09-25: "so the team can see who made an approval or request on
// something and if they made an approval or an exception to add a note...
// Internal audit control would be great!"
//
// Last on the page and OperFi-only, like everything else here. It answers the
// question nobody asks until six months later: who granted this, and why.
function renderAudit(p) {
  var acts = p.activity || [];
  var notes = p.notes || [];
  var body = '';

  if (p.can_act) {
    body += '<div class="cp-note-add">' +
      '<textarea id="cp-note-body" class="cp-note-input" rows="2" ' +
        'placeholder="What did you do, and why? An exception is worth a sentence."' +
        '></textarea>' +
      '<div class="cp-cs-search-row">' +
        '<button type="button" class="btn cp-decide" data-note="note">Add note</button>' +
        '<button type="button" class="btn cp-decide" data-note="exception">' +
          'Log an exception</button>' +
      '</div>' +
      // 🚨 Say it on the page. Someone who expects to be able to tidy a note
      // later writes a different note than someone who knows it is permanent.
      '<div class="field-val muted cp-note">Notes are permanent and attributed ' +
      'to you. To correct one, add another.</div>' +
    '</div>';
  }

  if (notes.length) {
    body += '<div class="cp-subhead">Notes</div>' + notes.map(function (n) {
      return '<div class="cp-entry' + (n.kind === 'exception' ? ' cp-entry-exception' : '') + '">' +
        '<div class="cp-entry-head">' +
          (n.kind === 'exception' ? '<span class="cp-flag">EXCEPTION</span> ' : '') +
          esc(n.author || 'unknown') +
          '<span class="muted"> &middot; ' + esc(when(n.at)) + '</span>' +
        '</div>' +
        '<div class="cp-entry-body">' + esc(n.body || '') + '</div>' +
      '</div>';
    }).join('');
  }

  if (acts.length) {
    body += '<div class="cp-subhead">Actions taken</div>' + acts.map(function (a) {
      return '<div class="cp-entry">' +
        '<div class="cp-entry-head">' + esc(a.action || '') +
          (a.detail ? ' <span class="muted">' + esc(a.detail) + '</span>' : '') +
        '</div>' +
        '<div class="cp-entry-body muted">' +
          esc(a.actor || 'system') + ' &middot; ' + esc(when(a.at)) +
          (a.note ? ' &middot; ' + esc(a.note) : '') +
        '</div>' +
      '</div>';
    }).join('');
  }

  if (!acts.length && !notes.length && !p.can_act) { return ''; }
  if (!acts.length && !notes.length) {
    body += '<div class="field-val muted">Nothing has been done to this ' +
            'submission yet.</div>';
  }
  return section('Internal Notes and Audit', body);
}

function when(iso) {
  if (!iso) { return ''; }
  return String(iso).replace('T', ' ').slice(0, 16) + ' UTC';
}

// ---- CREDITAPP1: the customer's own application and its references ---------
// The only first-hand evidence on the page. Everything above it is somebody
// else's opinion of the customer; this is what the customer and their trade
// references actually said, and who has not answered yet.

var SLOT_LABELS = { trade1: 'Trade Reference 1', trade2: 'Trade Reference 2',
                    trade3: 'Trade Reference 3', bank: 'Bank Reference' };

var APP_STATUS_LABELS = {
  sent: 'Sent, awaiting the customer',
  app_received: 'Application received',
  references_pending: 'Waiting on references',
  ready_for_review: 'Ready for review'
};

function statusPill(status) {
  var done = status === 'completed';
  var cls = done ? 'cp-pill-done'
          : (status === 'bounced' ? 'cp-pill-bad'
          : (status === 'waived' ? 'cp-pill-waived' : 'cp-pill-wait'));
  return '<span class="cp-pill ' + cls + '">' + esc(status || 'not sent') + '</span>';
}

function riskBadge(level, signals) {
  if (!level) { return ''; }
  var cls = level === 'high' ? 'cp-risk-high'
          : (level === 'review' ? 'cp-risk-review' : 'cp-risk-ok');
  var out = '<div class="cp-risk ' + cls + '">Risk: ' + esc(level) + '</div>';
  if (signals && signals.length) {
    out += '<ul class="cp-risk-list">' + signals.map(function (s) {
      return '<li>' + esc(String(s.code || '').replace(/_/g, ' ')) +
             (s.detail ? ' <span class="muted">' + esc(s.detail) + '</span>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  return out;
}

function agingGrid(a) {
  if (!a) { return ''; }
  var cells = [['Current', a.d0_30], ['31-60', a.d31_60], ['61+', a.d61_plus]];
  return '<div class="cp-aging">' + cells.map(function (c) {
    return '<div class="cp-aging-cell"><i>' + esc(c[0]) + '</i><b>' +
           (c[1] == null ? emptyDash() : esc(money(c[1]))) + '</b></div>';
  }).join('') + '</div>';
}

// 🚨 One table, not four cards. Tom's credit team: "The credit app and trade
// references information takes up a lot of space." Each card spent a full block
// of height on six numbers, and references are read by COMPARING them -- limit
// against limit, aging against aging -- which a table does and a stack of cards
// actively fights.
//
// A reference still out gets ONE row saying so rather than a card of dashes: the
// question there is "who are we waiting on", and eight empty fields do not
// answer it any better than the word does.
function renderReferenceTable(refs) {
  if (!refs || !refs.length) { return ''; }
  var head = '<thead><tr>' +
    ['Reference', 'Status', 'Known as', 'Since', 'Limit', 'High', 'Terms',
     'Rating', 'Balance', 'Current', '31-60', '61+'
    ].map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
    '</tr></thead>';

  var rows = refs.map(function (r) {
    var who = esc(SLOT_LABELS[r.slot] || r.slot) + '<br>' +
              '<span class="muted">' + esc(r.company || r.name || '—') + '</span>';
    var resp = r.response;
    if (!resp) {
      return '<tr><td>' + who + '</td><td>' + statusPill(r.status) + '</td>' +
             '<td class="waiting" colspan="10">' +
             (r.opened_at ? 'opened, not returned' : 'awaiting reply') +
             '</td></tr>';
    }
    var aging = resp.aging || {};
    var cells = [
      resp.legal_name ? esc(resp.legal_name) : emptyDash(),
      resp.customer_since ? esc(resp.customer_since) : emptyDash(),
      resp.credit_limit != null ? esc(money(resp.credit_limit)) : emptyDash(),
      resp.high_credit != null ? esc(money(resp.high_credit)) : emptyDash(),
      resp.net_terms != null ? esc(String(resp.net_terms)) : emptyDash(),
      resp.rating != null ? esc(String(resp.rating)) : emptyDash(),
      resp.balance != null ? esc(money(resp.balance)) : emptyDash(),
      aging.d0_30 != null ? esc(money(aging.d0_30)) : emptyDash(),
      aging.d31_60 != null ? esc(money(aging.d31_60)) : emptyDash(),
      aging.d61_plus != null ? esc(money(aging.d61_plus)) : emptyDash()
    ].map(function (c) { return '<td>' + c + '</td>'; }).join('');
    return '<tr' + (r.risk_level ? ' class="has-risk"' : '') + '>' +
           '<td>' + who + '</td><td>' + statusPill(r.status) + '</td>' +
           cells + '</tr>';
  }).join('');

  // Risk and free-text stay BELOW the table, one line each. They are prose and
  // would wreck the column widths, but they are also the two things worth
  // reading once the numbers line up.
  var extra = refs.map(function (r) {
    var out = '';
    if (r.risk_level && r.risk_signals && r.risk_signals.length) {
      out += '<div class="cp-refnote"><span class="cp-flag">' +
        esc(SLOT_LABELS[r.slot] || r.slot) + ' risk: ' + esc(r.risk_level) +
        '</span> ' + r.risk_signals.map(function (s) {
          return esc(String(s.code || '').replace(/_/g, ' ')) +
                 (s.detail ? ' (' + esc(s.detail) + ')' : '');
        }).join(' &middot; ') + '</div>';
    }
    if (r.response && r.response.comments) {
      out += '<div class="cp-quote">' + esc(r.response.comments) + '</div>';
    }
    return out;
  }).join('');

  return '<table class="cp-reftable">' + head + '<tbody>' + rows +
         '</tbody></table>' + extra;
}


function renderApplicationBody(customer) {
  var resp = customer && customer.response;
  if (!resp) { return ''; }
  var co = resp.company || {};
  var bank = resp.bank || {};
  var signer = resp.signer || {};
  var bill = resp.billing || {};
  var out = '<div class="cp-subhead">What the customer told us</div>' +
    '<div class="field-grid">' +
      field('Legal Name', co.name ? esc(co.name) : emptyDash()) +
      field('DBA', co.dba ? esc(co.dba) : emptyDash()) +
      field('Business Type', resp.business_type ? esc(resp.business_type) : emptyDash()) +
      field('Address', (co.address && co.address.formatted) ? esc(co.address.formatted) : emptyDash()) +
      field('EIN', co.ein ? esc(co.ein) : emptyDash()) +
      field('MC / DOT', esc([co.mc, co.dot].filter(Boolean).join(' / ') || '—')) +
      field('Formed', esc([co.formation_date, co.formation_state].filter(Boolean).join(', ') || '—')) +
      field('Website', co.website ? esc(co.website) : emptyDash()) +
      // 🚨 A customer who is already factoring changes the whole question: the
      // receivable may already be assigned to someone else.
      field('Currently Factoring', co.currently_factoring ? esc(co.currently_factoring) : emptyDash()) +
      field('Parent Companies', co.parent_companies ? esc(co.parent_companies) : emptyDash()) +
    '</div>';
  out += '<div class="cp-subhead">Signed by</div>' +
    '<div class="field-grid">' +
      field('Name', signer.name ? esc(signer.name) : emptyDash()) +
      field('Title', signer.title ? esc(signer.title) : emptyDash()) +
      field('Phone', signer.phone ? esc(signer.phone) : emptyDash()) +
      // The address that actually passed the one-time code, which is not
      // necessarily the one the broker typed into the submission.
      field('Verified Email', resp.verified_email ? esc(resp.verified_email) : emptyDash()) +
    '</div>';
  out += '<div class="cp-subhead">Bank and billing</div>' +
    '<div class="field-grid">' +
      field('Bank', bank.name ? esc(bank.name) : emptyDash()) +
      field('Officer', bank.officer ? esc(bank.officer) : emptyDash()) +
      field('Bank Phone', bank.phone ? esc(bank.phone) : emptyDash()) +
      field('AP Email', bill.ap_email ? esc(bill.ap_email) : emptyDash()) +
      field('Billing Contact', bill.contact_name ? esc(bill.contact_name) : emptyDash()) +
      field('Billing Phone', bill.phone ? esc(bill.phone) : emptyDash()) +
    '</div>';
  if (bill.instructions) {
    out += '<div class="cp-quote">' + esc(bill.instructions) + '</div>';
  }
  return out;
}

function renderCreditApp(p) {
  var a = p.credit_app;
  if (!a) {
    return section('Credit Application',
      '<div class="field-val muted">No credit application has been sent for this customer.</div>');
  }
  var head = '<div class="field-grid">' +
      field('Status', esc(APP_STATUS_LABELS[a.status] || a.status || '—')) +
      field('References Back',
            esc(String(a.references_completed || 0)) + ' of ' +
            esc(String(a.references_total || 0))) +
      field('Sent', a.sent_at ? esc(String(a.sent_at).slice(0, 10)) : emptyDash()) +
      field('Application Received',
            a.app_received_at ? esc(String(a.app_received_at).slice(0, 10))
                              : '<span class="muted">not yet</span>') +
    '</div>';
  head += renderApplicationBody(a.customer);
  if (a.references && a.references.length) {
    head += '<div class="cp-subhead">References</div>' +
            renderReferenceTable(a.references);
  }
  return section('Credit Application', head);
}

function render(payload) {
  var p = payload || {};
  // Order: header -> engine read -> Creditsafe picker (resolves the identity) ->
  // our own history (the debtor OperFi's own losses are recorded against, and
  // where the FactorView `restricted` deny signal lives) -> other clients'
  // limits -> the credit bureau report -> the customer's own application and
  // its references, which is the first-hand evidence and so reads last, after
  // the analyst knows who they are looking at.
  // 🚨 Sections read TOGETHER sit together. Tom's credit team: "we're not wild
  // about the UI and how spaced apart everything is... the less scrolling they
  // have to do the better." Pairing halves the height of four sections without
  // hiding anything, and .cp-pair falls back to stacked on a narrow window.
  //
  // Fraud stays FULL WIDTH and never pairs or collapses. Tom: "I wouldn't
  // collapse Fraud and data checks by default. It's the section that should stop
  // you reading the rest, and a collapsed fraud row is one an analyst learns to
  // skip." Condensed, yes -- demoted, no.
  var pair = function (a, b) {
    if (!a && !b) { return ''; }
    if (!a || !b) { return a || b; }
    return '<div class="cp-pair">' + a + b + '</div>';
  };
  return '' +
    '<div class="cp-root">' +
      renderHeader(p) +
      renderFraud(p) +
      // What the engine concluded, beside what it concluded it about.
      pair(renderEngine(p), renderIdentity(p)) +
      // Our own book, beside what other clients already hold.
      pair(renderFactorView(p), renderPriors(p)) +
      renderSummary(p) +
      renderCreditApp(p) +
      // The broker's raw form and the audit trail are reference material, not
      // decision material: last, and read only when a question comes up.
      pair(renderSubmitted(p), renderAudit(p)) +
    '</div>';
}

var CP_STYLE_ID = 'opf-cp-styles';
var CP_CSS = '' +
  '.cp-root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;color:#1d1d1f;}' +
  '.cp-root .panel-section{background:#fff;border:1px solid #e6e3da;border-radius:8px;padding:12px 14px;margin-bottom:8px;}' +
  '.cp-root .panel-section-title{font-size:11px;text-transform:uppercase;letter-spacing:0.7px;color:#888;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:8px;}' +
  '.cp-root .panel-section-title::after{content:"";flex:1;height:1px;background:#f0efe9;}' +
  '.cp-root .field-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:9px 22px;}' +
  '.cp-root .field{display:flex;flex-direction:column;gap:3px;}' +
  '.cp-root .field-label{font-size:9.5px;color:#9a958a;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;}' +
  '.cp-root .field-val{font-size:12.5px;line-height:1.3;color:#1d1d1f;font-weight:600;word-break:break-word;}' +
  '.cp-root .field-val.muted{color:#888;font-weight:500;}' +
  '.cp-root .empty{color:#bbb;font-weight:500;font-style:italic;}' +
  '.cp-root .btn{background:#fff;border:1px solid #d8d8d8;border-radius:6px;padding:8px 14px;font-size:13px;font-weight:600;color:#444;cursor:pointer;font-family:inherit;transition:all 0.15s;}' +
  '.cp-root .btn:hover{border-color:#b8b8b8;background:#fafafa;}' +
  '.cp-root .btn.primary{background:#272727;color:#fff;border-color:#F97316;}' +
  '.cp-root .btn.primary:hover{background:#1a1a1a;border-color:#1a1a1a;}' +
  '.cp-root .dec-input{border:1px solid #d8d8d8;border-radius:6px;padding:9px 11px;font-size:13px;font-family:inherit;background:#fafafa;color:#1d1d1f;outline:none;transition:all 0.15s;}' +
  '.cp-root .dec-input:focus{border-color:#F97316;background:#fff;box-shadow:0 0 0 3px rgba(249,115,22,0.14);}' +
  '.cp-header{background:#1d1d1f;color:#fff;border-radius:10px;padding:20px 22px;margin-bottom:14px;}' +
  '.cp-header-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;}' +
  '.cp-eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:0.7px;color:rgba(255,255,255,0.55);font-weight:700;margin-bottom:4px;}' +
  '.cp-customer{font-size:22px;font-weight:700;letter-spacing:-0.3px;}' +
  '.cp-broker{font-size:13px;color:rgba(255,255,255,0.7);margin-top:4px;}' +
  '.cp-header-status{display:flex;flex-direction:column;align-items:flex-end;gap:8px;}' +
  '.cp-status-pill{display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.2px;text-transform:uppercase;background:rgba(255,255,255,0.14);color:#fff;}' +
  '.cp-pill{display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;}' +
  '.cp-pill-ok{background:#1f6321;color:#e3f4e3;}' +
  '.cp-pill-warn{background:#F97316;color:#fff;}' +
  '.cp-pill-muted{background:rgba(255,255,255,0.12);color:rgba(255,255,255,0.7);}' +
  // A settled decision has to survive a glance. The old pill was white-on-grey
  // for every status, so DENIED and AWAITING looked identical in the corner.
  '.cp-status-approved{background:#15803d;color:#fff;}' +
  '.cp-status-denied{background:#b91c1c;color:#fff;}' +
  // Amber, matching the chip the customer LIST already shows for this status --
  // the same record must not read as two different states on two screens.
  '.cp-status-pending{background:#b45309;color:#fff;}' +
  // Blue: sent, and the ball is in the CUSTOMER's court -- nothing for us to do.
  '.cp-status-sent{background:#1d4ed8;color:#fff;}' +
  // Violet: it has come back and is waiting on US again.
  '.cp-status-back{background:#6d28d9;color:#fff;}' +
  '.cp-status-expired{background:#475569;color:#fff;}' +
  '.cp-status-open{background:rgba(255,255,255,0.14);color:#fff;}' +
  // Both choices start identical; colour arrives on hover, when the analyst is
  // committing to one rather than being nudged toward it.
  '.cp-decide{background:#fff;color:#1f2937;border:1px solid #d4d4d8;font-weight:600;}' +
  '.cp-decide-approve:hover{background:#15803d;border-color:#15803d;color:#fff;}' +
  '.cp-decide-deny:hover{background:#b91c1c;border-color:#b91c1c;color:#fff;}' +
  '.cp-decided{margin:0 0 10px;padding:7px 12px;border-radius:8px;font-size:12px;' +
    'font-weight:700;display:inline-block;}' +
  '.cp-decided-yes{background:rgba(21,128,61,.18);color:#bbf7d0;}' +
  '.cp-decided-no{background:rgba(185,28,28,.22);color:#fecaca;}' +
  '.cp-decided-wait{background:rgba(180,83,9,.25);color:#fed7aa;}' +
  '.cp-decided-sent{background:rgba(29,78,216,.28);color:#bfdbfe;}' +
  // Internal audit. One row per thing that happened, so a reader scans down a
  // column of actors rather than through a paragraph.
  '.cp-note-input{width:100%;padding:9px 11px;border:1px solid #cbd5e1;' +
    'border-radius:6px;font-family:inherit;font-size:13px;resize:vertical;}' +
  '.cp-note-input:focus{outline:none;border-color:#94a3b8;}' +
  '.cp-note-add{margin-bottom:6px;}' +
  '.cp-entry{padding:9px 0;border-bottom:1px solid #f1f5f9;}' +
  '.cp-entry:last-child{border-bottom:none;}' +
  '.cp-entry-head{font-size:13px;font-weight:600;color:#0f172a;}' +
  '.cp-entry-body{font-size:13px;color:#334155;margin-top:2px;white-space:pre-wrap;}' +
  // An exception is the row somebody comes looking for; it should not read like
  // the note above it.
  '.cp-entry-exception{border-left:3px solid #b91c1c;padding-left:10px;' +
    'background:#fef2f2;border-radius:0 6px 6px 0;}' +
  '.cp-decided .muted{font-weight:500;opacity:.8;}' +
  '.cp-header-contacts{margin-top:16px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.12);}' +
  '.cp-header-contacts .field-label{color:rgba(255,255,255,0.55);}' +
  '.cp-header-contacts .field-val{color:#fff;}' +
  '.cp-decision-row{margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;}' +
  '.cp-limit-input{max-width:160px;}' +
  '.cp-badge{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:8px;margin-left:6px;}' +
  '.cp-badge-danger{background:#fdecea;color:#c62828;}' +
  '.cp-badge-muted{background:#eee;color:#777;}' +
  '.cp-reasons{margin:8px 0 0;padding-left:18px;color:#444;font-size:12px;line-height:1.5;}' +
  '.cp-reasons li{margin:2px 0;}' +
  '.cp-reasons-wrap{margin-top:14px;}' +
  '.cp-cs-search-row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;}' +
  // The report is long enough that an analyst scans it rather than reads it,
  // so the groups need to be findable at a glance.
  '.cp-subhead{margin:12px 0 7px;font-size:11px;font-weight:700;letter-spacing:.06em;' +
    'text-transform:uppercase;color:#64748b;border-top:1px solid #e2e8f0;padding-top:12px;}' +
  '.cp-flag{color:#b91c1c;font-weight:700;}' +
  '.cp-trend{font-size:12px;font-weight:600;}' +
  '.cp-trend-down{color:#b91c1c;}' +   // a falling limit is the loudest signal in the file
  '.cp-trend-up{color:#15803d;}' +
  '.cp-note{margin-top:6px;font-size:12px;}' +
  '.cp-dbt-history{display:flex;gap:6px;flex-wrap:wrap;}' +
  '.cp-dbt-cell{display:flex;flex-direction:column;align-items:center;min-width:44px;' +
    'padding:6px 4px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;}' +
  '.cp-dbt-cell b{font-size:13px;color:#0f172a;}' +
  '.cp-dbt-cell i{font-size:10px;font-style:normal;color:#64748b;}' +
  // CREDITAPP1. Each reference is a card: an analyst compares them against each
  // other, so they must not run together the way a flat list would.
  '.cp-ref{border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;' +
    'margin-bottom:10px;background:#fafafa;}' +
  '.cp-ref-head{font-size:13px;font-weight:700;color:#0f172a;margin-bottom:10px;}' +
  '.cp-ref-answers{margin-top:10px;}' +
  '.cp-pill{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;' +
    'border-radius:9px;margin-left:6px;text-transform:uppercase;letter-spacing:.04em;}' +
  '.cp-pill-done{background:#e8f5e9;color:#2e7d32;}' +
  '.cp-pill-wait{background:#fff4e0;color:#b25e00;}' +
  '.cp-pill-waived{background:#eef2f7;color:#475569;}' +
  '.cp-pill-bad{background:#fdecea;color:#c62828;}' +
  '.cp-risk{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;' +
    'border-radius:8px;margin-top:8px;}' +
  '.cp-risk-high{background:#fdecea;color:#c62828;}' +
  '.cp-risk-review{background:#fff4e0;color:#b25e00;}' +
  '.cp-risk-ok{background:#e8f5e9;color:#2e7d32;}' +
  '.cp-risk-list{margin:6px 0 0;padding-left:18px;font-size:12px;color:#b25e00;}' +
  '.cp-aging{display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));' +
    'gap:8px;margin-top:10px;}' +
  '.cp-aging-cell{background:#fff;border:1px solid #e2e8f0;border-radius:6px;' +
    'padding:6px 8px;display:flex;flex-direction:column;}' +
  '.cp-aging-cell i{font-size:10px;font-style:normal;color:#64748b;}' +
  '.cp-aging-cell b{font-size:13px;color:#0f172a;}' +
  // What a person wrote, shown as their words rather than reflowed into a field.
  '.cp-quote{margin-top:10px;padding:8px 12px;border-left:3px solid #cbd5e1;' +
    'background:#fff;font-size:13px;color:#334155;white-space:pre-wrap;}' +
  '.cp-engine-basis{margin-bottom:10px;}' +
  // 🚨 Four reference CARDS become four table ROWS. Each card spent a full
  // block of height on six numbers, and an analyst reads references by
  // COMPARING them -- which a table does and a stack of cards fights.
  '.cp-reftable{width:100%;border-collapse:collapse;margin-top:4px;}' +
  '.cp-reftable th{font-size:9.5px;font-weight:700;letter-spacing:.05em;' +
    'text-transform:uppercase;color:#9a958a;text-align:left;' +
    'padding:0 10px 6px 0;white-space:nowrap;}' +
  '.cp-reftable td{font-size:12.5px;color:#1d1d1f;font-weight:600;' +
    'padding:7px 10px 7px 0;border-top:1px solid #f1efe9;vertical-align:top;}' +
  '.cp-reftable td.waiting{color:#9a958a;font-weight:500;}' +
  '.cp-reftable tr.has-risk td{background:#fffbf5;}' +
  // Two sections read together sit together, and fall back to stacked on a
  // narrow window without a breakpoint to maintain.
  '.cp-pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(430px,1fr));' +
    'gap:8px;margin-bottom:8px;}' +
  '.cp-pair > .panel-section{margin-bottom:0;}' +
  '.cp-refnote{margin-top:8px;font-size:11.5px;color:#b25e00;}' +
  // Confirming a company searches, buys a report and re-runs the gate, so it is
  // SECONDS of server work behind one click. Without this the button looks dead.
  '.cp-spin{display:inline-block;width:11px;height:11px;margin-right:7px;' +
    'vertical-align:-1px;border:2px solid currentColor;border-right-color:transparent;' +
    'border-radius:50%;animation:cp-spin .6s linear infinite;}' +
  '@keyframes cp-spin{to{transform:rotate(360deg);}}' +
  '.cp-root button[disabled]{opacity:.55;cursor:not-allowed;}' +
  '.cp-match{display:inline-block;margin-left:8px;font-size:10px;font-weight:700;' +
    'padding:2px 7px;border-radius:8px;text-transform:uppercase;letter-spacing:.04em;}' +
  '.cp-match-strong{background:#e8f5e9;color:#2e7d32;}' +
  '.cp-match-part{background:#fff4e0;color:#b25e00;}' +
  '.cp-match-weak{background:#eef2f7;color:#475569;}' +
  '.cp-office{display:inline-block;margin-left:6px;font-size:10px;font-weight:700;' +
    'padding:2px 7px;border-radius:8px;background:#eef2ff;color:#3730a3;' +
    'text-transform:uppercase;letter-spacing:.04em;}' +
  '.cp-header-contacts a{color:#fff;text-decoration:underline;}' +
  '.cp-submitted a{color:#1d4ed8;}' +
  '.cp-cs-search-row input{flex:1;min-width:200px;}' +
  '.cp-cs-results{margin-top:10px;}' +
  '.cp-candidates,.cp-priors{display:flex;flex-direction:column;gap:8px;margin-top:10px;}' +
  '.cp-candidate-row,.cp-prior-row{display:grid;grid-template-columns:1.4fr 1fr auto;gap:10px;align-items:center;padding:10px 12px;background:#fafafa;border:1px solid #f0efe9;border-radius:8px;}' +
  '.cp-cs-candidate-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:10px 12px;background:#fafafa;border:1px solid #f0efe9;border-radius:8px;}' +
  '.cp-candidate-name,.cp-prior-broker{font-size:13px;font-weight:700;color:#1d1d1f;}' +
  '.cp-candidate-sub{font-size:11px;color:#888;margin-top:2px;}' +
  '.cp-candidate-limit,.cp-prior-limit{font-size:14px;font-weight:700;color:#1d1d1f;text-align:right;}' +
  '.cp-prior-date{font-size:11px;color:#888;text-align:right;}' +
  '@media (max-width:640px){.field-grid{grid-template-columns:1fr;}.cp-candidate-row,.cp-prior-row,.cp-cs-candidate-row{grid-template-columns:1fr;}.cp-candidate-limit,.cp-prior-date{text-align:left;}}';

function injectStyles() {
  if (typeof document === 'undefined') { return; }
  if (document.getElementById(CP_STYLE_ID)) { return; }
  var s = document.createElement('style');
  s.id = CP_STYLE_ID;
  s.textContent = CP_CSS;
  document.head.appendChild(s);
}

function mount(root, payload, handlers) {
  handlers = handlers || {};
  injectStyles();
  root.innerHTML = render(payload);
  root.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== root) {
      if (t.getAttribute) {
        if (t.hasAttribute('data-decide')) {
          if (handlers.onDecide) {
            var limitEl = root.querySelector('#cp-limit');
            handlers.onDecide(t.getAttribute('data-decide'), limitEl ? limitEl.value : null);
          }
          return;
        }
        if (t.hasAttribute('data-cs-pick')) {
          if (handlers.onCsPick) { handlers.onCsPick(t.getAttribute('data-cs-pick')); }
          return;
        }
        if (t.hasAttribute('data-fv-pick')) {
          if (handlers.onFvPick) { handlers.onFvPick(t.getAttribute('data-fv-pick')); }
          return;
        }
        if (t.hasAttribute('data-cs-absent')) {
          if (handlers.onCsAbsent) { handlers.onCsAbsent(); }
          return;
        }
        if (t.hasAttribute('data-cs-unabsent')) {
          if (handlers.onCsUnabsent) { handlers.onCsUnabsent(); }
          return;
        }
        if (t.hasAttribute('data-cs-clear')) {
          if (handlers.onCsClear) { handlers.onCsClear(); }
          return;
        }
        if (t.hasAttribute('data-pull-report')) {
          if (handlers.onPullReport) { handlers.onPullReport(); }
          return;
        }
        if (t.hasAttribute('data-note')) {
          if (handlers.onNote) { handlers.onNote(t.getAttribute('data-note')); }
          return;
        }
      }
      t = t.parentNode;
    }
  });
}

if (typeof module !== 'undefined' && module.exports) { module.exports = { render: render, mount: mount, injectStyles: injectStyles, esc: esc, money: money }; }
if (typeof window !== 'undefined') { window.OperFiCustomerProfile = { render: render, mount: mount, injectStyles: injectStyles }; }
