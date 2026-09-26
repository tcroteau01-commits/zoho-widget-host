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
  assert.equal(w.caAppPartyState('opened').label, 'Opened');
  assert.equal(w.caAppPartyState('completed').label, 'Completed');
  assert.equal(w.caAppPartyState('waived').label, 'Not required');
  assert.equal(w.caAppPartyState('bounced').label, 'Address bounced');
  assert.equal(w.caAppPartyState('expired').label, 'Expired');
});

// 'sent' and 'opened' used to collapse onto the same "Waiting" label -- the
// whole point of this build is a broker can tell "never opened" (check the
// address, resend) from "opened, still no answer" (call them), so the two
// must render differently: a different label AND a different class hook,
// but the SAME calm amber the rest of the waiting family already uses (no
// new pill colour). A completed party is untouched by any of this.
test('opened renders distinctly from sent -- own class, own label, same calm colour', () => {
  const w = boot();
  const sentState = w.caAppPartyState('sent');
  const openedState = w.caAppPartyState('opened');
  assert.notEqual(openedState.label, sentState.label);
  assert.notEqual(openedState.cls, sentState.cls);
  assert.equal(openedState.cls, 'opened');
  assert.match(html, /\.ca-app-state-waiting,\s*\.ca-app-state-expired,\s*\.ca-app-state-opened\s*\{\s*color:\s*#b86e00;/);
});

test('a sent party row reads "Waiting Xd", anchored to sent_at as it always has', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ status: 'sent', waiting_days: 3 }));
  assert.match(h, /ca-app-row-state ca-app-state-waiting/);
  assert.match(h, />Waiting 3 days</);
});

test('an opened party row reads "Opened, waiting Xd" -- never "opened Xd ago" (the API has no opened-to-now clock)', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ status: 'opened', waiting_days: 3 }));
  assert.match(h, /ca-app-row-state ca-app-state-opened/);
  assert.match(h, />Opened, waiting 3 days</);
  assert.doesNotMatch(h, /Opened 3 days ago/);
  assert.doesNotMatch(h, />Waiting</);
});

test('an opened party still offers a Nudge -- opened is not resolved', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ status: 'opened', waiting_days: 3 }));
  assert.match(h, /class="row-action ca-app-nudge" data-slot="trade1">Nudge</);
});

test('a completed party is unaffected by the opened/sent split', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ status: 'completed', waiting_days: 9 }));
  assert.match(h, /ca-app-row-state ca-app-state-completed/);
  assert.match(h, />Completed</);
  assert.doesNotMatch(h, /ca-app-nudge/);
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

// CREDITAPP2: correction is credit-only (a broker cannot fix a bounced
// address -- see customer-approvals-credit-app-recovery.test.mjs), so the
// copy must route to credit rather than send the broker after their own
// customer. Still no Nudge button: sending again to the same dead address is
// pointless.
test('a bounced party routes to credit, not the broker, and offers no Nudge button', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ status: 'bounced' }));
  assert.doesNotMatch(h, /ask your customer/i);
  assert.match(h, /Address bounced/);
  assert.doesNotMatch(h, /class="row-action ca-app-nudge"/);
});

test('an expired party still offers a Nudge (the server allows re-sending it)', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ status: 'expired', waiting_days: 12 }));
  assert.match(h, /Expired/);
  assert.match(h, /ca-app-nudge/);
});

// A broker can nudge a REFERENCE's party (mails a third party who has agreed
// to speak on the customer's behalf). The customer party is the applicant's
// own -- 'sent' is nudgeable server-side too until the customer submits, so
// the widget must never offer the button on this row: the only guard left
// would be the server's 400, and there should be no crafted request needed
// to hit it in the first place.
test('the customer row never offers a Nudge button, even while still sent', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ slot: 'customer', status: 'sent', waiting_days: 1 }));
  assert.doesNotMatch(h, /ca-app-nudge/);
});

test('the app_received summary reads with a comma, never an em dash', () => {
  const w = boot();
  const d = w.document;
  d.body.innerHTML =
    '<div class="panel-section" id="ca-app-section" style="display:none;">' +
      '<div id="ca-app-summary-text"></div>' +
      '<div id="ca-app-rows"></div>' +
      '<div id="ca-app-nudgeall-row" style="display:none;"><button id="ca-app-nudge-all"></button></div>' +
    '</div>';
  w.renderCreditAppSection({ ID: '9' }, {
    status: 'app_received',
    parties: [party({ slot: 'customer', status: 'completed', waiting_days: 0 })]
  });
  const summary = d.getElementById('ca-app-summary-text').textContent;
  assert.equal(summary, 'Application received, references not sent yet');
  assert.doesNotMatch(summary, /—|–/);
});

test('"Nudge all waiting" never counts or targets the customer row', () => {
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
      party({ slot: 'customer', status: 'sent', waiting_days: 1 }),
      party({ slot: 'trade1', status: 'sent' }),
      party({ slot: 'trade2', status: 'completed' })
    ]
  });
  // Only trade1 is actually nudgeable -- one waiting reference, so the
  // nudge-all control (which requires more than one) stays hidden, and its
  // label, if shown, must never count the customer party.
  assert.equal(d.getElementById('ca-app-nudgeall-row').style.display, 'none');
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
