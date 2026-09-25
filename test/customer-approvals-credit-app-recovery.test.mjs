// CREDITAPP2 Task 7 -- the widget half of stuck-application recovery. Three
// fixes/additions on top of the tracker (customer-approvals-credit-app-tracker
// .test.mjs) and the staff full-submission block
// (customer-approvals-credit-app-details.test.mjs):
//
//   1. The bounced row no longer tells the broker to do something the product
//      refuses -- correction is credit-only.
//   2. A stalled reference (sent, never opened, past CREDIT_APP_STALL_DAYS)
//      reads distinctly from a plain wait, as an overlay on 'sent', never a
//      new status.
//   3. Three new staff-only-vs-broker-visible controls: Correct address and
//      Waive (OperFi staff only, absent from the DOM entirely for a broker)
//      and Report a problem (any viewer, matching Nudge).
//
// Same harness this suite already uses throughout (JSDOM booting the real
// file, no separate mock layer) -- see the two files named above.
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
                         status: 'sent', waiting_days: 3, stalled: false }, over || {});
}

function trackerFixture(w) {
  w.document.body.innerHTML =
    '<div class="panel-section" id="ca-app-section" style="display:none;">' +
      '<div id="ca-app-summary-text"></div>' +
      '<div id="ca-app-rows"></div>' +
      '<div id="ca-app-nudgeall-row" style="display:none;"><button id="ca-app-nudge-all"></button></div>' +
    '</div>';
}

function staffFixture(w) {
  w.document.body.innerHTML =
    '<div class="panel-section" id="ca-app-staff-section" style="display:none;">' +
      '<div id="ca-app-staff-body"></div>' +
    '</div>';
}

function staffPayload(over) {
  return Object.assign({
    status: 'references_pending',
    parties: [
      { slot: 'bank', name: 'Jordan Banks', company: 'First National Bank', status: 'sent',
        waiting_days: 6, stalled: true, risk: null, address_risk: null, response: null },
    ],
    customer_verification: null,
    application: { company: { name: 'ACME Produce LLC' } },
    pdf: { exists: false, retrieval_path: '/credit-app/pdf?submission_id=9' },
  }, over || {});
}

// ── 1. Bounced copy routes to credit, never the broker ──────────────────────

test('the bounced row does not tell the broker to fix the address themselves', () => {
  const w = boot();
  const html = w.caAppRowHtml(party({ status: 'bounced' }));
  assert.ok(!/ask your customer/i.test(html),
    'correction is credit-only; this copy predates that decision');
  assert.match(html, /Address bounced/);
  assert.match(html, /ca-app-state-bounced/);
});

// ── 2. Stalled overlays waiting, never its own status ────────────────────────

test('a stalled reference reads differently from one that is merely waiting', () => {
  const w = boot();
  const waiting = w.caAppRowHtml(party({ waiting_days: 2, stalled: false }));
  const stalled = w.caAppRowHtml(party({ waiting_days: 6, stalled: true }));
  assert.notStrictEqual(
    waiting.replace(/\d+/g, ''), stalled.replace(/\d+/g, ''),
    'a stalled row must not be the waiting row with a bigger number in it');
});

test('caAppPartyState is untouched by stall -- it is an overlay, not a status', () => {
  const w = boot();
  // Same label/class caAppPartyState has always returned for 'sent': stall is
  // carried on the party object (p.stalled), never fed into this switch.
  const st = w.caAppPartyState('sent');
  assert.equal(st.label, 'Waiting');
  assert.equal(st.cls, 'waiting');
});

test('a stalled row still offers a Nudge -- the party is still just "sent"', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ status: 'sent', stalled: true, waiting_days: 6 }));
  assert.match(h, /class="row-action ca-app-nudge" data-slot="trade1">Nudge</);
});

test('opened never reads as stalled, even with a large waiting_days -- is_stalled requires never-opened', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ status: 'opened', stalled: false, waiting_days: 9 }));
  assert.doesNotMatch(h, /never opened/);
});

// ── 2b. fix round 1: the nudge-all label/threshold must count what it can actually deliver ──
//
// Round-0 fixed the "waiting" LIST (CA_APP_ANSWERED) so a bounced party is no
// longer misread as answered -- correct, and still true for anywhere the
// question is "has this party answered" (each row's own state text, and the
// staff-controls gate in caAppReferenceAnswerHtml). But that same fix, reused
// for the nudge-all button's own label/threshold, created a NEW mismatch: the
// label counted bounced as "waiting" while the click handler (unchanged,
// still gated on CA_APP_NEEDS_NO_NUDGE via each row's own Nudge button) never
// acts on it. "Nudge all waiting (2)" that only ever nudges 1 is the same
// species of bug as the bounced copy fixed in defect 1 -- the screen promising
// an action the product will not perform. Fixed by having the label and the
// >1 visibility threshold both count the nudgeable set (CA_APP_NEEDS_NO_NUDGE
// excluded), the exact set canNudge already uses per row.
//
// A fixture of exactly one bounced + one sent party cannot exercise this
// through the rendered label at all: with only one truly nudgeable party,
// the pre-existing (untouched by either fix) ">1" visibility rule hides the
// button entirely (see 'renderCreditAppSection hides the nudge-all control
// with 0 or 1 waiting party' in the tracker suite) and its text is never
// even set. Two nudgeable parties plus one bounced is the smallest fixture
// where the label is actually rendered, so that is what proves the fix.

test('nudge-all counts what it will actually nudge, not every unanswered party -- a bounced party does not inflate the label', async () => {
  const w = boot();
  trackerFixture(w);
  w.brokerEmail = 'broker@customer.com';
  w.renderCreditAppSection({ ID: '9' }, {
    status: 'references_pending',
    parties: [
      party({ slot: 'trade1', status: 'bounced' }),
      party({ slot: 'trade2', status: 'sent' }),
      party({ slot: 'bank', status: 'sent' }),
    ],
  });
  const d = w.document;
  // Fails against the pre-fix code, which counted the bounced party too and
  // showed "Nudge all waiting (3)".
  assert.notEqual(d.getElementById('ca-app-nudgeall-row').style.display, 'none');
  assert.match(d.getElementById('ca-app-nudge-all').textContent, /Nudge all waiting \(2\)/);
  assert.doesNotMatch(d.getElementById('ca-app-nudge-all').textContent, /\(3\)/);

  w.setTimeout = () => 0;   // inert: a 200 nudge schedules a real 48h cooldown timer
  w.clearTimeout = () => {};
  var nudgedSlots = [];
  w.fetch = (u, opts) => {
    nudgedSlots.push(JSON.parse(opts.body).slot);
    return Promise.resolve({ status: 200, text: () => Promise.resolve('{"ok":true}') });
  };
  d.getElementById('ca-app-nudge-all').click();
  await new Promise(r => setTimeout(r, 10));
  // Exactly the two the label promised -- never the bounced slot, and never
  // fewer than the label said either.
  assert.deepEqual(nudgedSlots.sort(), ['bank', 'trade2'],
    'the label said 2 and the button must deliver exactly 2, matching what it counted');
});

test('with only one nudgeable party (the other bounced), nudge-all stays hidden rather than show a count it cannot back up', () => {
  const w = boot();
  trackerFixture(w);
  w.renderCreditAppSection({ ID: '9' }, {
    status: 'references_pending',
    parties: [
      party({ slot: 'trade1', status: 'bounced' }),
      party({ slot: 'bank', status: 'sent' }),
    ],
  });
  const d = w.document;
  assert.equal(d.getElementById('ca-app-nudgeall-row').style.display, 'none');
});

// ── 3a. staff-only: Correct address / Waive absent from the DOM for a broker ──

test('correct address and waive are absent from the DOM for a non-staff viewer', async () => {
  const w = boot();
  staffFixture(w);
  w.brokerEmail = 'broker@customer.com';
  w.allClients = false;
  let called = false;
  w.fetch = () => { called = true; return Promise.resolve({ ok: true, json: () => Promise.resolve(staffPayload()) }); };
  w.fetchCreditAppRisk({ ID: '9' });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(called, false, 'the allClients gate must run before any fetch');
  assert.strictEqual(w.document.querySelector('.ca-app-correct-address'), null);
  assert.strictEqual(w.document.querySelector('.ca-app-waive'), null);
});

test('correct address and waive are absent from the DOM when the whole staff section is absent (the real broker shape)', () => {
  const w = boot();
  // No #ca-app-staff-section at all -- exactly what the panel looks like for a
  // broker (caAppStaffSectionHtml is the empty string for them).
  w.document.body.innerHTML = '<div class="panel-section" id="ca-app-detail-section"></div>';
  assert.strictEqual(w.document.querySelector('.ca-app-correct-address'), null);
  assert.strictEqual(w.document.querySelector('.ca-app-waive'), null);
});

// ── 3b. staff do get correct address and waive ───────────────────────────────

test('staff do get correct address and waive, for a party that has not yet given a final answer', async () => {
  const w = boot();
  staffFixture(w);
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(staffPayload()) });
  w.fetchCreditAppRisk({ ID: '9' });
  await new Promise(r => setTimeout(r, 30));
  assert.ok(w.document.querySelector('.ca-app-correct-address'));
  assert.ok(w.document.querySelector('.ca-app-waive'));
});

test('a party with a final answer (completed/waived) gets neither control -- the server would 409 anyway', async () => {
  const w = boot();
  staffFixture(w);
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(staffPayload({
    parties: [{ slot: 'trade1', name: 'Steve Alvarez', company: 'ABC Produce', status: 'completed',
                waiting_days: 0, stalled: false, risk: null, address_risk: null, response: null }],
  })) });
  w.fetchCreditAppRisk({ ID: '9' });
  await new Promise(r => setTimeout(r, 30));
  assert.strictEqual(w.document.querySelector('.ca-app-correct-address'), null);
  assert.strictEqual(w.document.querySelector('.ca-app-waive'), null);
});

// ── address_risk: the redirect-to-accomplice signal now has a reader ────────

test('a corrected address\'s own risk score renders in the staff Full Submission block', async () => {
  const w = boot();
  staffFixture(w);
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(staffPayload({
    parties: [{
      slot: 'bank', name: 'Jordan Banks', company: 'First National Bank', status: 'sent',
      waiting_days: 1, stalled: false, risk: null, response: null,
      address_risk: { level: 'high', checked_at: '2026-09-25T00:00:00Z',
                      signals: [{ code: 'free_mail', detail: 'gmail.com is a free-mail domain' }] },
    }],
  })) });
  w.fetchCreditAppRisk({ ID: '9' });
  await new Promise(r => setTimeout(r, 30));
  const body = w.document.getElementById('ca-app-staff-body').innerHTML;
  assert.match(body, /Corrected address risk/i);
  assert.match(body, /high/i);
  assert.match(body, /free_mail/);
  assert.match(body, /gmail\.com is a free-mail domain/);
});

test('a party with no address_risk renders no corrected-address block at all', async () => {
  const w = boot();
  staffFixture(w);
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(staffPayload()) });
  w.fetchCreditAppRisk({ ID: '9' });
  await new Promise(r => setTimeout(r, 30));
  const body = w.document.getElementById('ca-app-staff-body').innerHTML;
  assert.doesNotMatch(body, /Corrected address risk/i);
});

// ── 3c. report a problem: any viewer, matching Nudge, never on the customer slot ──

test('report a problem is available on a reference row for any viewer, matching Nudge', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ slot: 'bank', status: 'sent' }));
  assert.match(h, /class="row-action ca-app-report-problem" data-slot="bank">Report a problem</);
});

test('report a problem never appears on the customer\'s own application row -- the server refuses that slot', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ slot: 'customer', status: 'sent' }));
  assert.doesNotMatch(h, /ca-app-report-problem/);
});

test('report a problem takes a note, never an address field', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ slot: 'bank', status: 'sent' }));
  assert.doesNotMatch(h, /type="email"/);
  assert.match(h, /ca-app-report-note/);
});

test('clicking Report a problem reveals the note form and hides the button', () => {
  const w = boot();
  trackerFixture(w);
  w.renderCreditAppSection({ ID: '9' }, { status: 'sent', parties: [party({ slot: 'bank', status: 'sent' })] });
  const d = w.document;
  const btn = d.querySelector('.ca-app-report-problem');
  btn.click();
  assert.equal(btn.style.display, 'none');
  assert.notEqual(d.querySelector('.ca-app-report-form').style.display, 'none');
});

test('sending an empty note is refused client-side, no request made', () => {
  const w = boot();
  trackerFixture(w);
  w.renderCreditAppSection({ ID: '9' }, { status: 'sent', parties: [party({ slot: 'bank', status: 'sent' })] });
  const d = w.document;
  let called = false;
  w.fetch = () => { called = true; return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') }); };
  d.querySelector('.ca-app-report-problem').click();
  d.querySelector('.ca-app-report-send').click();
  assert.equal(called, false, 'an empty note must never reach the server');
});

test('a successful report posts the note (never new_email) and confirms in the row', async () => {
  const w = boot();
  trackerFixture(w);
  w.brokerEmail = 'broker@customer.com';
  w.renderCreditAppSection({ ID: '9' }, { status: 'sent', parties: [party({ slot: 'bank', status: 'sent' })] });
  const d = w.document;
  let calledUrl = null, calledBody = null;
  w.fetch = (u, opts) => {
    calledUrl = u; calledBody = JSON.parse(opts.body);
    return Promise.resolve({ status: 200, text: () => Promise.resolve('{"ok":true,"slot":"bank"}') });
  };
  d.querySelector('.ca-app-report-problem').click();
  d.querySelector('.ca-app-report-note').value = 'This bank officer says they never worked here.';
  d.querySelector('.ca-app-report-send').click();
  await new Promise(r => setTimeout(r, 10));
  assert.match(calledUrl, /\/credit-app\/report-problem/);
  assert.equal(calledBody.slot, 'bank');
  assert.equal(calledBody.note, 'This bank officer says they never worked here.');
  assert.equal('new_email' in calledBody, false);
  assert.match(d.querySelector('.ca-app-row[data-slot="bank"] .ca-app-msg').textContent, /Sent to credit/);
});

test('a duplicate report (409) shows the server\'s own message, not a generic one', async () => {
  const w = boot();
  trackerFixture(w);
  w.renderCreditAppSection({ ID: '9' }, { status: 'sent', parties: [party({ slot: 'bank', status: 'sent' })] });
  const d = w.document;
  w.fetch = () => Promise.resolve({
    status: 409, text: () => Promise.resolve('{"error":"already reported, credit is looking at it"}'),
  });
  d.querySelector('.ca-app-report-problem').click();
  d.querySelector('.ca-app-report-note').value = 'Still off.';
  d.querySelector('.ca-app-report-send').click();
  await new Promise(r => setTimeout(r, 10));
  assert.match(d.querySelector('.ca-app-row[data-slot="bank"] .ca-app-msg').textContent,
    /already reported, credit is looking at it/);
});

// ── staff recovery actions actually post and refresh the pane ───────────────

// caAppRefreshPane re-fetches every read the panel shows (status, application,
// risk); each of those bails out quietly the moment its own section isn't in
// the DOM (see fetchCreditAppStatus/fetchCreditAppApplication/
// fetchCreditAppRisk's own "section not found" guards), so the fixture needs
// all three skeletons present, same as a real panel, for the refresh to
// actually reach fetch().
function recoveryFixture(w) {
  w.document.body.innerHTML =
    '<div id="panel" data-submission-id="9">' +
      '<div class="ca-app-recovery" data-slot="bank">' +
        '<div class="ca-app-recovery-row">' +
          '<input type="email" class="ca-app-recovery-input ca-app-address-input">' +
          '<button type="button" class="row-action ca-app-correct-address" data-slot="bank">Correct address</button>' +
        '</div>' +
        '<div class="ca-app-recovery-row">' +
          '<input type="text" class="ca-app-recovery-input ca-app-waive-reason">' +
          '<button type="button" class="row-action ca-app-waive" data-slot="bank">Waive</button>' +
        '</div>' +
        '<div class="ca-app-msg" data-recovery-msg="bank"></div>' +
      '</div>' +
      '<div class="panel-section" id="ca-app-section" style="display:none;">' +
        '<div id="ca-app-summary-text"></div><div id="ca-app-rows"></div>' +
        '<div id="ca-app-nudgeall-row" style="display:none;"><button id="ca-app-nudge-all"></button></div>' +
      '</div>' +
      '<div class="panel-section" id="ca-app-detail-section" style="display:none;">' +
        '<div id="ca-app-detail-body"></div>' +
      '</div>' +
      '<div class="panel-section" id="ca-app-staff-section" style="display:none;">' +
        '<div id="ca-app-staff-body"></div>' +
      '</div>' +
    '</div>';
  return w.document.getElementById('panel');
}

test('correct address posts new_email and refreshes the whole pane on success', async () => {
  const w = boot();
  const panel = recoveryFixture(w);
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  var calls = [];
  w.fetch = (u, opts) => {
    calls.push(u);
    if (/\/credit-app\/correct-address/.test(u)) {
      var body = JSON.parse(opts.body);
      assert.equal(body.slot, 'bank');
      assert.equal(body.new_email, 'jordan@fnb.com');
      assert.equal(body.submission_id, '9');
      return Promise.resolve({ status: 200, text: () => Promise.resolve('{"ok":true,"slot":"bank"}') });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
  w.wireCreditAppRecovery(panel);
  panel.querySelector('.ca-app-address-input').value = 'jordan@fnb.com';
  panel.querySelector('.ca-app-correct-address').click();
  await new Promise(r => setTimeout(r, 10));
  assert.match(panel.querySelector('.ca-app-msg').textContent, /corrected/i);
  assert.ok(calls.some(u => /\/credit-app\/status\?/.test(u)), 'refresh should re-fetch status');
  assert.ok(calls.some(u => /\/credit-app\/application\?/.test(u)), 'refresh should re-fetch application details');
  assert.ok(calls.some(u => /\/credit-app\/risk\?/.test(u)), 'refresh should re-fetch the staff risk view');
});

test('correct address refuses client-side with no @ in the input -- no request made', () => {
  const w = boot();
  const panel = recoveryFixture(w);
  let called = false;
  w.fetch = () => { called = true; return Promise.resolve({ status: 200, text: () => Promise.resolve('{}') }); };
  w.wireCreditAppRecovery(panel);
  panel.querySelector('.ca-app-address-input').value = 'not-an-email';
  panel.querySelector('.ca-app-correct-address').click();
  assert.equal(called, false);
  assert.match(panel.querySelector('.ca-app-msg').textContent, /valid email/i);
});

test('waive posts a reason and refreshes the pane on success', async () => {
  const w = boot();
  const panel = recoveryFixture(w);
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  var calls = [];
  w.fetch = (u, opts) => {
    calls.push(u);
    if (/\/credit-app\/waive/.test(u)) {
      var body = JSON.parse(opts.body);
      assert.equal(body.slot, 'bank');
      assert.equal(body.reason, 'Bank confirmed by phone, will not use the portal.');
      return Promise.resolve({ status: 200, text: () => Promise.resolve('{"ok":true,"slot":"bank","status":"ready_for_review"}') });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
  w.wireCreditAppRecovery(panel);
  panel.querySelector('.ca-app-waive-reason').value = 'Bank confirmed by phone, will not use the portal.';
  panel.querySelector('.ca-app-waive').click();
  await new Promise(r => setTimeout(r, 10));
  assert.match(panel.querySelector('.ca-app-msg').textContent, /Waived/);
  assert.ok(calls.some(u => /\/credit-app\/risk\?/.test(u)), 'refresh should re-fetch the staff risk view');
});

test('waive refuses client-side with a blank reason -- no request made', () => {
  const w = boot();
  const panel = recoveryFixture(w);
  let called = false;
  w.fetch = () => { called = true; return Promise.resolve({ status: 200, text: () => Promise.resolve('{}') }); };
  w.wireCreditAppRecovery(panel);
  panel.querySelector('.ca-app-waive-reason').value = '   ';
  panel.querySelector('.ca-app-waive').click();
  assert.equal(called, false);
  assert.match(panel.querySelector('.ca-app-msg').textContent, /reason is required/i);
});

test('a 403 from correct-address (defense in depth) shows the server message, never a generic error', async () => {
  const w = boot();
  const panel = recoveryFixture(w);
  w.fetch = () => Promise.resolve({ status: 403, text: () => Promise.resolve('{"error":"Forbidden"}') });
  w.wireCreditAppRecovery(panel);
  panel.querySelector('.ca-app-address-input').value = 'jordan@fnb.com';
  panel.querySelector('.ca-app-correct-address').click();
  await new Promise(r => setTimeout(r, 10));
  assert.match(panel.querySelector('.ca-app-msg').textContent, /Forbidden/);
});

// ── the one required assertion: no "[object Object]" anywhere in this UI ────

test('no rendered text in the recovery UI contains "[object Object]"', async () => {
  const w = boot();
  staffFixture(w);
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(staffPayload({
    parties: [{
      slot: 'bank', name: 'Jordan Banks', company: 'First National Bank', status: 'sent',
      waiting_days: 6, stalled: true, risk: null, response: null,
      address_risk: { level: 'high', checked_at: '2026-09-25T00:00:00Z',
                      signals: [{ code: 'free_mail', detail: 'gmail.com is a free-mail domain' }] },
    }],
  })) });
  w.fetchCreditAppRisk({ ID: '9' });
  await new Promise(r => setTimeout(r, 30));
  assert.doesNotMatch(w.document.body.innerHTML, /\[object Object\]/);

  // And the tracker rows, across every status including the new stall overlay.
  ['sent', 'opened', 'completed', 'bounced', 'expired', 'waived'].forEach((status) => {
    const rowHtml = w.caAppRowHtml(party({ status, stalled: status === 'sent' }));
    assert.doesNotMatch(rowHtml, /\[object Object\]/);
  });
});

// ── 4. Final review, Fix 1: WHY the send failed ─────────────────────────────
//
// ms_graph returns (False, "Could not obtain a Graph token.") WITHOUT raising,
// and this branch turns that into status 'bounced' on every party. So an
// expired app secret marks all four references of every application submitted
// overnight as bounced, and on screen that reads identically to four typed
// addresses. The detail was recorded on the party (send_error) and nothing
// rendered it -- the same recorded-and-nothing-reads-it pattern this project
// exists to end. Staff-only: it can carry internal error text, and broker
// payloads carry neutral workflow facts only.

test('the staff block says WHY a send failed, not just that the party bounced', () => {
  const w = boot();
  const h = w.caAppReferenceAnswerHtml({
    slot: 'bank', name: 'Jordan Banks', company: 'First National Bank',
    status: 'bounced', waiting_days: 4, stalled: false,
    risk: null, address_risk: null, response: null,
    send_error: { detail: 'Could not obtain a Graph token.', at: '2026-09-25T14:30:00+00:00' },
  });
  assert.match(h, /Send failed/);
  assert.match(h, /Could not obtain a Graph token\./,
    'a platform outage must be distinguishable from a typed address');
  assert.match(h, /2026-09-25 14:30 UTC/);
});

test('a party that never failed a send renders no send-failure block', () => {
  const w = boot();
  const h = w.caAppReferenceAnswerHtml({
    slot: 'bank', name: 'Jordan Banks', company: 'First National Bank',
    status: 'sent', waiting_days: 2, stalled: false,
    risk: null, address_risk: null, response: null, send_error: null,
  });
  assert.doesNotMatch(h, /Send failed/);
});

test('the send-failure detail is escaped, never injected', () => {
  const w = boot();
  const h = w.caAppReferenceAnswerHtml({
    slot: 'bank', name: 'J', company: 'B', status: 'bounced',
    waiting_days: 1, stalled: false, risk: null, address_risk: null, response: null,
    send_error: { detail: '<img src=x onerror=alert(1)>', at: '2026-09-25T14:30:00+00:00' },
  });
  assert.doesNotMatch(h, /<img src=x/);
  assert.match(h, /&lt;img src=x/);
});
