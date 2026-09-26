// CREDITAPP3 Task 7 -- the widget stops filtering unknown slots, and picks up
// the customer-facing half of supplemental references: ordering/labels by
// rule instead of a five-entry table/list, the "ask customer for more
// references" control (broker AND staff), the open-request state on the
// tracker (identity visible to staff only), and the divergence note that a
// supplemental reference is not on the signed PDF.
//
// Same harness the sibling suites already use throughout this file (JSDOM
// booting the real customer-approvals.html, no separate mock layer) -- see
// customer-approvals-credit-app-tracker.test.mjs and
// customer-approvals-credit-app-recovery.test.mjs, both read before writing
// this file. Reuses their exact fixture shapes rather than building a second
// harness.
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

// customer + trade1-3 + bank, all answered except trade3, matching the shape
// _status_payload actually sends (slot/name/company/status/waiting_days/stalled).
const SIX = [
  party({ slot: 'customer', status: 'completed' }), party({ slot: 'trade1', status: 'completed' }),
  party({ slot: 'trade2', status: 'completed' }),   party({ slot: 'trade3', status: 'sent' }),
  party({ slot: 'bank', status: 'sent' }),           party({ slot: 'trade4', status: 'sent' }),
];

function trackerFixture(w) {
  w.document.body.innerHTML =
    '<div class="panel-section" id="ca-app-section" style="display:none;">' +
      '<div id="ca-app-summary-text"></div>' +
      '<div id="ca-app-rows"></div>' +
      '<div id="ca-app-nudgeall-row" style="display:none;"><button id="ca-app-nudge-all"></button></div>' +
      '<div id="ca-app-supplement"></div>' +
    '</div>';
}

function staffFixture(w) {
  w.document.body.innerHTML =
    '<div class="panel-section" id="ca-app-staff-section" style="display:none;">' +
      '<div id="ca-app-staff-body"></div>' +
    '</div>';
}

// Full panel, for the delegated wiring tests -- caAppRefreshPane re-fetches
// every read the panel shows (status, application, risk), each of which
// bails out quietly the moment its own section isn't in the DOM, so this
// needs all three skeletons present, the same reason recoveryFixture in
// customer-approvals-credit-app-recovery.test.mjs does.
function panelFixture(w) {
  w.document.body.innerHTML =
    '<div id="panel" data-submission-id="9">' +
      '<div class="panel-section" id="ca-app-section" style="display:none;">' +
        '<div id="ca-app-summary-text"></div>' +
        '<div id="ca-app-rows"></div>' +
        '<div id="ca-app-nudgeall-row" style="display:none;"><button id="ca-app-nudge-all"></button></div>' +
        '<div id="ca-app-supplement"></div>' +
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

// ── ordering: a rule, never a five-entry list ───────────────────────────────

test('a party whose slot the front end has never heard of still renders, never dropped', () => {
  const w = boot();
  const ordered = w.caAppOrderedParties(SIX.concat([party({ slot: 'trade99', status: 'sent' })]));
  const slots = ordered.map((p) => p.slot);
  assert.ok(slots.indexOf('trade4') !== -1, 'trade4 was dropped');
  assert.ok(slots.indexOf('trade99') !== -1,
    'an unrecognized slot must render, not vanish: the old fixed CA_APP_SLOT_ORDER list filtered it out');
  assert.strictEqual(ordered.length, 7);
});

test('the canonical five keep their display order, and bank precedes the supplementals', () => {
  const w = boot();
  const slots = w.caAppOrderedParties(SIX).map((p) => p.slot);
  assert.deepEqual(slots,
    ['customer', 'trade1', 'trade2', 'trade3', 'bank', 'trade4'],
    'display order is bank then trade4, even though storage (credit_app_store.SLOTS) puts trade4 after bank for a different reason (index stability)');
});

test('ordering does not depend on the payload order the server happened to send', () => {
  const w = boot();
  const shuffled = [SIX[5], SIX[4], SIX[0], SIX[3], SIX[2], SIX[1]];
  const slots = w.caAppOrderedParties(shuffled).map((p) => p.slot);
  assert.deepEqual(slots, ['customer', 'trade1', 'trade2', 'trade3', 'bank', 'trade4']);
});

test('caAppOrderedParties tolerates a missing slot (e.g. no bank reference yet) -- unchanged by this task', () => {
  const w = boot();
  const ordered = w.caAppOrderedParties([party({ slot: 'customer' }), party({ slot: 'trade1' })]);
  assert.deepEqual(ordered.map((p) => p.slot), ['customer', 'trade1']);
});

test('no rendered row contains "[object Object]", across the canonical five plus a supplemental', () => {
  const w = boot();
  SIX.forEach((p) => {
    assert.ok(w.caAppRowHtml(p).indexOf('[object Object]') === -1, p.slot);
  });
});

// ── labels: a rule, never a five-entry table ────────────────────────────────

test('a supplemental slot labels by rule, with no table entry', () => {
  const w = boot();
  assert.strictEqual(w.caAppSlotLabel('trade4'), 'Trade reference 4');
  assert.strictEqual(w.caAppSlotLabel('trade12'), 'Trade reference 12');
});

test('the canonical labels are unchanged by the move to a rule', () => {
  const w = boot();
  assert.strictEqual(w.caAppSlotLabel('customer'), 'Customer application');
  assert.strictEqual(w.caAppSlotLabel('trade1'), 'Trade reference 1');
  assert.strictEqual(w.caAppSlotLabel('trade3'), 'Trade reference 3');
  assert.strictEqual(w.caAppSlotLabel('bank'), 'Bank reference');
});

test('an unrecognized slot labels as itself rather than vanishing', () => {
  const w = boot();
  assert.strictEqual(w.caAppSlotLabel('wat'), 'wat');
});

test('caAppSlotLabel is exported on window, same as caAppOrderedParties', () => {
  const w = boot();
  assert.strictEqual(typeof w.caAppSlotLabel, 'function');
});

// ── Step 4: the signed-PDF divergence, said plainly next to the row it's about ──

test('a supplemental row (trade4+) says it is not on the signed PDF', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ slot: 'trade4', status: 'sent' }));
  assert.match(h, /Added after signing/);
  assert.match(h, /not on the signed PDF/);
});

test('none of the canonical five rows carry the signed-PDF divergence note', () => {
  const w = boot();
  ['customer', 'trade1', 'trade2', 'trade3', 'bank'].forEach((slot) => {
    const h = w.caAppRowHtml(party({ slot, status: 'sent' }));
    assert.doesNotMatch(h, /Added after signing/, slot);
  });
});

// ── Step 3: the request control, available to broker AND staff ─────────────

test('the ask-for-more-references control renders on the tracker for a broker viewer', () => {
  const w = boot();
  trackerFixture(w);
  w.allClients = false;
  w.renderCreditAppSection({ ID: '9' }, { status: 'ready_for_review', parties: SIX, supplement_requests: [] });
  const btn = w.document.getElementById('ca-app-supplement-ask');
  assert.ok(btn, 'the control must be present for a broker');
  assert.match(btn.textContent, /Ask customer for more references/);
});

test('the ask-for-more-references control renders on the same tracker for a staff viewer', () => {
  // renderCreditAppSection is the shared tracker, never gated on allClients --
  // the whole point of this task is that a broker sees supplemental slots
  // too, so the control cannot live only in the staff-only Full Submission
  // block. Exercised here explicitly (not just implied by the test above)
  // because a future edit could accidentally move it behind an allClients
  // check the way the staff recovery controls are gated.
  const w = boot();
  trackerFixture(w);
  w.allClients = true;
  w.renderCreditAppSection({ ID: '9' }, { status: 'ready_for_review', parties: SIX, supplement_requests: [] });
  const btn = w.document.getElementById('ca-app-supplement-ask');
  assert.ok(btn, 'the control must be present for staff too');
});

test('with no open request, the tracker shows the control and no banner', () => {
  const w = boot();
  trackerFixture(w);
  w.renderCreditAppSection({ ID: '9' }, { status: 'ready_for_review', parties: SIX, supplement_requests: [] });
  const supplementEl = w.document.getElementById('ca-app-supplement');
  assert.doesNotMatch(supplementEl.innerHTML, /ca-app-supplement-open/);
});

// ── Step 3: request state -- count visible to everyone, identity staff-only ──

test('an open request shows its count on the broker tracker, with no identity', () => {
  // /credit-app/status (the broker-visible payload) never carries
  // requested_by/requested_by_role -- _supplement_request_entry's own
  // include_identity=False split -- so this entry has neither key, matching
  // the real wire shape rather than a broker-friendly stand-in.
  const w = boot();
  trackerFixture(w);
  w.renderCreditAppSection({ ID: '9' }, {
    status: 'references_pending', parties: SIX,
    supplement_requests: [{ id: 'r1', count: 2, reason: 'trade1 and trade3 went quiet',
                            status: 'sent', at: '2026-09-25T00:00:00', completed_at: null,
                            slots_created: [] }],
  });
  const supplementEl = w.document.getElementById('ca-app-supplement');
  assert.match(supplementEl.innerHTML, /Asked for 2 more references/);
  assert.match(supplementEl.innerHTML, /trade1 and trade3 went quiet/);
  assert.doesNotMatch(supplementEl.innerHTML, /Asked by/,
    'the broker tracker payload has no requested_by -- nothing to show, and nothing invented');
});

test('a singular count reads "reference", not "references"', () => {
  const w = boot();
  trackerFixture(w);
  w.renderCreditAppSection({ ID: '9' }, {
    status: 'references_pending', parties: SIX,
    supplement_requests: [{ id: 'r1', count: 1, reason: '', status: 'sent',
                            at: '2026-09-25T00:00:00', completed_at: null, slots_created: [] }],
  });
  const supplementEl = w.document.getElementById('ca-app-supplement');
  assert.match(supplementEl.innerHTML, /Asked for 1 more reference\./);
  assert.doesNotMatch(supplementEl.innerHTML, /1 more references/);
});

test('a superseded request shows no open banner -- only "sent" is open', () => {
  const w = boot();
  trackerFixture(w);
  w.renderCreditAppSection({ ID: '9' }, {
    status: 'references_pending', parties: SIX,
    supplement_requests: [{ id: 'r1', count: 2, reason: '', status: 'superseded',
                            at: '2026-09-25T00:00:00', completed_at: null, slots_created: [] }],
  });
  const supplementEl = w.document.getElementById('ca-app-supplement');
  assert.doesNotMatch(supplementEl.innerHTML, /Asked for/);
});

test('the staff Full Submission block shows who asked and their role', async () => {
  // /credit-app/risk (staff-only) carries requested_by/requested_by_role --
  // this is the ONE place identity may render, per the spec's legal line.
  const w = boot();
  staffFixture(w);
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  const payload = {
    status: 'references_pending', parties: [], customer_verification: null,
    application: { company: { name: 'ACME Produce LLC' } },
    pdf: { exists: false, retrieval_path: '' },
    supplement_requests: [{ id: 'r1', count: 2, reason: 'trade1 and trade3 went quiet',
                            status: 'sent', at: '2026-09-25T00:00:00', completed_at: null,
                            slots_created: [], requested_by: 'ops@operfi.com',
                            requested_by_role: 'operfi' }],
  };
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
  w.fetchCreditAppRisk({ ID: '9' });
  await new Promise((r) => setTimeout(r, 30));
  const body = w.document.getElementById('ca-app-staff-body').innerHTML;
  assert.match(body, /Supplemental Reference Requests/);
  assert.match(body, /Asked for 2 more references/);
  assert.match(body, /Asked by ops@operfi\.com \(operfi\)/);
});

test('the same renderer shows no identity line when the payload has none (driven by the data, not a role flag)', async () => {
  const w = boot();
  staffFixture(w);
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  const payload = {
    status: 'references_pending', parties: [], customer_verification: null,
    application: { company: { name: 'ACME Produce LLC' } },
    pdf: { exists: false, retrieval_path: '' },
    supplement_requests: [{ id: 'r1', count: 1, reason: '', status: 'sent',
                            at: '2026-09-25T00:00:00', completed_at: null, slots_created: [] }],
  };
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
  w.fetchCreditAppRisk({ ID: '9' });
  await new Promise((r) => setTimeout(r, 30));
  const body = w.document.getElementById('ca-app-staff-body').innerHTML;
  assert.match(body, /Asked for 1 more reference\./);
  assert.doesNotMatch(body, /Asked by/);
});

// ── wiring: show/hide/submit, delegated the way wireCreditAppRecovery is ────

test('clicking Ask reveals the form and hides the button', () => {
  const w = boot();
  const panel = panelFixture(w);
  w.renderCreditAppSection({ ID: '9' }, { status: 'ready_for_review', parties: SIX, supplement_requests: [] });
  w.wireCreditAppSupplement(panel);
  const askBtn = panel.querySelector('#ca-app-supplement-ask');
  askBtn.click();
  assert.equal(askBtn.style.display, 'none');
  assert.notEqual(panel.querySelector('#ca-app-supplement-form').style.display, 'none');
});

test('clicking Cancel hides the form again', () => {
  const w = boot();
  const panel = panelFixture(w);
  w.renderCreditAppSection({ ID: '9' }, { status: 'ready_for_review', parties: SIX, supplement_requests: [] });
  w.wireCreditAppSupplement(panel);
  panel.querySelector('#ca-app-supplement-ask').click();
  panel.querySelector('#ca-app-supplement-cancel').click();
  assert.equal(panel.querySelector('#ca-app-supplement-form').style.display, 'none');
  assert.notEqual(panel.querySelector('#ca-app-supplement-ask').style.display, 'none');
});

test('sending posts count and reason to /credit-app/request-references and refreshes the whole pane', async () => {
  const w = boot();
  const panel = panelFixture(w);
  w.brokerEmail = 'staff@operfi.com';
  // caAppRefreshPane calls all three fetchers unconditionally, the same as
  // it does after a staff recovery action -- fetchCreditAppRisk's own
  // allClients gate (unrelated to this feature, which is broker+staff) is
  // what decides whether the risk call actually goes out, so a staff viewer
  // is what exercises all three refreshes in one assertion.
  w.allClients = true;
  w.renderCreditAppSection({ ID: '9' }, { status: 'ready_for_review', parties: SIX, supplement_requests: [] });
  w.wireCreditAppSupplement(panel);
  var calls = [];
  w.fetch = (u, opts) => {
    calls.push(u);
    if (/\/credit-app\/request-references/.test(u)) {
      var body = JSON.parse(opts.body);
      assert.equal(body.submission_id, '9');
      assert.equal(body.count, 2);
      assert.equal(body.reason, 'trade1 and trade3 went quiet');
      return Promise.resolve({ status: 200, text: () => Promise.resolve('{"ok":true}') });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
  panel.querySelector('#ca-app-supplement-ask').click();
  panel.querySelector('#ca-app-supplement-count').value = '2';
  panel.querySelector('#ca-app-supplement-reason').value = 'trade1 and trade3 went quiet';
  panel.querySelector('#ca-app-supplement-send').click();
  await new Promise((r) => setTimeout(r, 10));
  assert.match(panel.querySelector('#ca-app-supplement-msg').textContent, /Sent to the customer/);
  assert.ok(calls.some((u) => /\/credit-app\/status\?/.test(u)), 'refresh should re-fetch status');
  assert.ok(calls.some((u) => /\/credit-app\/application\?/.test(u)), 'refresh should re-fetch application details');
  assert.ok(calls.some((u) => /\/credit-app\/risk\?/.test(u)), 'refresh should re-fetch the staff risk view');
});

test('a 409 (cap reached) shows the server message verbatim, never a generic one', async () => {
  const w = boot();
  const panel = panelFixture(w);
  w.renderCreditAppSection({ ID: '9' }, { status: 'ready_for_review', parties: SIX, supplement_requests: [] });
  w.wireCreditAppSupplement(panel);
  w.fetch = () => Promise.resolve({
    status: 409, text: () => Promise.resolve('{"error":"Past six references, this is an answer too"}'),
  });
  panel.querySelector('#ca-app-supplement-ask').click();
  panel.querySelector('#ca-app-supplement-send').click();
  await new Promise((r) => setTimeout(r, 10));
  assert.match(panel.querySelector('#ca-app-supplement-msg').textContent,
    /Past six references, this is an answer too/);
});

test('an empty reason is allowed -- the field is optional', async () => {
  const w = boot();
  const panel = panelFixture(w);
  w.renderCreditAppSection({ ID: '9' }, { status: 'ready_for_review', parties: SIX, supplement_requests: [] });
  w.wireCreditAppSupplement(panel);
  var sentBody = null;
  w.fetch = (u, opts) => {
    if (/\/credit-app\/request-references/.test(u)) {
      sentBody = JSON.parse(opts.body);
      return Promise.resolve({ status: 200, text: () => Promise.resolve('{"ok":true}') });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
  panel.querySelector('#ca-app-supplement-ask').click();
  panel.querySelector('#ca-app-supplement-send').click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sentBody.count, 1, 'the select defaults to 1');
  assert.equal(sentBody.reason, '');
});
