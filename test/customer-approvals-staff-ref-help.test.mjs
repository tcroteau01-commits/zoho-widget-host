// STAFFREFHELP1 (Tom, 2026-10-19): Pat needed to change a trade reference's
// email, clicked the tracker row's Nudge, and got "Could not nudge. Try again."
// The row's controls were the broker's: /credit-app/nudge is scoped to the
// broker's own account (403 for staff), and Report a problem is a note TO
// credit. For staff the row now nudges through the customer-profile route,
// offers Fix email (a jump to the Correct address box) instead of Report a
// problem, and the recovery box says which control fixes which problem.
import { test, after } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');

// A successful nudge arms a 48-hour re-enable timer; close every window so it
// cannot hold the test process open.
const windows = [];
after(() => windows.forEach(w => w.close()));

function boot() {
  const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
                              url: 'https://x.github.io/' }).window;
  windows.push(w);
  return w;
}

function fixture(w, staff) {
  w.document.body.innerHTML =
    '<div class="panel-section" id="ca-app-section" style="display:none;">' +
      '<div id="ca-app-summary-text"></div>' +
      '<div class="ca-app-rows" id="ca-app-rows"></div>' +
      '<div id="ca-app-nudgeall-row" style="display:none;"><button type="button" id="ca-app-nudge-all"></button></div>' +
    '</div>' +
    (staff
      ? '<div class="panel-section" id="ca-app-staff-section" style="display:none;">' +
          '<div id="ca-app-staff-body"></div>' +
        '</div>'
      : '');
}

const PARTIES = [
  { slot: 'customer', name: 'Jamie', company: 'ACME', status: 'completed', waiting_days: 0 },
  { slot: 'trade1', name: 'Eric Fox', company: 'High Plains Farm Credit', status: 'opened', waiting_days: 0 },
  { slot: 'trade2', name: 'Dana', company: 'ABC 2', status: 'completed', waiting_days: 2 },
];

function statusPayload() {
  return { status: 'references_pending', parties: PARTIES.map(p => Object.assign({}, p)) };
}

function riskPayload() {
  return {
    status: 'references_pending',
    parties: PARTIES.filter(p => p.slot !== 'customer').map(p => Object.assign({}, p, { risk: null, response: null })),
    application: { company: { name: 'ACME' }, references: [] },
    pdf: { exists: false },
  };
}

function render(w, staff) {
  w.allClients = staff;
  fixture(w, staff);
  w.renderCreditAppSection({ ID: '9' }, statusPayload());
  if (staff) w.renderCreditAppStaffSection(riskPayload());
}

const row = (w, slot) => w.document.querySelector('.ca-app-row[data-slot="' + slot + '"]');
const msg = (w, slot) => w.document.querySelector('.ca-app-msg[data-slot-msg="' + slot + '"]');
const tick = () => new Promise(r => setTimeout(r, 0));

// ── the row's controls ──────────────────────────────────────────────────────

test('broker row is unchanged: Report a problem, no Fix email', () => {
  const w = boot();
  render(w, false);
  assert.ok(row(w, 'trade1').querySelector('.ca-app-report-problem'));
  assert.ok(row(w, 'trade1').querySelector('.ca-app-report-form'));
  assert.ok(!row(w, 'trade1').querySelector('.ca-app-fix-email'));
});

test('staff row: Fix email instead of Report a problem, only while unanswered', () => {
  const w = boot();
  render(w, true);
  assert.ok(row(w, 'trade1').querySelector('.ca-app-fix-email'));
  assert.ok(!row(w, 'trade1').querySelector('.ca-app-report-problem'));
  assert.ok(!row(w, 'trade1').querySelector('.ca-app-report-form'));
  assert.ok(!row(w, 'trade2').querySelector('.ca-app-fix-email'), 'answered reference has nothing to fix');
  assert.ok(!row(w, 'customer').querySelector('.ca-app-fix-email'));
});

test('the recovery box says which control fixes which problem', () => {
  const w = boot();
  render(w, true);
  const help = w.document.querySelector('.ca-app-recovery[data-slot="trade1"] .ca-app-recovery-help');
  assert.ok(help);
  assert.match(help.textContent, /Wrong email:.*Correct address/);
  assert.match(help.textContent, /no answer:.*Nudge/);
  assert.match(help.textContent, /Waive/);
});

// ── Fix email ───────────────────────────────────────────────────────────────

test('Fix email focuses that reference\'s Correct address box and flashes it', () => {
  const w = boot();
  render(w, true);
  w.document.getElementById('ca-app-staff-section').style.display = '';
  row(w, 'trade1').querySelector('.ca-app-fix-email').click();
  const box = w.document.querySelector('.ca-app-recovery[data-slot="trade1"]');
  assert.ok(box.classList.contains('ca-app-recovery-flash'));
  assert.equal(w.document.activeElement, box.querySelector('.ca-app-address-input'));
});

test('Fix email before Full Submission has loaded says so instead of doing nothing', () => {
  const w = boot();
  // Tracker rendered, /credit-app/risk not back yet: no Correct address box exists.
  w.allClients = true;
  fixture(w, true);
  w.renderCreditAppSection({ ID: '9' }, statusPayload());
  row(w, 'trade1').querySelector('.ca-app-fix-email').click();
  assert.match(msg(w, 'trade1').textContent, /still loading/);
});

// ── Nudge routing ───────────────────────────────────────────────────────────

function captureFetch(w, status, data) {
  const calls = [];
  w.fetch = (url, opts) => {
    calls.push({ url, opts });
    return Promise.resolve({ status, text: () => Promise.resolve(JSON.stringify(data)) });
  };
  return calls;
}

test('staff Nudge goes through the customer-profile route with the session', async () => {
  const w = boot();
  render(w, true);
  const calls = captureFetch(w, 200, { ok: true, sent: true, to: 'efox@hpfc.test' });
  row(w, 'trade1').querySelector('.ca-app-nudge').click();
  await tick(); await tick();
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/customer-profile\/9\/nudge$/);
  assert.equal(calls[0].opts.credentials, 'include');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { slot: 'trade1' });
  assert.match(msg(w, 'trade1').textContent, /Nudged just now \(efox@hpfc\.test\)/);
});

test('broker Nudge still goes through /credit-app/nudge', async () => {
  const w = boot();
  render(w, false);
  const calls = captureFetch(w, 200, { ok: true });
  row(w, 'trade1').querySelector('.ca-app-nudge').click();
  await tick(); await tick();
  assert.match(calls[0].url, /\/credit-app\/nudge$/);
  assert.equal(JSON.parse(calls[0].opts.body).slot, 'trade1');
  assert.equal(msg(w, 'trade1').textContent, 'Nudged just now');
});

// ── what a result says ──────────────────────────────────────────────────────

function handle(w, staff, rr) {
  w.allClients = staff;
  const d = w.document;
  d.body.innerHTML = '<div class="ca-app-row-action"><button class="ca-app-nudge">Nudge</button><div class="ca-app-msg"></div></div>';
  const btn = d.querySelector('button');
  const m = d.querySelector('.ca-app-msg');
  w.caAppHandleNudgeResult(rr, btn, m);
  return { btn, m, d };
}

test('a refusal shows the server\'s reason, not "Try again"', () => {
  const { m } = handle(boot(), false, { status: 403, data: { error: 'Not your customer' } });
  assert.equal(m.textContent, 'Could not nudge: Not your customer');
});

test('a reason-less failure keeps the generic text', () => {
  const { m } = handle(boot(), false, { status: 500, data: {} });
  assert.equal(m.textContent, 'Could not nudge. Try again.');
});

test('staff nudge recorded but mail rejected says the address may be bad', () => {
  const { m, btn } = handle(boot(), true, { status: 200, data: { ok: true, sent: false } });
  assert.match(m.textContent, /did not send.*Fix email/);
  assert.ok(btn.disabled, 'the reminder still counted -- cooldown applies');
});

test('staff at the reminder cap are pointed at Fix email / Waive, not credit@', () => {
  const { m, d } = handle(boot(), true, { status: 409, data: { error: 'nudge limit reached' } });
  assert.match(m.textContent, /All 3 reminders sent/);
  assert.ok(!d.querySelector('.ca-app-contact'));
});

test('broker at the reminder cap still gets the credit@ contact line', () => {
  const { d } = handle(boot(), false, { status: 409, data: { error: 'nudge limit reached' } });
  assert.ok(d.querySelector('.ca-app-contact'));
});
