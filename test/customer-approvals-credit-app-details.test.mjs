// CREDITAPP1 -- the Customer Approvals detail pane renders the submitted credit
// application two ways: an "Application details" block every broker sees (from
// GET /credit-app/application, a deliberately narrow, neutral subset) and a full
// submission block for OperFi staff only (from the now-widened GET
// /credit-app/risk). Same neutral-copy discipline as the tracker
// (customer-approvals-credit-app-tracker.test.mjs): the broker block must never
// carry a risk signal, score, or reason, and the staff fetch must only ever run
// for a staff (allClients) viewer.
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');

function boot() {
  return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
                           url: 'https://x.github.io/' }).window;
}

function detailFixture(w) {
  w.document.body.innerHTML =
    '<div class="panel-section" id="ca-app-detail-section" style="display:none;">' +
      '<div id="ca-app-detail-body"></div>' +
    '</div>';
}

function staffFixture(w) {
  w.document.body.innerHTML =
    '<div class="panel-section" id="ca-app-staff-section" style="display:none;">' +
      '<div id="ca-app-staff-body"></div>' +
    '</div>';
}

var LONG_BILLING_INSTRUCTIONS =
  'Route all invoices to AP, not the ops inbox. Terms are net 30 from receipt of a ' +
  'complete BOL/POD packet. CC billing@customer.example on every invoice over $5,000, ' +
  'and hold anything missing a PO number until Dispatch confirms the load number matches.';

function clientPayload(over) {
  return Object.assign({
    company: {
      name: 'ACME Produce LLC', dba: 'Acme Produce', business_type: 'LLC',
      address: { formatted: '1 Industrial Rd, Dallas, TX 75201' },
      phone: '2145551212', website: 'acmeproduce.com', year_established: '2011',
      parent_companies: 'Acme Holdings', mc: 'MC-111222', dot: '333444',
      currently_factoring: 'No',
    },
    billing: {
      contact_name: 'Pat Pay', phone: '2145559999', ap_email: 'ap@acme.com',
      instructions: LONG_BILLING_INSTRUCTIONS,
    },
    credit: { requested_limit: '50000', expected_monthly_volume: '120000' },
    bank: { name: 'First National Bank' },
    references: [
      { slot: 'trade1', company: 'ABC Produce', contact_name: 'Steve Alvarez', status: 'completed' },
      { slot: 'bank', company: '', contact_name: '', status: 'sent' },
    ],
    submitted_at: '2026-09-20T14:03:00Z',
    signer: { name: 'Jamie Rivera', title: 'Controller', email: 'jamie@acme.com' },
  }, over || {});
}

function staffPayload(over) {
  return Object.assign({
    status: 'ready_for_review',
    parties: [
      {
        slot: 'trade1', name: 'Steve Alvarez', company: 'ABC Produce', status: 'completed',
        waiting_days: 0,
        risk: { level: 'medium', checked_at: '2026-09-21T00:00:00Z',
                signals: [{ code: 'ip_mismatch', detail: 'Response IP does not match the address on file' }] },
        response: {
          legal_name: 'ABC Produce Inc', customer_since: '2018', credit_limit: '25000',
          high_credit: '30000', rating: 'A1', comments: 'Pays on time, no issues.',
          rep: { name: 'Dana Lee', title: 'Credit Manager', phone: '2145550101', email: 'dana@abcproduce.com' },
          verified_email: 'dana@abcproduce.com', net_terms: 'Net 30', last_sale: '2026-08-15',
          balance: '4200', aging: { current: '4200', '30': '0', '60': '0', '90+': '0' },
        },
      },
      {
        slot: 'bank', name: 'Jordan Banks', company: 'First National Bank', status: 'sent',
        waiting_days: 3, risk: null, response: null,
      },
    ],
    customer_verification: null,
    application: {
      business_type: 'LLC',
      company: {
        name: 'ACME Produce LLC', dba: 'Acme Produce', ein: '12-3456789',
        year_established: '2011', website: 'acmeproduce.com', parent_companies: 'Acme Holdings',
        formation_state: 'TX', formation_date: '2011-03-01', mc: 'MC-111222', dot: '333444',
        commodities: 'Produce', currently_factoring: 'No', phone: '2145551212',
        email: 'info@acme.com', address: { formatted: '1 Industrial Rd, Dallas, TX 75201' },
      },
      billing: { contact_name: 'Pat Pay', phone: '2145559999', ap_email: 'ap@acme.com',
                instructions: LONG_BILLING_INSTRUCTIONS },
      credit: { requested_limit: '50000', expected_monthly_volume: '120000' },
      owners: [{ name: 'Jamie Rivera', title: 'Managing Member', percentage: '100' }],
      risk_disclosure: 'No bankruptcies or judgments in the last 7 years.',
      bank: { name: 'First National Bank', officer: 'Jordan Banks', phone: '2145550202', email: 'jordan@fnb.com' },
      references: [
        { company: 'ABC Produce', contact: 'Steve Alvarez', phone: '2145550303',
          email: 'steve@abcproduce.com', address: { formatted: '9 Trade St, Fort Worth, TX 76102' } },
      ],
      signer: { name: 'Jamie Rivera', title: 'Controller', phone: '2145550404', email: 'jamie@acme.com' },
      submitted_at: '2026-09-20T14:03:00Z',
    },
    pdf: { exists: true, retrieval_path: '/credit-app/pdf?submission_id=9' },
  }, over || {});
}

// ── caAppFormatAddress ───────────────────────────────────────────────────────

test('caAppFormatAddress prefers the server\'s already-joined `formatted` string', () => {
  const w = boot();
  assert.equal(w.caAppFormatAddress({ formatted: '1 Main St, Dallas, TX 75201', line1: '1 Main St' }),
    '1 Main St, Dallas, TX 75201');
});

test('caAppFormatAddress builds from parts when formatted is missing', () => {
  const w = boot();
  const s = w.caAppFormatAddress({ line1: '1 Main St', city: 'Dallas', state: 'TX', postal: '75201' });
  assert.equal(s, '1 Main St, Dallas, TX 75201');
});

test('caAppFormatAddress tolerates a missing/empty address', () => {
  const w = boot();
  assert.equal(w.caAppFormatAddress(null), '');
  assert.equal(w.caAppFormatAddress({}), '');
});

// ── the broker "Application details" block ──────────────────────────────────

test('renderCreditAppDetailSection renders company, billing, and what was requested', () => {
  const w = boot();
  detailFixture(w);
  w.renderCreditAppDetailSection(clientPayload());
  const section = w.document.getElementById('ca-app-detail-section');
  const body = w.document.getElementById('ca-app-detail-body');
  assert.notEqual(section.style.display, 'none');
  assert.match(body.innerHTML, /ACME Produce LLC/);
  assert.match(body.innerHTML, /Acme Produce/);          // DBA
  assert.match(body.innerHTML, /Pat Pay/);                // billing contact
  assert.match(body.innerHTML, /ap@acme\.com/);
  assert.match(body.innerHTML, /MC-111222/);
  assert.match(body.innerHTML, /First National Bank/);
  assert.match(body.innerHTML, /Jamie Rivera/);           // signer
});

test('renderCreditAppDetailSection lists each reference by slot/company/contact/status, in plain words', () => {
  const w = boot();
  detailFixture(w);
  w.renderCreditAppDetailSection(clientPayload());
  const body = w.document.getElementById('ca-app-detail-body');
  assert.match(body.innerHTML, /Trade reference 1/);
  assert.match(body.innerHTML, /ABC Produce, Steve Alvarez/);
  assert.match(body.innerHTML, /Completed/);
  assert.match(body.innerHTML, /Bank reference/);
});

test('billing instructions render in full and wrap, never truncate', () => {
  const w = boot();
  detailFixture(w);
  w.renderCreditAppDetailSection(clientPayload());
  const body = w.document.getElementById('ca-app-detail-body');
  // The whole string survives verbatim -- no slice/substring/ellipsis.
  assert.ok(body.innerHTML.indexOf(LONG_BILLING_INSTRUCTIONS) !== -1,
    'the full instructions text should be present, not truncated');
  assert.doesNotMatch(body.innerHTML, /…/, 'no ellipsis character');
  // Rendered in the same note-block class the rest of the panel uses for free
  // text, which is white-space:pre-wrap (wraps) rather than nowrap+ellipsis.
  assert.match(body.innerHTML, /class="note-block"/);
});

test('the broker block never carries a risk/fraud/score/reason field', () => {
  const w = boot();
  detailFixture(w);
  w.renderCreditAppDetailSection(clientPayload());
  const body = w.document.getElementById('ca-app-detail-body');
  assert.doesNotMatch(body.innerHTML, /risk/i);
  assert.doesNotMatch(body.innerHTML, /fraud/i);
  assert.doesNotMatch(body.innerHTML, /score/i);
});

// ── fetchCreditAppApplication: fetch, render, quiet degradation ─────────────

test('fetchCreditAppApplication renders the block on a live application', async () => {
  const w = boot();
  detailFixture(w);
  w.brokerEmail = 'b@x.com';
  const payload = clientPayload();
  let calledUrl = null;
  w.fetch = (u) => { calledUrl = u; return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }); };
  w.fetchCreditAppApplication({ ID: '9' });
  await new Promise(r => setTimeout(r, 30));
  assert.match(calledUrl, /\/credit-app\/application\?/);
  assert.match(calledUrl, /submission_id=9/);
  assert.notEqual(w.document.getElementById('ca-app-detail-section').style.display, 'none');
});

test('fetchCreditAppApplication degrades quietly on a 404 (flag off)', async () => {
  const w = boot();
  detailFixture(w);
  w.brokerEmail = 'b@x.com';
  w.fetch = () => Promise.resolve({ ok: false, status: 404 });
  w.fetchCreditAppApplication({ ID: '9' });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(w.document.getElementById('ca-app-detail-section').style.display, 'none');
});

test('fetchCreditAppApplication leaves the pane intact on a network failure', async () => {
  const w = boot();
  detailFixture(w);
  w.brokerEmail = 'b@x.com';
  w.fetch = () => Promise.reject(new Error('offline'));
  assert.doesNotThrow(() => w.fetchCreditAppApplication({ ID: '9' }));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(w.document.getElementById('ca-app-detail-section').style.display, 'none');
});

// ── fetchCreditAppRisk: staff-only gate ─────────────────────────────────────

test('a non-staff viewer never calls the risk endpoint', async () => {
  const w = boot();
  // No #ca-app-staff-section at all -- exactly what the panel looks like for a
  // non-staff viewer (caAppStaffSectionHtml is the empty string for them).
  w.document.body.innerHTML = '<div class="panel-section" id="ca-app-detail-section"></div>';
  w.brokerEmail = 'broker@customer.com';
  w.allClients = false;
  let called = false;
  w.fetch = () => { called = true; return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); };
  w.fetchCreditAppRisk({ ID: '9' });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(called, false, 'fetch must never run for a non-staff viewer');
});

test('a non-staff viewer never calls the risk endpoint even if the staff section somehow exists', async () => {
  const w = boot();
  staffFixture(w);
  w.brokerEmail = 'broker@customer.com';
  w.allClients = false;
  let called = false;
  w.fetch = () => { called = true; return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); };
  w.fetchCreditAppRisk({ ID: '9' });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(called, false, 'the allClients gate must run before any fetch, not rely on the section being absent');
});

test('a staff viewer\'s fetchCreditAppRisk calls the risk endpoint and renders the full block', async () => {
  const w = boot();
  staffFixture(w);
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  const payload = staffPayload();
  let calledUrl = null;
  w.fetch = (u) => { calledUrl = u; return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }); };
  w.fetchCreditAppRisk({ ID: '9' });
  await new Promise(r => setTimeout(r, 30));
  assert.match(calledUrl, /\/credit-app\/risk\?/);
  assert.notEqual(w.document.getElementById('ca-app-staff-section').style.display, 'none');
});

test('a 403 from the risk endpoint leaves the pane looking normal, never an error', async () => {
  const w = boot();
  staffFixture(w);
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = () => Promise.resolve({ ok: false, status: 403 });
  assert.doesNotThrow(() => w.fetchCreditAppRisk({ ID: '9' }));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(w.document.getElementById('ca-app-staff-section').style.display, 'none');
});

test('a network failure on the risk endpoint leaves the pane looking normal', async () => {
  const w = boot();
  staffFixture(w);
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = () => Promise.reject(new Error('offline'));
  assert.doesNotThrow(() => w.fetchCreditAppRisk({ ID: '9' }));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(w.document.getElementById('ca-app-staff-section').style.display, 'none');
});

// ── the staff-only "full submission" block ──────────────────────────────────

test('renderCreditAppStaffSection renders the full applicant detail the broker block withholds', () => {
  const w = boot();
  staffFixture(w);
  w.renderCreditAppStaffSection(staffPayload());
  const body = w.document.getElementById('ca-app-staff-body');
  assert.match(body.innerHTML, /12-3456789/);          // EIN
  assert.match(body.innerHTML, /TX/);                   // formation state
  assert.match(body.innerHTML, /Jordan Banks/);          // bank officer, staff-only
  assert.match(body.innerHTML, /No bankruptcies/);       // risk_disclosure
  assert.match(body.innerHTML, /Managing Member/);       // owner
});

test('renderCreditAppStaffSection renders each reference\'s full answer: terms, limits, balance, aging, rating, comments, rep, verified email', () => {
  const w = boot();
  staffFixture(w);
  w.renderCreditAppStaffSection(staffPayload());
  const body = w.document.getElementById('ca-app-staff-body');
  assert.match(body.innerHTML, /Net 30/);                // terms
  assert.match(body.innerHTML, /25000|25,000/);           // credit limit
  assert.match(body.innerHTML, /4200|4,200/);             // balance
  assert.match(body.innerHTML, /A1/);                     // rating
  assert.match(body.innerHTML, /Pays on time, no issues\./); // comments
  assert.match(body.innerHTML, /Dana Lee/);               // rep
  assert.match(body.innerHTML, /dana@abcproduce\.com/);   // verified email
  // aging split, bucket keys and values both present
  assert.match(body.innerHTML, /current/i);
  assert.match(body.innerHTML, /90\+/);
});

test('renderCreditAppStaffSection carries the risk signals already available', () => {
  const w = boot();
  staffFixture(w);
  w.renderCreditAppStaffSection(staffPayload());
  const body = w.document.getElementById('ca-app-staff-body');
  assert.match(body.innerHTML, /medium/i);
  assert.match(body.innerHTML, /ip_mismatch/);
  assert.match(body.innerHTML, /Response IP does not match/);
});

test('renderCreditAppStaffSection links the signed PDF using the retrieval path, only when it exists', () => {
  const w = boot();
  staffFixture(w);
  w.brokerEmail = 'staff@operfi.com';
  w.renderCreditAppStaffSection(staffPayload());
  const body = w.document.getElementById('ca-app-staff-body');
  const link = body.querySelector('a[href*="/credit-app/pdf"]');
  assert.ok(link, 'a PDF link should be rendered');
  assert.match(link.href, /submission_id=9/);
  assert.match(link.href, /email=staff%40operfi\.com/);
});

test('renderCreditAppStaffSection renders no PDF link when none exists', () => {
  const w = boot();
  staffFixture(w);
  w.renderCreditAppStaffSection(staffPayload({ pdf: { exists: false, retrieval_path: '/credit-app/pdf?submission_id=9' } }));
  const body = w.document.getElementById('ca-app-staff-body');
  assert.equal(body.querySelector('a[href*="/credit-app/pdf"]'), null);
});

// ── the styles exist ─────────────────────────────────────────────────────────

test('the Application Details / staff submission styles exist', () => {
  assert.match(html, /\.ca-app-doc-head\s*\{/);
  assert.match(html, /\.ca-app-staff-ref\s*\{/);
});
