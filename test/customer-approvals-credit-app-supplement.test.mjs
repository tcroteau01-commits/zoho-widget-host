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

test('an open request shows its count and WHEN it was asked, on the broker tracker, with no identity', () => {
  // /credit-app/status (the broker-visible payload) never carries
  // requested_by/requested_by_role -- _supplement_request_entry's own
  // include_identity=False split -- so this entry has neither key, matching
  // the real wire shape rather than a broker-friendly stand-in.
  //
  // Fix round 1 -- the spec says both audiences see "that it was made, when,
  // and how many were asked for"; the date (req.at) was missing entirely
  // from the first pass. Changed from the original version of this test,
  // which asserted count and reason only -- the date assertion below fails
  // against the pre-fix-round-1 file (verified by hand).
  const w = boot();
  trackerFixture(w);
  w.renderCreditAppSection({ ID: '9' }, {
    status: 'references_pending', parties: SIX,
    supplement_requests: [{ id: 'r1', count: 2, reason: 'trade1 and trade3 went quiet',
                            status: 'sent', at: '2026-09-25T14:30:00', completed_at: null,
                            slots_created: [] }],
  });
  const supplementEl = w.document.getElementById('ca-app-supplement');
  assert.match(supplementEl.innerHTML, /Asked for 2 more references/);
  assert.match(supplementEl.innerHTML, /2026-09-25 14:30 UTC/, 'the request date must render, per the spec');
  assert.match(supplementEl.innerHTML, /trade1 and trade3 went quiet/);
  assert.doesNotMatch(supplementEl.innerHTML, /Asked by/,
    'the broker tracker payload has no requested_by -- nothing to show, and nothing invented');
});

test('a singular count reads "reference", not "references"', () => {
  // Fix round 1 -- the old assertions anchored a period directly after
  // "reference", which the new date text now sits between ("... reference
  // on 2026-... UTC."). Switched to a word boundary so this still proves
  // singular-vs-plural without depending on what comes right after the noun.
  const w = boot();
  trackerFixture(w);
  w.renderCreditAppSection({ ID: '9' }, {
    status: 'references_pending', parties: SIX,
    supplement_requests: [{ id: 'r1', count: 1, reason: '', status: 'sent',
                            at: '2026-09-25T00:00:00', completed_at: null, slots_created: [] }],
  });
  const supplementEl = w.document.getElementById('ca-app-supplement');
  assert.match(supplementEl.innerHTML, /Asked for 1 more reference\b/);
  assert.doesNotMatch(supplementEl.innerHTML, /1 more references\b/);
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

test('the staff Full Submission block shows who asked, their role, and when', async () => {
  // /credit-app/risk (staff-only) carries requested_by/requested_by_role --
  // this is the ONE place identity may render, per the spec's legal line.
  // Fix round 1 -- added the date assertion (see the broker-side test above
  // for why); changed from the original version, which checked count and
  // identity only.
  const w = boot();
  staffFixture(w);
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  const payload = {
    status: 'references_pending', parties: [], customer_verification: null,
    application: { company: { name: 'ACME Produce LLC' } },
    pdf: { exists: false, retrieval_path: '' },
    supplement_requests: [{ id: 'r1', count: 2, reason: 'trade1 and trade3 went quiet',
                            status: 'sent', at: '2026-09-25T14:30:00', completed_at: null,
                            slots_created: [], requested_by: 'ops@operfi.com',
                            requested_by_role: 'operfi' }],
  };
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
  w.fetchCreditAppRisk({ ID: '9' });
  await new Promise((r) => setTimeout(r, 30));
  const body = w.document.getElementById('ca-app-staff-body').innerHTML;
  assert.match(body, /Supplemental Reference Requests/);
  assert.match(body, /Asked for 2 more references/);
  assert.match(body, /2026-09-25 14:30 UTC/, 'the request date must render for staff too');
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
  assert.match(body, /Asked for 1 more reference\b/);
  assert.doesNotMatch(body, /Asked by/);
});

// ── fix round 1: a structural guard, not payload presence ───────────────────

test('caAppSupplementRequestHtml cannot render identity with showIdentity=false, even when the entry carries requested_by', () => {
  // The defense-in-depth ask: today the broker payload never has
  // requested_by, so payload presence alone happened to be safe. This test
  // calls the renderer directly with an entry that DOES carry requested_by
  // (standing in for a hypothetical future /credit-app/status change) and
  // showIdentity=false (what caAppSupplementSectionHtml -- the broker path --
  // always passes), and proves identity still does not render. Fails against
  // the pre-fix-round-1 file, whose caAppSupplementRequestHtml took only one
  // argument and rendered identity whenever req.requested_by was present,
  // full stop (verified by hand).
  const w = boot();
  const h = w.caAppSupplementRequestHtml({
    id: 'r1', count: 2, reason: '', status: 'sent', at: '2026-09-25T14:30:00',
    completed_at: null, slots_created: [],
    requested_by: 'ops@operfi.com', requested_by_role: 'operfi',
  }, false);
  assert.doesNotMatch(h, /Asked by/,
    'showIdentity=false must suppress identity structurally, not by hoping the payload omits it');
  assert.match(h, /Asked for 2 more references/, 'the neutral fact must still render');
});

// Note: this passes against the pre-fix-round-1 file too (its single-argument
// renderer ignored the extra `true` and showed identity whenever
// req.requested_by was present, which it is here) -- a regression guard for
// the positive case, not a failing-first test by itself. The negative test
// above is what proves showIdentity is now load-bearing.
test('caAppSupplementRequestHtml renders identity with showIdentity=true and the field present', () => {
  const w = boot();
  const h = w.caAppSupplementRequestHtml({
    id: 'r1', count: 1, reason: '', status: 'sent', at: '2026-09-25T14:30:00',
    completed_at: null, slots_created: [],
    requested_by: 'ops@operfi.com', requested_by_role: 'operfi',
  }, true);
  assert.match(h, /Asked by ops@operfi\.com \(operfi\)/);
});

// ── fix round 1: send_error -- recorded, and now actually read ──────────────

test('the staff block shows WHY a supplement request failed to send, not just that one is open', async () => {
  // Task 5 (credit_app_store.record_supplement_send_failure) puts send_error
  // on a supplement_requests entry; nothing rendered it until this fix --
  // the exact recorded-and-nothing-reads-it shape CREDITAPP2 exists to close.
  // Fails against the pre-fix-round-1 file, whose caAppSupplementRequestHtml
  // never looked at req.send_error at all (verified by hand).
  const w = boot();
  staffFixture(w);
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  const payload = {
    status: 'references_pending', parties: [], customer_verification: null,
    application: { company: { name: 'ACME Produce LLC' } },
    pdf: { exists: false, retrieval_path: '' },
    supplement_requests: [{ id: 'r1', count: 2, reason: '', status: 'sent',
                            at: '2026-09-25T00:00:00', completed_at: null, slots_created: [],
                            requested_by: 'ops@operfi.com', requested_by_role: 'operfi',
                            send_error: { detail: 'Could not obtain a Graph token.',
                                          at: '2026-09-25T14:30:00+00:00' } }],
  };
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
  w.fetchCreditAppRisk({ ID: '9' });
  await new Promise((r) => setTimeout(r, 30));
  const body = w.document.getElementById('ca-app-staff-body').innerHTML;
  assert.match(body, /Send failed/);
  assert.match(body, /Could not obtain a Graph token\./,
    'a platform outage must be distinguishable from a typed address, same as a party\'s own send_error');
  assert.match(body, /2026-09-25 14:30 UTC/);
});

// Note: this also passes against the pre-fix-round-1 file (it never read
// send_error at all, so a request with none was never going to render a
// line for it either) -- a regression guard for the negative half of the
// claim, not failing-first. The positive test above is the one that matters.
test('a supplement request that never failed a send renders no Send-failed line', async () => {
  const w = boot();
  staffFixture(w);
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  const payload = {
    status: 'references_pending', parties: [], customer_verification: null,
    application: { company: { name: 'ACME Produce LLC' } },
    pdf: { exists: false, retrieval_path: '' },
    supplement_requests: [{ id: 'r1', count: 1, reason: '', status: 'sent',
                            at: '2026-09-25T00:00:00', completed_at: null, slots_created: [],
                            requested_by: 'ops@operfi.com', requested_by_role: 'operfi',
                            send_error: null }],
  };
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
  w.fetchCreditAppRisk({ ID: '9' });
  await new Promise((r) => setTimeout(r, 30));
  const body = w.document.getElementById('ca-app-staff-body').innerHTML;
  assert.doesNotMatch(body, /Send failed/);
});

test('the broker tracker never renders a Send-failed line for a supplement request, structurally', () => {
  // Same structural point as the identity test above: called directly with
  // showIdentity=false and an entry that DOES carry send_error, proving the
  // suppression is the showIdentity argument, not the broker payload merely
  // lacking the field. This negative also holds against the pre-fix-round-1
  // file (which never read send_error at all), so it is a regression guard
  // for the "never" half of the claim, not a failing-first test by itself --
  // the positive case above is what proves the feature exists.
  const w = boot();
  const h = w.caAppSupplementRequestHtml({
    id: 'r1', count: 1, reason: '', status: 'sent', at: '2026-09-25T00:00:00',
    completed_at: null, slots_created: [],
    send_error: { detail: 'Could not obtain a Graph token.', at: '2026-09-25T14:30:00+00:00' },
  }, false);
  assert.doesNotMatch(h, /Send failed/);
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

// ── fix round 2: "Sent to the customer" must be true when it is said ────────

function wiredPanel(w) {
  const panel = panelFixture(w);
  w.renderCreditAppSection({ ID: '9' }, { status: 'ready_for_review', parties: SIX, supplement_requests: [] });
  w.wireCreditAppSupplement(panel);
  return panel;
}

function respondWith(w, body) {
  w.fetch = (u) => {
    if (/\/credit-app\/request-references/.test(u)) {
      return Promise.resolve({ status: 200, text: () => Promise.resolve(body) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
}

test('a send the server could not deliver says so, instead of "Sent to the customer"', async () => {
  // The route swallows a mint or Graph failure, records send_error and still
  // answers 200 -- and send_error is gated behind include_identity, so it
  // reaches staff ONLY. The broker was told, affirmatively and falsely, that
  // their customer had been mailed. Fails against the pre-fix file, which
  // printed "Sent to the customer." for any 200 (verified by hand).
  const w = boot();
  const panel = wiredPanel(w);
  respondWith(w, '{"ok":true,"delivered":false,"request_id":"r1"}');
  panel.querySelector('#ca-app-supplement-ask').click();
  panel.querySelector('#ca-app-supplement-send').click();
  await new Promise((r) => setTimeout(r, 10));
  const msg = panel.querySelector('#ca-app-supplement-msg');
  assert.doesNotMatch(msg.textContent, /Sent to the customer/,
    'the one thing it must never say when nothing was sent');
  assert.match(msg.textContent, /did not go out/);
  // The copy has to name an action the broker can take. It previously read
  // "OperFi has been notified," which nothing keeps -- no alert fires on
  // send_error -- so it stopped the broker chasing on a promise that was not
  // true. Asserted here so the sentence cannot quietly regress to a
  // reassurance.
  assert.match(msg.textContent, /Ask credit to resend it\./);
  assert.doesNotMatch(msg.textContent, /notified/,
    'no claim that anyone has been told, because nothing tells them');
  assert.equal(msg.className, 'ca-app-msg error', 'not styled as a success');
});

// Note: passes against the pre-fix file too (it never read send_error on this
// response either, so there was nothing there to print) -- a regression guard
// for the "never" half of the claim, not failing-first. The test above is the
// one that proves the feature exists.
test('the not-delivered message carries no internal diagnostics', async () => {
  // A broker surface gets the boolean and nothing else. Even if the server
  // ever leaked send_error onto this response, the widget must not print it.
  const w = boot();
  const panel = wiredPanel(w);
  respondWith(w,
    '{"ok":true,"delivered":false,"send_error":{"detail":"Could not obtain a Graph token."}}');
  panel.querySelector('#ca-app-supplement-ask').click();
  panel.querySelector('#ca-app-supplement-send').click();
  await new Promise((r) => setTimeout(r, 10));
  const text = panel.querySelector('#ca-app-supplement-msg').textContent;
  assert.doesNotMatch(text, /Graph/);
  assert.doesNotMatch(text, /token/);
});

// Note: passes pre-fix as well (the old code said this for every 200,
// including this one) -- it is here so the FAILURE test above cannot be
// satisfied by a widget that simply stopped claiming success, which is the
// cheapest wrong fix available.
test('delivered:true still says "Sent to the customer" -- the flag discriminates', async () => {
  const w = boot();
  const panel = wiredPanel(w);
  respondWith(w, '{"ok":true,"delivered":true,"request_id":"r1"}');
  panel.querySelector('#ca-app-supplement-ask').click();
  panel.querySelector('#ca-app-supplement-send').click();
  await new Promise((r) => setTimeout(r, 10));
  const msg = panel.querySelector('#ca-app-supplement-msg');
  assert.match(msg.textContent, /Sent to the customer/);
  assert.equal(msg.className, 'ca-app-msg ok');
});

// Note: passes pre-fix (the old code said "Sent" for any 200) -- it pins this
// behavior as a DECISION rather than leaving it as whatever the boolean check
// happened to do.
test('a 200 with no delivered flag at all reads as sent, not as failed', async () => {
  // Deliberate, not accidental: the two repos deploy independently off main,
  // so a new widget can briefly meet an API that does not send the flag.
  // Claiming "the email did not go out" for a send that did is the same false
  // statement in the other direction. Only the server saying `false`
  // produces the failure copy.
  const w = boot();
  const panel = wiredPanel(w);
  respondWith(w, '{"ok":true}');
  panel.querySelector('#ca-app-supplement-ask').click();
  panel.querySelector('#ca-app-supplement-send').click();
  await new Promise((r) => setTimeout(r, 10));
  assert.match(panel.querySelector('#ca-app-supplement-msg').textContent, /Sent to the customer/);
});

// ── fix round 2: reason reaches a third audience, so the box says so ────────

test('the reason box names who reads it -- customer AND broker', () => {
  // `reason` sits outside _supplement_request_entry's include_identity gate,
  // so it ships on both broker payloads and renders on the broker banner as
  // well as going to the customer verbatim. The spec's "What each audience
  // sees" never listed it. Labeling the box is the fix; the payload is
  // unchanged. Fails against the pre-fix file, whose placeholder was the bare
  // "Reason (optional)" (verified by hand).
  const w = boot();
  const html = w.caAppSupplementSectionHtml({ supplement_requests: [] });
  assert.match(html, /placeholder="Reason \(optional\)\. The customer and the broker both see this\."/);
});

test('the reason textarea is not styled with the banner line\'s muted 11px', () => {
  // .ca-app-supplement-reason (11px #888) was on the textarea as well as the
  // banner, and won over .ca-app-report-note's 12px by being later in the
  // sheet at the same specificity -- a credit officer typed into gray 11px.
  // Fails against the pre-fix file, where the class was present on the
  // textarea (verified by hand).
  const w = boot();
  const html = w.caAppSupplementSectionHtml({ supplement_requests: [] });
  const tag = html.match(/<textarea[^>]*id="ca-app-supplement-reason"[^>]*>/)[0];
  assert.doesNotMatch(tag, /ca-app-supplement-reason-line/);
  assert.doesNotMatch(tag, /class="[^"]*\bca-app-supplement-reason\b/,
    'the banner line\'s class must not style an input');
  assert.match(tag, /class="[^"]*ca-app-report-note/,
    'it keeps the input styling its sibling controls use');
});

test('the banner still renders its reason, on its own class', () => {
  const w = boot();
  const h = w.caAppSupplementRequestHtml({
    id: 'r1', count: 1, reason: 'trade1 went quiet', status: 'sent',
    at: '2026-09-25T14:30:00', completed_at: null, slots_created: [],
  }, false);
  assert.match(h, /ca-app-supplement-reason-line/);
  assert.match(h, /trade1 went quiet/);
});
