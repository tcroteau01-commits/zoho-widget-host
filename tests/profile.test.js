// tests/profile.test.js
// The profile an analyst reads. Pure render, so every branch is testable
// without a browser -- and the branches that matter are the empty ones, because
// a real submission arrives with almost nothing filled in.
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../customer-profile.js');

const BASE = {
  submission_id: '4455', customer_name: 'C.H. ROBINSON', broker: 'Meridian Freight',
  status: 'Awaiting Credit Decision',
  contacts: { poc: 'Dana Reed', email: 'dana@chrobinson.com',
              billing_poc: 'Aisha Khan', billing_email: 'ap@chrobinson.com' },
  engine: null, identity: null, summary: null, fv_debtor: null,
  fv_candidates: [], priors: [], priors_unavailable: false, can_act: true
};

test('an empty profile still renders', () => {
  const html = P.render(BASE);
  assert.ok(html.includes('C.H. ROBINSON'));
  assert.ok(html.includes('Meridian Freight'));
});

test('the engine verdict and its reasons are shown', () => {
  const html = P.render(Object.assign({}, BASE, {
    engine: { suggested: 'review_required', limit: null,
              reasons: ['more than one Creditsafe match'], engine_version: 'v1' } }));
  assert.ok(html.includes('more than one Creditsafe match'));
});

test('a suggested limit is shown as money, not a raw number', () => {
  const html = P.render(Object.assign({}, BASE, {
    engine: { suggested: 'auto_approve', limit: 15000, reasons: [], engine_version: 'v1' } }));
  assert.ok(html.includes('$15,000'));
});

test('FactorView candidates render as a picker when unbound', () => {
  const html = P.render(Object.assign({}, BASE, { fv_candidates: [
    { company_id: '2030', name: 'C.H. ROBINSON', buy_limit: 397500, restricted: false,
      is_active: true, state: 'IL' } ] }));
  assert.ok(html.includes('$397,500'));
  assert.ok(html.includes('data-fv-pick="2030"'));
});

test('restricted is called out, because it is the deny signal', () => {
  const html = P.render(Object.assign({}, BASE, { fv_debtor:
    { company_id: '77', name: 'ACME', buy_limit: 5000, restricted: true,
      is_active: true, state: 'TX' } }));
  assert.ok(/[Rr]estricted/.test(html));
});

test('a viewer sees the page but no action controls', () => {
  const html = P.render(Object.assign({}, BASE, { can_act: false, fv_candidates: [
    { company_id: '2030', name: 'X', buy_limit: 0, restricted: false,
      is_active: true, state: '' } ] }));
  assert.ok(!html.includes('data-fv-pick='));
  assert.ok(!html.includes('data-cs-pick='));
});

test('other clients limits render with the broker name', () => {
  const html = P.render(Object.assign({}, BASE, { priors: [
    { submission_id: '1', broker: 'Cascade Logistics', limit: 25000, decided_at: '' } ] }));
  assert.ok(html.includes('Cascade Logistics'));
  assert.ok(html.includes('$25,000'));
});

test('an unavailable priors section says so rather than showing none', () => {
  const html = P.render(Object.assign({}, BASE, { priors_unavailable: true }));
  assert.ok(/unavailable/i.test(html));
});

test('a hostile customer name cannot inject markup', () => {
  const html = P.render(Object.assign({}, BASE, {
    customer_name: '<img src=x onerror=alert(1)>' }));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img'));
});

test('a hostile broker name and engine reason are escaped too', () => {
  const html = P.render(Object.assign({}, BASE, {
    broker: '<script>a</script>',
    engine: { suggested: 'review_required', limit: null,
              reasons: ['<script>b</script>'], engine_version: 'v1' } }));
  assert.ok(!html.includes('<script>a'));
  assert.ok(!html.includes('<script>b'));
});

test('a bound identity shows the report section instead of the picker', () => {
  const html = P.render(Object.assign({}, BASE, {
    identity: { connect_id: 'US1', fv_debtor_id: '2030', not_in_creditsafe: false },
    summary: { scored: true, score: 72, grade: 'A', recommended_limit: 1000000,
               active_trade_lines: 841, dbt: 5, established_year: 1969,
               address_type: 'Street Address' } }));
  assert.ok(!html.includes('data-cs-pick='));
  assert.ok(html.includes('841'));
});

test('a customer recorded as absent from Creditsafe says so', () => {
  const html = P.render(Object.assign({}, BASE, {
    identity: { connect_id: null, fv_debtor_id: null, not_in_creditsafe: true } }));
  assert.ok(/not in Creditsafe/i.test(html));
});

// --- every binding an analyst can set, they can take back -------------------
//
// A binding is not a display preference. "Not in Creditsafe" stops the engine
// searching for this customer forever; a wrong Connect ID points every future
// submission at another company's credit file. Both were one click with no way
// back, and for a customer OperFi has never funded there was no other control
// on the page either.

test('marking a customer absent from Creditsafe can be undone', () => {
  const html = P.render(Object.assign({}, BASE, {
    identity: { connect_id: null, fv_debtor_id: null, not_in_creditsafe: true } }));
  assert.ok(html.includes('data-cs-unabsent='));
});

test('a bound Creditsafe company can be unpinned and picked again', () => {
  const html = P.render(Object.assign({}, BASE, {
    identity: { connect_id: 'US1', fv_debtor_id: '2030', not_in_creditsafe: false } }));
  assert.ok(html.includes('data-cs-clear='));
});

// --- a stale verdict must not read like a current one ----------------------
//
// 🚨 The submit-time read is not merely old. It says "no Creditsafe record
// found" about a company whose full credit file is on the same page, because it
// ran before anyone confirmed which company this is.

test('a submit-time verdict is labelled as pre-confirmation', () => {
  const html = P.render(Object.assign({}, BASE, { engine: {
    suggested: 'review_required', limit: null, engine_version: 'v1',
    reasons: ['no Creditsafe record found'], note: null,
    at: '2026-09-25T14:56:51Z' } }));
  assert.ok(/before the company was confirmed/i.test(html));
  assert.ok(/confirmed which company this is/i.test(html));
});

test('a re-run verdict says so and drops the warning', () => {
  const html = P.render(Object.assign({}, BASE, { engine: {
    suggested: 'auto_approve', limit: 30000, engine_version: 'v1', reasons: [],
    note: 'RE-EVALUATED after the identity was confirmed',
    at: '2026-09-25T16:20:00Z' } }));
  assert.ok(/After the identity was confirmed/i.test(html));
  assert.ok(!/confirmed which company this is/i.test(html));
  assert.ok(html.includes('$30,000'));
});

// --- the injected stylesheet must not touch the host page -------------------

test('every injected rule is scoped to the profile', () => {
  // 🚨 THE BUG THIS EXISTS FOR. injectStyles() appends to the HOST page's head,
  // and the profile's CSS declared a bare `.btn.primary { background:#F97316 }`.
  // The drawer uses that same class and defines it #272727, so opening a profile
  // once silently turned every primary button on the page orange until reload --
  // Tom: "why do some detail panes show black and others are orange?... i feel
  // like im going crazy." Same specificity, later in the document, so it won.
  //
  // Captured by RUNNING injectStyles, not by regexing the source: the first
  // check did regex it, matched the wrong slice, and reported zero leaks.
  let captured = '';
  const realDoc = global.document;
  global.document = {
    getElementById: () => null,
    createElement: () => ({ set textContent(v) { captured = v; }, id: '' }),
    head: { appendChild: () => {} }
  };
  try { P.injectStyles(); } finally { global.document = realDoc; }

  const selectors = [];
  captured.replace(/([^{}]+)\{[^}]*\}/g, (_, sel) => {
    sel.split(',').forEach((s) => {
      s = s.trim();
      if (s && s[0] !== '@' && !s.startsWith('to')) { selectors.push(s); }
    });
    return '';
  });
  assert.ok(selectors.length > 50, 'stylesheet did not parse');
  const leaks = selectors.filter((s) => !s.includes('.cp-'));
  assert.deepStrictEqual(leaks, [],
    'these rules escape the profile and restyle the host page');
});

// --- the fraud read, which must match the detail pane's ---------------------

const FRAUD = {
  domain: { risk: 'high',
    reasons: ["Email domain yearstrade.com (2 years 7 months old) doesn't match " +
              'the website yearsbuildingmaterials.com (6 months old)'],
    email_domain: 'yearstrade.com', website_domain: 'yearsbuildingmaterials.com',
    domain_mismatch: true, domain_age_human: '2 years 7 months',
    email_domain_age_human: '2 years 7 months',
    website_domain_age_human: '6 months', website_domain_age_days: 202,
    disposable: false, email_valid: true, unknown: false },
  phone: { number: '(678) 848 2726', valid: true, voip: true, line_type: 'VOIP',
           carrier: 'Bandwidth', risk_band: 'medium' }
};

test('the fraud read appears on the profile at all', () => {
  // 🚨 Tom saw HIGH RISK with named reasons in the drawer and NOTHING here for
  // the same customer. An analyst who reads only this page concludes they are
  // clean, which is worse than either surface alone.
  const html = P.render(Object.assign({}, BASE, { fraud: FRAUD }));
  assert.ok(html.includes('Fraud and Data Checks'));
  assert.ok(/High risk/i.test(html));
  assert.ok(html.includes('yearstrade.com'));
});

test('both domains are aged, and named', () => {
  // Tom: "It's checking 3 years but for which domain?... i still want to know
  // the age of both of them." The website domain was the young one.
  const html = P.render(Object.assign({}, BASE, { fraud: FRAUD }));
  assert.ok(html.includes('Email Domain Age'));
  assert.ok(html.includes('Website Domain Age'));
  assert.ok(html.includes('2 years 7 months'));
  assert.ok(html.includes('6 months'));
});

test('matching domains say so rather than showing a dash', () => {
  const html = P.render(Object.assign({}, BASE, { fraud: { domain: Object.assign(
    {}, FRAUD.domain, { domain_mismatch: false, website_domain_age_human: '' }) } }));
  assert.ok(html.includes('same domain'));
});

test('a VOIP number is flagged', () => {
  // Free, instant and disposable, where a landline takes an account. On a
  // corporate AP contact that is the classic tell.
  const html = P.render(Object.assign({}, BASE, { fraud: FRAUD }));
  assert.ok(/VOIP<\/div><div class="field-val"><span class="cp-flag">Yes/.test(html));
  assert.ok(html.includes('Bandwidth'));
});

test('placeholder data is flagged as quality, not as fraud', () => {
  // "00" in a contact box is far more likely a broker hurrying through a form
  // than a fraudster, and presenting it as fraud trains the team to ignore the
  // flags that matter.
  const html = P.render(Object.assign({}, BASE, {
    quality: { placeholder: [{ field: 'Point of contact', value: '00' }],
               missing: ['Billing contact'] } }));
  assert.ok(html.includes('Point of contact is "00"'));
  assert.ok(/not on its own a fraud signal/i.test(html));
  assert.ok(html.includes('Not provided: Billing contact'));
});

test('the fraud read sits above everything it should override', () => {
  const html = P.render(Object.assign({}, BASE, {
    fraud: FRAUD, submitted: SUBMITTED }));
  assert.ok(html.indexOf('Fraud and Data Checks') < html.indexOf('As Submitted'));
});

test('a clean customer gets no fraud section at all', () => {
  const html = P.render(Object.assign({}, BASE, { fraud: null, quality: null }));
  assert.ok(!html.includes('Fraud and Data Checks'));
});

test('the address links out to Google Maps', () => {
  // Tom: "Can we have the address link out to google maps so they can see that
  // corporate address?" Street View tells a warehouse from a mailbox store.
  const html = P.render(Object.assign({}, BASE, { submitted: SUBMITTED }));
  assert.ok(html.includes('google.com/maps/search'));
  assert.ok(html.includes(encodeURIComponent(SUBMITTED.address)));
  assert.ok(/rel="noopener noreferrer"/.test(html));
});

// --- what the broker submitted ---------------------------------------------
//
// Tom, 2026-09-25: "it needs to show somewhere prominent so you know who you're
// searching for." The address in particular decides which of five companies
// called QUADREL, INC. this one is, and it was on the page nowhere at all.

const SUBMITTED = {
  company_name: 'QUADREL, INC. DBA QUADREL LABELING SYSTEMS',
  address: '7670 JENTHER DRIVE, MENTOR, OH, 44060',
  address_parts: { line1: '7670 JENTHER DRIVE', city: 'MENTOR', state: 'OH',
                   postal: '44060' },
  phone: '440-602-4700', website: 'https://www.quadrel.com/',
  linkedin: null, social: null, comments: null, credit_notes: null,
  fv_id: null, credit_app_sent: false, credit_app_sent_to: null,
  submitted_at: '25-Sep-2026 09:56:45', supporting_documents: 0
};

test('the address is in the header, not buried further down', () => {
  const html = P.render(Object.assign({}, BASE, { submitted: SUBMITTED }));
  const header = html.slice(0, html.indexOf('As Submitted'));
  assert.ok(header.includes('7670 JENTHER DRIVE, MENTOR, OH, 44060'));
  assert.ok(header.includes('440-602-4700'));
});

test('every submitted box has a field, even the ones left blank', () => {
  const html = P.render(Object.assign({}, BASE, { submitted: SUBMITTED }));
  ['Company Name', 'Address', 'City', 'State', 'Postal Code', 'Phone',
   'Website', 'LinkedIn', 'Other Social', 'FactorView ID', 'Credit App Sent',
   'Submitted', 'Supporting Documents'].forEach((label) => {
    assert.ok(html.includes(label), 'no field for: ' + label);
  });
});

test('a website renders as a usable link', () => {
  const html = P.render(Object.assign({}, BASE, { submitted: SUBMITTED }));
  assert.ok(html.includes('href="https://www.quadrel.com/"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
});

test('a Creator URL object never reaches the page as [object Object]', () => {
  // Company_Website arrives as {value, url} and LinkedIn_Profile as {} when
  // empty. The server flattens them; this is the guard that it stays flattened.
  const html = P.render(Object.assign({}, BASE, { submitted: SUBMITTED }));
  assert.ok(!html.includes('[object Object]'));
});

test('a hostile URL is never made clickable', () => {
  // 🚨 esc() alone is not enough for an href: "javascript:alert(1)" survives it
  // intact and runs on click. Only http and https become links.
  const html = P.render(Object.assign({}, BASE, { submitted: Object.assign(
    {}, SUBMITTED, { website: 'javascript:alert(1)',
                     linkedin: '" onmouseover="alert(1)' }) }));
  assert.ok(!/href\s*=\s*["']?javascript:/i.test(html));
  assert.ok(!/"\s+on[a-z]+\s*=/.test(html));   // no attribute escaped its quotes
  assert.ok(html.includes('&quot; onmouseover=&quot;'));  // shown as inert text
});

test('the profile renders without a submitted block at all', () => {
  assert.ok(P.render(Object.assign({}, BASE, { submitted: null }))
             .includes('Credit Submission'));
});

// --- the Creditsafe picker, ranked by address ------------------------------

test('the candidate whose street matches is flagged as such', () => {
  const html = P.render(Object.assign({}, BASE, {
    submitted: SUBMITTED, cs_total: 27,
    cs_candidates: [
      { connect_id: 'US10373976', name: 'QUADREL, INC.', status: 'Active',
        address: '7670 JENTHER DR, MENTOR, OH, 44060',
        address_score: 100, address_street_match: true, address_same_area: true },
      { connect_id: 'US80400643', name: 'QUADREL, INC', status: 'Active',
        address: '5001 BAUM BLVD STE 799, PITTSBURGH, PA, 15213',
        address_score: 0, address_street_match: false, address_same_area: false }
    ] }));
  assert.ok(html.includes('address matches'));
  assert.strictEqual(html.split('address matches').length - 1, 1);
});

test('same town is not the same address', () => {
  // 🚨 The GW COUNTRY case. Two live rows in Winfield, KS -- 16590 121ST RD and
  // 3512 LAKESHORE DR -- against a submitted 3105 CENTRAL AVENUE. They share
  // only the town and the zip, and BOTH used to read "address matches".
  const html = P.render(Object.assign({}, BASE, {
    cs_total: 2,
    cs_candidates: [
      { connect_id: 'A', name: 'GW COUNTRY LLC', office_type: 'Branch',
        address: '16590 121ST RD, WINFIELD, KS, 67156',
        address_score: 40, address_street_match: false, address_same_area: true },
      { connect_id: 'B', name: 'GW COUNTRY OF WINFIELD INC', office_type: 'Headquarters',
        address: '3512 LAKESHORE DR, WINFIELD, KS, 67156',
        address_score: 40, address_street_match: false, address_same_area: true }
    ] }));
  assert.ok(!html.includes('address matches'), 'overstated the match');
  assert.strictEqual(html.split('same city, different street').length - 1, 2);
});

test('head office and branch are visible on the candidate', () => {
  // Tom: "if i were selecting this in Creditsafe, I'd pick the headquarters one."
  const html = P.render(Object.assign({}, BASE, {
    cs_total: 2,
    cs_candidates: [
      { connect_id: 'A', name: 'GW COUNTRY LLC', office_type: 'Branch',
        address: '16590 121ST RD, WINFIELD, KS, 67156' },
      { connect_id: 'B', name: 'GW COUNTRY OF WINFIELD INC', office_type: 'Headquarters',
        address: '3512 LAKESHORE DR, WINFIELD, KS, 67156' }] }));
  assert.ok(html.includes('Headquarters'));
  assert.ok(html.includes('Branch'));
});

test('with no address to compare, no candidate claims anything', () => {
  const html = P.render(Object.assign({}, BASE, {
    cs_total: 2,
    cs_candidates: [
      { connect_id: 'A', name: 'ONE', address: 'X', address_score: 0 },
      { connect_id: 'B', name: 'TWO', address: 'Y', address_score: 0 }] }));
  assert.ok(!html.includes('address matches'));
  assert.ok(!html.includes('same city'));
});

// --- one status in the header ----------------------------------------------

test('a settled decision does not sit beside a competing engine pill', () => {
  // 🚨 Tom, seeing APPROVED and REVIEW REQUIRED together: "These 2 pills don't
  // make sense either. Review Required but Approved?"
  const html = P.render(Object.assign({}, BASE, {
    status: 'Approved',
    engine: { suggested: 'review_required', limit: null, engine_version: 'v1',
              reasons: ['more than one Creditsafe match'], note: null } }));
  // The Credit Engine section always renders, so it is a reliable boundary;
  // "As Submitted" is not, and slicing on a -1 quietly tests nothing.
  const header = html.slice(0, html.indexOf('Credit Engine'));
  assert.ok(header.length > 0);
  assert.ok(!/Review Required/i.test(header), 'engine pill still in the header');
  // ...but the engine's read is still available where it belongs
  assert.ok(/Review Required/i.test(html));
});

test('while the decision is open the engine read IS the headline', () => {
  const html = P.render(Object.assign({}, BASE, {
    status: 'Awaiting Credit Decision',
    engine: { suggested: 'review_required', limit: null, engine_version: 'v1',
              reasons: [], note: null } }));
  const header = html.slice(0, html.indexOf('Credit Engine'));
  assert.ok(/Review Required/i.test(header));
});

test('Pending Credit App is a decision too', () => {
  // 🚨 It was missing from the "has a human decided" test, so after choosing it
  // the engine's Review Required stayed in the header beside it and the chip
  // stayed neutral -- the page read as undecided on a record just decided.
  const html = P.render(Object.assign({}, BASE, {
    status: 'Pending Credit Application',
    engine: { suggested: 'review_required', limit: null, reasons: [],
              engine_version: 'v1' } }));
  const header = html.slice(0, html.indexOf('Credit Engine'));
  assert.ok(!/Review Required/i.test(header), 'engine pill still competing');
  assert.ok(html.includes('cp-status-pending'), 'chip still neutral');
  // and amber, not the red a binary approved/denied split would have given it
  assert.ok(html.includes('cp-decided-wait'));
});

test('Denied is visually a refusal, not another grey chip', () => {
  const denied = P.render(Object.assign({}, BASE, { status: 'Denied' }));
  const approved = P.render(Object.assign({}, BASE, { status: 'Approved' }));
  const open = P.render(Object.assign({}, BASE, { status: 'Awaiting Credit Decision' }));
  assert.ok(denied.includes('cp-status-denied'));
  assert.ok(approved.includes('cp-status-approved'));
  assert.ok(open.includes('cp-status-open'));
});

test('neither decision button is pre-selected by colour', () => {
  // An orange Approve beside a plain Denied reads as the recommended action on
  // every customer, including the ones we should refuse.
  const html = P.render(BASE);
  assert.ok(!/data-decide="Approved"[^>]*class="[^"]*primary/.test(html));
  assert.ok(!/class="[^"]*primary[^"]*"[^>]*data-decide="Approved"/.test(html));
  assert.ok(html.includes('cp-decide-approve'));
  assert.ok(html.includes('cp-decide-deny'));
});

test('the three human decisions are offered and no others', () => {
  // Tom: "The only ones our team should be able to choose should be Approved,
  // Denied, or Pending Credit App."
  const html = P.render(BASE);
  const offered = (html.match(/data-decide="([^"]+)"/g) || [])
    .map((m) => m.slice(13, -1));
  assert.deepStrictEqual(offered.sort(),
    ['Approved', 'Denied', 'Pending Credit Application']);
});

// --- CREDITAPP1: the customer's own application and its references ---------
//
// The only first-hand evidence on the page. Shaped from the REAL CH ROBINSON
// document in Atlas rather than invented: app completed, trade2 back with a
// risk flag, trade1/trade3/bank still out.

const APP = {
  status: 'references_pending', sent_at: '2026-09-25T04:30:00Z',
  app_received_at: '2026-09-25T04:40:41Z',
  references_completed: 1, references_total: 4,
  customer: { slot: 'customer', status: 'completed', response: {
    business_type: 'Freight Broker',
    company: { name: 'CH ROBINSON', dba: 'CHRW', ein: '123132123', mc: '123456',
               dot: '4324322', currently_factoring: 'No',
               address: { formatted: '6026 West Poncho Lane, Magna, UT 84044' } },
    bank: { name: 'National Bank', officer: 'Billy Banker' },
    signer: { name: 'John Smith', title: 'CEO' },
    verified_email: 't.croteau01@gmail.com',
    billing: { ap_email: 'ap@chrobinson.com', instructions: 'Send the BOL' } } },
  references: [
    { slot: 'trade1', name: 'John A', company: 'ABC 1', status: 'sent', response: null },
    { slot: 'trade2', name: 'Jane John', company: 'ABC 2', status: 'completed',
      completed_at: '2026-09-25T04:43:00Z', risk_level: 'review',
      risk_signals: [{ code: 'domain_does_not_match_company', detail: 'gmail.com vs ABC 2' }],
      response: { legal_name: 'ABC LLC 2', customer_since: '2 years',
                  credit_limit: '40000', high_credit: '40000', rating: 5,
                  net_terms: '34', last_sale: '2026-09-14', balance: '40000',
                  comments: 'Good to go',
                  aging: { d0_30: '40000', d31_60: '0', d61_plus: '0' } } },
    { slot: 'trade3', name: 'Jeff Smith', company: 'ABC 3', status: 'sent', response: null },
    { slot: 'bank', name: 'Billy Banker', company: 'National Bank', status: 'sent', response: null }
  ]
};

test('the application the customer submitted is shown in full', () => {
  const html = P.render(Object.assign({}, BASE, { credit_app: APP }));
  ['CH ROBINSON', 'CHRW', '123132123', '6026 West Poncho Lane',
   'Freight Broker', 'John Smith', 'ap@chrobinson.com',
   't.croteau01@gmail.com'].forEach((v) => {
    assert.ok(html.includes(v), 'missing from the application: ' + v);
  });
});

test('a completed reference shows the numbers it gave us', () => {
  const html = P.render(Object.assign({}, BASE, { credit_app: APP }));
  ['ABC LLC 2', '2 years', '$40,000', 'Net Terms', '2026-09-14',
   'Good to go'].forEach((v) => {
    assert.ok(html.includes(v), 'missing from the reference: ' + v);
  });
  // the aging buckets, which is how a limit gets sized rather than guessed
  assert.ok(html.includes('31-60') && html.includes('61+'));
});

test('a reference we are still waiting on is visibly outstanding', () => {
  const html = P.render(Object.assign({}, BASE, { credit_app: APP }));
  assert.ok(html.includes('1 of 4'));
  assert.ok(html.includes('Trade Reference 3'));
  assert.ok(html.includes('Bank Reference'));
});

test('a reference risk signal is shown to the credit team', () => {
  // 🚨 The rule is that a fraud signal never reaches the SUBMITTER, who may be
  // the fraudster. It was never that the credit team should be blind to it.
  const html = P.render(Object.assign({}, BASE, { credit_app: APP }));
  assert.ok(html.includes('Risk: review'));
  assert.ok(html.includes('domain does not match company'));
  assert.ok(html.includes('gmail.com vs ABC 2'));
});

test('"currently factoring" is not buried', () => {
  // A customer already factoring changes the whole question: the receivable
  // may already be assigned to somebody else.
  const html = P.render(Object.assign({}, BASE, { credit_app: APP }));
  assert.ok(html.includes('Currently Factoring'));
});

test('no application says so rather than rendering an empty shell', () => {
  const html = P.render(Object.assign({}, BASE, { credit_app: null }));
  assert.ok(/No credit application has been sent/i.test(html));
});

test('an application sent but not returned still lists who we are waiting on', () => {
  const html = P.render(Object.assign({}, BASE, { credit_app: {
    status: 'sent', sent_at: '2026-09-25T04:30:00Z', app_received_at: null,
    references_completed: 0, references_total: 0,
    customer: { slot: 'customer', status: 'sent', response: null }, references: [] } }));
  assert.ok(/awaiting the customer/i.test(html));
  assert.ok(/not yet/i.test(html));
});

test('a hostile reference comment cannot inject markup', () => {
  const html = P.render(Object.assign({}, BASE, { credit_app: {
    status: 'ready_for_review', references_completed: 1, references_total: 1,
    customer: null,
    references: [{ slot: 'trade1', name: '<script>a</script>', company: 'X',
                   status: 'completed',
                   risk_signals: [{ code: 'x', detail: '<script>c</script>' }],
                   risk_level: 'high',
                   response: { comments: '<script>b</script>' } }] } }));
  assert.ok(!html.includes('<script>a'));
  assert.ok(!html.includes('<script>b'));
  assert.ok(!html.includes('<script>c'));
});

// --- the credit report, which is the whole reason the page exists ----------

const REPORT = {
  scored: true, score: 72, previous_score: 78, grade: 'A',
  grade_label: 'Very Low Risk', recommended_limit: 1000000,
  previous_limit: 1250000, dbt: 5, industry_dbt: 11, active_trade_lines: 841,
  balance: 52000000, range91plus: 310000, pct_91plus: 0.596,
  bankruptcy: false, possible_ofac: false, tax_liens: 0, judgments: 2,
  suits: 0, ucc: 14, cautionary_ucc: 1, tax_id: '41-1883630',
  established_year: 1969, employees: 15000, address_type: 'Street Address',
  dbt_history: [{ date: '2026-07-01', dbt: 6 }, { date: '2026-08-01', dbt: 5 }]
};

test('the report shows payment, legal and firmographic detail, not just a score', () => {
  const html = P.render(Object.assign({}, BASE, { summary: REPORT }));
  ['Industry DBT', '91+ Days', 'Bankruptcy', 'Possible OFAC', 'Judgments',
   'UCC Filings', 'Employees', 'Tax ID', 'DBT history'].forEach((label) => {
    assert.ok(html.includes(label), 'missing section: ' + label);
  });
});

test('a zero count reads as zero, not as a dash', () => {
  // "0 judgments" is a finding an analyst can rely on; a dash is an absence
  // they cannot. Coercing one to the other loses the whole point of the check.
  const html = P.render(Object.assign({}, BASE, { summary: REPORT }));
  const suits = html.match(/Suits<\/div><div class="field-val">([^<]*)</);
  assert.strictEqual(suits[1].trim(), '0');
});

test('a falling credit limit is shown as a fall, and reads as English', () => {
  // 🚨 Creditsafe's own limit collapsing is the loudest signal in the file and
  // is invisible from the current value alone. money(-250000) renders
  // "$-250,000", which reads as a typo on the one line that matters most.
  const html = P.render(Object.assign({}, BASE, { summary: REPORT }));
  assert.ok(html.includes('down $250,000 from $1,250,000'));
  assert.ok(html.includes('down 6 from 78'));
  assert.ok(!html.includes('$-'));
  assert.ok(html.includes('cp-trend-down'));
});

test('large counts are readable', () => {
  const html = P.render(Object.assign({}, BASE, { summary: REPORT }));
  assert.ok(html.includes('15,000'));
});

test('a Not Rated report is not treated as a missing one', () => {
  // Not Rated is a real answer from a report we paid for. Offering "Get credit
  // report" again would charge twice for the same answer.
  const html = P.render(Object.assign({}, BASE, {
    summary: { scored: false, judgments: 1 }, can_pull_report: true }));
  assert.ok(/has not scored this company/i.test(html));
  assert.ok(!html.includes('data-pull-report='));
});

test('a bound company with no report offers to buy one, and says it is paid', () => {
  const html = P.render(Object.assign({}, BASE, {
    summary: null, can_pull_report: true,
    identity: { connect_id: 'US1', not_in_creditsafe: false } }));
  assert.ok(html.includes('data-pull-report='));
  assert.ok(/paid lookup/i.test(html));
});

test('with nothing bound there is nothing to buy', () => {
  // Guessing which of 39 candidates to charge for is the mistake the picker
  // exists to prevent.
  const html = P.render(Object.assign({}, BASE, {
    summary: null, can_pull_report: false }));
  assert.ok(!html.includes('data-pull-report='));
  assert.ok(/Confirm the Creditsafe company/i.test(html));
});

test('a viewer is never offered a billable button', () => {
  const html = P.render(Object.assign({}, BASE, {
    summary: null, can_pull_report: true, can_act: false,
    identity: { connect_id: 'US1' } }));
  assert.ok(!html.includes('data-pull-report='));
});

test('a viewer who may not act gets neither undo control', () => {
  const absent = P.render(Object.assign({}, BASE, {
    can_act: false,
    identity: { connect_id: null, fv_debtor_id: null, not_in_creditsafe: true } }));
  const bound = P.render(Object.assign({}, BASE, {
    can_act: false,
    identity: { connect_id: 'US1', fv_debtor_id: null, not_in_creditsafe: false } }));
  assert.ok(!absent.includes('data-cs-unabsent='));
  assert.ok(!bound.includes('data-cs-clear='));
});

test('the decision controls are in the header for someone who may act', () => {
  const html = P.render(BASE);
  assert.ok(html.includes('data-decide="Approved"'));
  assert.ok(html.includes('data-decide="Denied"'));
  assert.ok(html.includes('id="cp-limit"'));
});

test('a viewer gets no decision controls at all', () => {
  const html = P.render(Object.assign({}, BASE, { can_act: false }));
  assert.ok(!html.includes('data-decide='));
  assert.ok(!html.includes('id="cp-limit"'));
});

test('a suggested limit prefills the box but never names the button', () => {
  // 🚨 The button used to read "Approve $20,000" and kept saying it while the
  // analyst typed a different number into the box beside it. The click approved
  // what was TYPED, so the label was simply wrong. Tom: "Can we remove that
  // $5000 and just make it an approve button and let my user input limit
  // dictate that". The box is the amount; the button is the verb.
  const html = P.render(Object.assign({}, BASE, {
    engine: { suggested: 'auto_approve', limit: 20000, reasons: [], engine_version: 'v1' } }));
  assert.ok(/id="cp-limit"[^>]*value="20000"/.test(html), 'lost the prefill');
  assert.ok(!/Approve \$/.test(html), 'button still names an amount');
  assert.ok(/data-decide="Approved"[^>]*>Approved</.test(html));
});

test('the creditsafe candidates render as a picker', () => {
  const html = P.render(Object.assign({}, BASE, {
    cs_total: 39,
    cs_candidates: [{ connect_id: 'US001-X-1', name: 'C.H. ROBINSON WORLDWIDE',
                      address: 'Eden Prairie, MN', status: 'Active' }] }));
  assert.ok(html.includes('data-cs-pick="US001-X-1"'));
  assert.ok(html.includes('C.H. ROBINSON WORLDWIDE'));
  assert.ok(html.includes('39'));
});

test('a failed creditsafe search does not look like no matches', () => {
  const html = P.render(Object.assign({}, BASE, { cs_search_failed: true }));
  assert.ok(/unavailable|could not|failed/i.test(html));
});

test('a viewer gets no creditsafe pick controls', () => {
  const html = P.render(Object.assign({}, BASE, {
    can_act: false, cs_total: 39,
    cs_candidates: [{ connect_id: 'US1', name: 'X', address: '', status: '' }] }));
  assert.ok(!html.includes('data-cs-pick='));
  assert.ok(!html.includes('data-cs-absent='));
});

test('a hostile candidate name cannot inject markup', () => {
  const html = P.render(Object.assign({}, BASE, {
    cs_candidates: [{ connect_id: 'US1', name: '<img src=x onerror=alert(1)>',
                      address: '', status: '' }] }));
  assert.ok(!html.includes('<img src=x'));
});

test('a missing limit is not shown as a decided zero', function () {
  var missing = P.render(Object.assign({}, BASE, {
    fv_debtor: { company_id: '2030', name: 'C.H. ROBINSON', buy_limit: null,
                 restricted: false, is_active: true, state: 'IL' } }));
  assert.ok(!/\$0\b/.test(missing));

  // A real zero still reads as a real zero. At OperFi a $0 FactorView limit is
  // meaningful -- it means the team walked that debtor down -- so it must not
  // be hidden behind the same dash that means "no record".
  var zero = P.render(Object.assign({}, BASE, {
    fv_debtor: { company_id: '2030', name: 'C.H. ROBINSON', buy_limit: 0,
                 restricted: false, is_active: true, state: 'IL' } }));
  assert.ok(/\$0\b/.test(zero));
});

test('a missing prior limit and a missing candidate limit read the same way', function () {
  var html = P.render(Object.assign({}, BASE, {
    priors: [{ submission_id: '1', broker: 'Cascade', limit: null, decided_at: '' }],
    fv_candidates: [{ company_id: '9271', name: 'CH ROBINSON INTERNATIONAL',
                      buy_limit: null, restricted: false, is_active: true, state: '' }] }));
  assert.ok(!/\$0\b/.test(html));
});
