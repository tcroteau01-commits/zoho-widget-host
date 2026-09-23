// CREDITAPP1 Task 16 -- the Credit Application tracker inside the Customer
// Approvals detail pane. Shows which named party we're waiting on, in plain
// words, with a Nudge button, and never a fraud signal or a reason: the
// backend split (credit_app_routes.py) keeps those server-side on purpose,
// and this section must not invent a way to show what it never receives.
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

function party(over) {
  return Object.assign({ slot: 'trade1', name: 'Steve Alvarez', company: 'ABC Produce',
                         status: 'sent', waiting_days: 3 }, over || {});
}

// ── party state, in plain words ──────────────────────────────────────────────

test('caAppPartyState maps every documented party status to a plain-words label', () => {
  const w = boot();
  assert.equal(w.caAppPartyState('sent').label, 'Waiting');
  assert.equal(w.caAppPartyState('opened').label, 'Waiting');
  assert.equal(w.caAppPartyState('completed').label, 'Completed');
  assert.equal(w.caAppPartyState('waived').label, 'Not required');
  assert.equal(w.caAppPartyState('bounced').label, 'Address bounced');
  assert.equal(w.caAppPartyState('expired').label, 'Expired');
});

test('caAppPartyState never breaks on an unrecognised status', () => {
  const w = boot();
  const s = w.caAppPartyState('some_future_status');
  assert.equal(s.label, 'some_future_status');
});

test('caAppWaitingText renders whole days, singular for 1', () => {
  const w = boot();
  assert.equal(w.caAppWaitingText(3), '3 days');
  assert.equal(w.caAppWaitingText(1), '1 day');
  assert.equal(w.caAppWaitingText(0), 'less than a day');
  assert.equal(w.caAppWaitingText(null), '');
});

// ── row rendering: name, company, state, no fraud signals ever ─────────────

test('a waiting party row names WHO we are waiting on, by name and company', () => {
  const w = boot();
  const h = w.caAppRowHtml(party());
  assert.match(h, /Trade reference 1/);
  assert.match(h, /ABC Produce, Steve Alvarez/);
  assert.match(h, />Waiting 3 days</);
  assert.match(h, /class="row-action ca-app-nudge" data-slot="trade1">Nudge</);
});

test('a completed party gets a check state and no Nudge button', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ status: 'completed', waiting_days: 1 }));
  assert.match(h, /Completed/);
  assert.doesNotMatch(h, /ca-app-nudge/);
});

test('a waived party reads "Not required", not blank or a code', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ status: 'waived' }));
  assert.match(h, /Not required/);
  assert.doesNotMatch(h, /ca-app-nudge/);
});

test('a bounced party gets the exact fix-it copy and no Nudge button', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ status: 'bounced' }));
  assert.match(h, /Address bounced, ask your customer for a new one/);
  assert.doesNotMatch(h, /ca-app-nudge/);
});

test('an expired party still offers a Nudge (the server allows re-sending it)', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ status: 'expired', waiting_days: 12 }));
  assert.match(h, /Expired/);
  assert.match(h, /ca-app-nudge/);
});

test('row markup never carries a risk/fraud/score field', () => {
  const w = boot();
  for (const status of ['sent', 'opened', 'completed', 'bounced', 'expired', 'waived']) {
    const h = w.caAppRowHtml(party({ status }));
    assert.doesNotMatch(h, /risk/i);
    assert.doesNotMatch(h, /fraud/i);
    assert.doesNotMatch(h, /score/i);
    assert.doesNotMatch(h, /reason/i);
  }
});

// ── ordering ─────────────────────────────────────────────────────────────────

test('caAppOrderedParties always renders customer, trade1-3, bank in that order', () => {
  const w = boot();
  const parties = [
    party({ slot: 'bank' }), party({ slot: 'customer' }),
    party({ slot: 'trade3' }), party({ slot: 'trade1' }), party({ slot: 'trade2' })
  ];
  const ordered = w.caAppOrderedParties(parties);
  assert.deepEqual(ordered.map(p => p.slot), ['customer', 'trade1', 'trade2', 'trade3', 'bank']);
});

test('caAppOrderedParties tolerates a missing slot (e.g. no bank reference yet)', () => {
  const w = boot();
  const ordered = w.caAppOrderedParties([party({ slot: 'customer' }), party({ slot: 'trade1' })]);
  assert.deepEqual(ordered.map(p => p.slot), ['customer', 'trade1']);
});

// ── the section: fetch, render, and quiet degradation ───────────────────────

test('renderCreditAppSection fills the panel and unhides it', () => {
  const w = boot();
  const d = w.document;
  d.body.innerHTML =
    '<div class="panel-section" id="ca-app-section" style="display:none;">' +
      '<div id="ca-app-summary-text"></div>' +
      '<div id="ca-app-rows"></div>' +
      '<div id="ca-app-nudgeall-row" style="display:none;"><button id="ca-app-nudge-all"></button></div>' +
    '</div>';
  w.renderCreditAppSection({ ID: '9' }, {
    status: 'references_pending',
    parties: [
      party({ slot: 'customer', status: 'completed', waiting_days: 0 }),
      party({ slot: 'trade1', status: 'completed' }),
      party({ slot: 'trade2', status: 'sent' }),
      party({ slot: 'bank', status: 'sent' })
    ]
  });
  const section = d.getElementById('ca-app-section');
  assert.notEqual(section.style.display, 'none');
  assert.match(d.getElementById('ca-app-rows').innerHTML, /Bank reference/);
  assert.match(d.getElementById('ca-app-summary-text').textContent, /Waiting on references/);
  // Two waiting parties (trade2, bank) -> the nudge-all control appears.
  assert.notEqual(d.getElementById('ca-app-nudgeall-row').style.display, 'none');
  assert.match(d.getElementById('ca-app-nudge-all').textContent, /Nudge all waiting \(2\)/);
});

test('renderCreditAppSection hides the nudge-all control with 0 or 1 waiting party', () => {
  const w = boot();
  const d = w.document;
  d.body.innerHTML =
    '<div class="panel-section" id="ca-app-section" style="display:none;">' +
      '<div id="ca-app-summary-text"></div>' +
      '<div id="ca-app-rows"></div>' +
      '<div id="ca-app-nudgeall-row" style="display:none;"><button id="ca-app-nudge-all"></button></div>' +
    '</div>';
  w.renderCreditAppSection({ ID: '9' }, {
    status: 'ready_for_review',
    parties: [party({ slot: 'customer', status: 'completed' }), party({ slot: 'trade1', status: 'sent' })]
  });
  assert.equal(d.getElementById('ca-app-nudgeall-row').style.display, 'none');
});

test('renderCreditAppSection leaves the section hidden with no parties', () => {
  const w = boot();
  const d = w.document;
  d.body.innerHTML = '<div class="panel-section" id="ca-app-section" style="display:none;"></div>';
  w.renderCreditAppSection({ ID: '9' }, { status: 'sent', parties: [] });
  assert.equal(d.getElementById('ca-app-section').style.display, 'none');
});

test('fetchCreditAppStatus degrades quietly on a 404 (feature flag off)', async () => {
  const w = boot();
  const d = w.document;
  d.body.innerHTML =
    '<div class="panel-section" id="ca-app-section" style="display:none;">' +
      '<div id="ca-app-summary-text"></div><div id="ca-app-rows"></div>' +
      '<div id="ca-app-nudgeall-row" style="display:none;"><button id="ca-app-nudge-all"></button></div>' +
    '</div>';
  w.brokerEmail = 'b@x.com';
  w.fetch = () => Promise.resolve({ ok: false, status: 404 });
  w.fetchCreditAppStatus({ ID: '9' });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(d.getElementById('ca-app-section').style.display, 'none');
});

test('fetchCreditAppStatus degrades quietly for an application that predates this build (no record, 403)', async () => {
  const w = boot();
  const d = w.document;
  d.body.innerHTML =
    '<div class="panel-section" id="ca-app-section" style="display:none;">' +
      '<div id="ca-app-summary-text"></div><div id="ca-app-rows"></div>' +
      '<div id="ca-app-nudgeall-row" style="display:none;"><button id="ca-app-nudge-all"></button></div>' +
    '</div>';
  w.brokerEmail = 'b@x.com';
  w.fetch = () => Promise.resolve({ ok: false, status: 403 });
  w.fetchCreditAppStatus({ ID: '9' });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(d.getElementById('ca-app-section').style.display, 'none');
});

test('fetchCreditAppStatus renders the section on a live application', async () => {
  const w = boot();
  const d = w.document;
  d.body.innerHTML =
    '<div class="panel-section" id="ca-app-section" style="display:none;">' +
      '<div id="ca-app-summary-text"></div><div id="ca-app-rows"></div>' +
      '<div id="ca-app-nudgeall-row" style="display:none;"><button id="ca-app-nudge-all"></button></div>' +
    '</div>';
  w.brokerEmail = 'b@x.com';
  const payload = { status: 'sent', parties: [party({ slot: 'customer', status: 'sent', waiting_days: 2 })] };
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
  w.fetchCreditAppStatus({ ID: '9' });
  await new Promise(r => setTimeout(r, 30));
  assert.notEqual(d.getElementById('ca-app-section').style.display, 'none');
  assert.match(d.getElementById('ca-app-rows').innerHTML, /Customer application/);
});

// ── nudge outcomes ───────────────────────────────────────────────────────────

function stubButtonAndMsg(w) {
  const d = w.document;
  d.body.innerHTML =
    '<div class="ca-app-row-action"><button class="row-action" id="btn">Nudge</button>' +
    '<div class="ca-app-msg" id="msg"></div></div>';
  return { btn: d.getElementById('btn'), msg: d.getElementById('msg') };
}

// jsdom's window.setTimeout mimics browser semantics (returns a bare number, not
// a Node Timeout), so caAppScheduleReenable's own `.unref` guard -- real and
// necessary for the up-to-48h cooldown timer it sets in production -- has
// nothing to grab here, and a real 42-48h OS timer left running would hang the
// test process. Stub it exactly the way this widget's own tests already stub
// window.fetch for a network call: swap the primitive, assert on the outcome,
// no real timer ever created.
function stubTimersInert(w) {
  w.setTimeout = () => 0;
  w.clearTimeout = () => {};
}

test('caAppHandleNudgeResult on 200: confirms and disables (starts the cooldown)', () => {
  const w = boot();
  stubTimersInert(w);
  const { btn, msg } = stubButtonAndMsg(w);
  w.caAppHandleNudgeResult({ status: 200, data: { ok: true } }, btn, msg);
  assert.equal(btn.disabled, true);
  assert.equal(btn.textContent, 'Nudged');
  assert.match(msg.textContent, /Nudged just now/);
});

test('caAppHandleNudgeResult on 409 cooldown: shows the server text and disables', () => {
  const w = boot();
  stubTimersInert(w);
  const { btn, msg } = stubButtonAndMsg(w);
  w.caAppHandleNudgeResult({ status: 409, data: { error: 'nudged 6h ago' } }, btn, msg);
  assert.equal(btn.disabled, true);
  assert.equal(msg.textContent, 'nudged 6h ago');
  assert.equal(msg.className, 'ca-app-msg error');
});

test('caAppHandleNudgeResult on 409 limit reached: replaces the button with the contact line', () => {
  const w = boot();
  const { btn } = stubButtonAndMsg(w);
  w.caAppHandleNudgeResult({ status: 409, data: { error: 'nudge limit reached' } }, btn, null);
  const wrap = w.document.querySelector('.ca-app-row-action');
  assert.doesNotMatch(wrap.innerHTML, /<button/);
  assert.match(wrap.innerHTML, /credit@operfi\.com/);
  assert.match(wrap.innerHTML, /mailto:credit@operfi\.com/);
});

test('caAppHandleNudgeResult on an unexpected error: re-enables so the broker can retry', () => {
  const w = boot();
  const { btn, msg } = stubButtonAndMsg(w);
  w.caAppHandleNudgeResult({ status: 500, data: {} }, btn, msg);
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, 'Nudge');
  assert.match(msg.textContent, /Could not nudge/);
});

// ── never a fraud signal in the section's own markup helpers ────────────────

test('the Credit Application section styles exist and are scoped under ca-app', () => {
  assert.match(html, /\.ca-app-row\s*\{/);
  assert.match(html, /\.ca-app-state-bounced\s*\{/);
});
