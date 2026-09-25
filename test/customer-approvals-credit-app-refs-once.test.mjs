// Tom, 2026-09-25, from the live pane: "its showing the references twice so it
// needs to pick 1 of those locations and not provide clutter." The Credit
// Application tracker at the top of the Customer Approvals detail pane and the
// References list inside Application Details were rendering the same four
// references, with the same slot labels, the same company/contact, and the same
// status, a few inches apart. The tracker won: it carries everything the lower
// list did plus waiting time, the stalled and bounced overlays, Nudge, Nudge all
// waiting, and Report a problem.
//
// This file is the regression: build the whole application area of the pane the
// way renderPanel does, run every renderer that fills it, and count.
//
// WHAT COUNTS AS A DUPLICATE: a reference rendered as a STATUS ROW -- slot label
// beside its plain-words state. Those are .ca-app-row (tracker) and
// .ca-app-detail-ref (the Application Details list, and the staff Reference
// Contact Records list). A staff viewer also sees that reference twice more, in
// Reference Contact Records (phone, email, address) and Reference Answers (the
// survey itself), and neither is a duplicate of the tracker: they carry the
// OperFi-only detail the tracker is forbidden to show, and Tom did not report
// them. Those blocks render as .ca-app-detail-ref with a phone/email state and
// .ca-app-staff-ref, so the count below distinguishes them by requiring the
// state text the tracker uses.
//
// Same harness as customer-approvals-credit-app-tracker.test.mjs and
// customer-approvals-credit-app-details.test.mjs: JSDOM boots the real file and
// the real renderers run against a DOM fixture.
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

// The application area of the detail pane, in the order renderPanel emits it:
// tracker, Application Details, then the staff full submission -- which is
// absent from the DOM entirely for a broker (caAppStaffSectionHtml's allClients
// gate), so `staff` controls presence, not just visibility.
function paneFixture(w, staff) {
  w.document.body.innerHTML =
    '<div class="panel-section" id="ca-app-section" style="display:none;">' +
      '<div class="panel-section-title">Credit Application<span id="ca-app-summary-text"></span></div>' +
      '<div class="ca-app-rows" id="ca-app-rows"></div>' +
      '<div class="ca-app-nudgeall-row" id="ca-app-nudgeall-row" style="display:none;">' +
        '<button type="button" id="ca-app-nudge-all"></button>' +
      '</div>' +
    '</div>' +
    '<div class="panel-section" id="ca-app-detail-section" style="display:none;">' +
      '<div class="panel-section-title">Application Details</div>' +
      '<div id="ca-app-detail-body"></div>' +
    '</div>' +
    (staff
      ? '<div class="panel-section" id="ca-app-staff-section" style="display:none;">' +
          '<div class="panel-section-title">Full Submission (OperFi Staff)</div>' +
          '<div id="ca-app-staff-body"></div>' +
        '</div>'
      : '');
}

// Four references, the shape Tom was looking at: three trade plus the bank, a
// mix of completed and still waiting. The customer slot rides along because the
// tracker renders it and the lower list never did -- it must survive the fix.
const PARTIES = [
  { slot: 'customer', name: 'Jamie Rivera', company: 'ACME Produce LLC', status: 'completed', waiting_days: 0 },
  { slot: 'trade1', name: 'John A', company: 'ABC 1', status: 'completed', waiting_days: 1 },
  { slot: 'trade2', name: 'Dana Lee', company: 'ABC 2', status: 'sent', waiting_days: 4 },
  { slot: 'trade3', name: 'Jeff Smith', company: 'ABC 3', status: 'sent', waiting_days: 0 },
  { slot: 'bank', name: 'Jordan Banks', company: 'First National Bank', status: 'sent', waiting_days: 3 },
];

// What /credit-app/status sends the tracker.
function statusPayload() {
  return { status: 'references_pending', parties: PARTIES.map(p => Object.assign({}, p)) };
}

// What /credit-app/application sends Application Details. `references` is still
// on the payload after the fix -- the server did not change -- and the block is
// simply expected not to render it. The bank slot's contact_name is blank on
// purpose server-side (_client_application_payload withholds the bank officer's
// name, which the tracker does show), which is why the lower list was a strict
// subset even at its widest.
function clientPayload() {
  return {
    company: { name: 'ACME Produce LLC', address: { formatted: '1 Industrial Rd, Dallas, TX 75201' } },
    billing: { contact_name: 'Pat Pay', ap_email: 'ap@acme.com' },
    credit: { requested_limit: '50000', expected_monthly_volume: '120000' },
    bank: { name: 'First National Bank' },
    references: PARTIES.filter(p => p.slot !== 'customer').map(p => ({
      slot: p.slot, company: p.company,
      contact_name: p.slot === 'bank' ? '' : p.name, status: p.status,
    })),
    submitted_at: '2026-09-20T14:03:00Z',
    signer: { name: 'Jamie Rivera', title: 'Controller', email: 'jamie@acme.com' },
  };
}

// What /credit-app/risk sends the staff block -- trimmed to the parts that
// render a reference, since that is all this file counts.
function riskPayload() {
  return {
    status: 'references_pending',
    parties: PARTIES.filter(p => p.slot !== 'customer').map(p => Object.assign({}, p, { risk: null, response: null })),
    customer_verification: null,
    application: {
      company: { name: 'ACME Produce LLC' },
      billing: { contact_name: 'Pat Pay' },
      credit: { requested_limit: '50000' },
      bank: { name: 'First National Bank', officer: 'Jordan Banks' },
      references: [
        { company: 'ABC 1', contact: 'John A', phone: '2145550303', email: 'john@abc1.com' },
        { company: 'ABC 2', contact: 'Dana Lee', phone: '2145550304', email: 'dana@abc2.com' },
        { company: 'ABC 3', contact: 'Jeff Smith', phone: '2145550305', email: 'jeff@abc3.com' },
      ],
      signer: { name: 'Jamie Rivera' },
      submitted_at: '2026-09-20T14:03:00Z',
    },
    pdf: { exists: false },
  };
}

// Every status-row rendering of one reference anywhere in the pane: a container
// naming that slot AND carrying that party's plain-words state. See the header
// note for why the staff contact/answer blocks do not match.
function statusRowsFor(w, slot) {
  const label = w.caAppSlotLabel(slot);
  const state = w.caAppPartyState(PARTIES.find(p => p.slot === slot).status).label;
  return Array.from(w.document.querySelectorAll('.ca-app-row, .ca-app-detail-ref'))
    .filter(el => el.textContent.indexOf(label) !== -1 && el.textContent.indexOf(state) !== -1);
}

function renderBrokerPane(w) {
  w.allClients = false;
  paneFixture(w, false);
  w.renderCreditAppSection({ ID: '9' }, statusPayload());
  w.renderCreditAppDetailSection(clientPayload());
}

function renderStaffPane(w) {
  w.allClients = true;
  paneFixture(w, true);
  w.renderCreditAppSection({ ID: '9' }, statusPayload());
  w.renderCreditAppDetailSection(clientPayload());
  w.renderCreditAppStaffSection(riskPayload());
}

// ── the duplication itself, both audiences ──────────────────────────────────

test('broker viewer: each reference has exactly one status row in the pane', () => {
  const w = boot();
  renderBrokerPane(w);
  for (const p of PARTIES) {
    assert.equal(statusRowsFor(w, p.slot).length, 1,
      p.slot + ' should render as a status row exactly once for a broker');
  }
});

test('staff viewer: each reference has exactly one status row in the pane', () => {
  const w = boot();
  renderStaffPane(w);
  for (const p of PARTIES) {
    assert.equal(statusRowsFor(w, p.slot).length, 1,
      p.slot + ' should render as a status row exactly once for OperFi staff');
  }
});

// The one row that survives is the tracker's, not the lower list's -- it is the
// row that carries the actions, and losing those would be a worse outcome than
// the duplication was.
test('the surviving row is the tracker row, with its actions intact', () => {
  const w = boot();
  renderStaffPane(w);
  for (const slot of ['trade1', 'trade2', 'trade3', 'bank']) {
    const rows = statusRowsFor(w, slot);
    assert.equal(rows.length, 1);
    assert.ok(rows[0].classList.contains('ca-app-row'),
      slot + ' should survive as the tracker row');
    assert.ok(rows[0].closest('#ca-app-section'),
      slot + ' should survive inside the tracker section');
    assert.ok(rows[0].querySelector('.ca-app-report-problem'),
      slot + ' should keep its Report a problem control');
  }
  // Nudge only where nudging is still useful: trade1 is completed.
  assert.ok(!statusRowsFor(w, 'trade1')[0].querySelector('.ca-app-nudge'));
  assert.ok(statusRowsFor(w, 'trade2')[0].querySelector('.ca-app-nudge'));
});

// ── the lower list is gone, and nothing else in that block moved ────────────

test('Application Details no longer renders a References list, or a stranded heading', () => {
  const w = boot();
  renderBrokerPane(w);
  const body = w.document.getElementById('ca-app-detail-body');
  assert.equal(body.querySelectorAll('.ca-app-detail-ref').length, 0,
    'no reference rows in the broker application-detail block');
  assert.ok(!/>References</.test(body.innerHTML),
    'no empty References heading left behind');
  assert.ok(!/ca-app-detail-refs/.test(body.innerHTML),
    'no empty reference list wrapper left behind');
});

test('Application Details still renders everything else it always did', () => {
  const w = boot();
  renderBrokerPane(w);
  const section = w.document.getElementById('ca-app-detail-section');
  const body = w.document.getElementById('ca-app-detail-body');
  assert.notEqual(section.style.display, 'none');
  assert.match(body.innerHTML, /ACME Produce LLC/);            // company
  assert.match(body.innerHTML, /Pat Pay/);                      // billing
  assert.match(body.innerHTML, /First National Bank/);          // bank, under Requested
  assert.match(body.innerHTML, />Company</);
  assert.match(body.innerHTML, />Billing</);
  assert.match(body.innerHTML, />Requested</);
  assert.match(body.innerHTML, />Signed</);
});

// The tracker is the only place the references live now, so it must not be the
// half of the pane that is gated on the viewer. Both audiences get the same
// tracker markup; only the staff block above it differs.
test('the tracker is not gated on allClients -- both audiences see the same rows', () => {
  const brokerW = boot();
  renderBrokerPane(brokerW);
  const staffW = boot();
  renderStaffPane(staffW);
  const rowsOf = (w) => Array.from(w.document.querySelectorAll('#ca-app-rows .ca-app-row'))
    .map(el => el.dataset.slot);
  assert.deepEqual(rowsOf(brokerW), ['customer', 'trade1', 'trade2', 'trade3', 'bank']);
  assert.deepEqual(rowsOf(staffW), rowsOf(brokerW));
});

// The staff-only blocks are untouched by this fix: they carry contact detail and
// the survey answers, which the tracker never shows and never should.
test('the staff full-submission blocks still carry their own unique reference detail', () => {
  const w = boot();
  renderStaffPane(w);
  const body = w.document.getElementById('ca-app-staff-body');
  assert.match(body.innerHTML, /Reference Contact Records/);
  assert.match(body.innerHTML, /john@abc1\.com/);
  assert.match(body.innerHTML, /Reference Answers/);
});
