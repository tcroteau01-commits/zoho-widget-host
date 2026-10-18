// tests/profile-boost-history.test.js
// BOOSTHIST1 (Tom, 2026-10-13): "I don't see anything in the customer profile that
// makes it clear for our team that we are denying the credit boost but keeping
// their existing credit limit in place." ... "make sure that's clear and it's on both"
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const P = require('../customer-profile.js');

const DECLINED = { requested_at: '2026-10-12T14:15:14', band: 'Over $50,000', amount: 75000,
  state: 'declined', decided_at: '2026-10-13T18:00:00Z', decided_by: 'pat@operfi.com',
  previous_limit: 5000, limit: 5000, reason: 'Too new to us.' };

const BASE = {
  submission_id: '4455', customer_name: 'GW COUNTRY INC', broker: 'TESTING',
  status: 'Approved', contacts: {}, engine: null, identity: null, summary: null,
  fv_debtor: null, fv_candidates: [], priors: [], priors_unavailable: false,
  submitted: { credit_limit: 5000, documents: [] }, can_act: true, boosts: [DECLINED]
};

test('a declined boost says the existing limit was kept, who, and why', () => {
  const html = P.render(BASE);
  assert.ok(html.includes('Credit boost declined'));
  assert.ok(html.includes('Existing limit of <strong>$5,000</strong> kept'));
  assert.ok(html.includes('by pat@operfi.com'));
  assert.ok(html.includes('Too new to us.'));
  assert.ok(html.includes('Requested Oct 12, 2026'));
  assert.ok(html.includes('($75,000 asked)'));
});

test('an approved boost says from and to', () => {
  const html = P.render(Object.assign({}, BASE, { boosts: [Object.assign({}, DECLINED,
    { state: 'approved', limit: 20000, reason: '' })] }));
  assert.ok(html.includes('Credit boost approved'));
  assert.ok(html.includes('Limit raised from $5,000 to <strong>$20,000</strong>'));
});

test('no boosts, no block', () => {
  const html = P.render(Object.assign({}, BASE, { boosts: [] }));
  assert.ok(!html.includes('cp-boosts'));
});

test('a reason is escaped', () => {
  const html = P.render(Object.assign({}, BASE, { boosts: [Object.assign({}, DECLINED,
    { reason: '<img src=x onerror=alert(1)>' })] }));
  assert.ok(!html.includes('<img src=x'));
});

test('the request date is not shifted a day by the viewer zone', () => {
  const t = P.boostSentence({ state: 'no_record', requested_at: '2026-09-01T00:30:00' }, true);
  assert.ok(t.detail.includes('Sep 1, 2026'));
});

test('a broker view leaves out who decided', () => {
  const t = P.boostSentence(Object.assign({}, DECLINED, { decided_by: null }), false);
  assert.ok(!t.detail.includes(' by '));
});

const OPEN = Object.assign({}, BASE, { status: 'Credit Boost Requested',
  boosts: [{ requested_at: '2026-10-12T14:15:14', band: 'Up to $50,000', amount: 50000,
             state: 'open' }] });

test('an open boost offers its own two decisions above the generic ones', () => {
  const html = P.render(OPEN);
  assert.ok(html.includes('data-boost="approve"') && html.includes('data-boost="decline"'));
  assert.ok(html.indexOf('data-boost="decline"') < html.indexOf('data-decide="Denied"'));
  assert.ok(html.includes('awaiting our decision'));
});

test('no boost controls when nothing is open, or for a viewer who cannot act', () => {
  assert.ok(!P.render(BASE).includes('data-boost='));
  assert.ok(!P.render(Object.assign({}, OPEN, { can_act: false })).includes('data-boost='));
});

// --- the host page wires the profile's boost buttons to the boost route -------

const page = fs.readFileSync(__dirname + '/../customer-approvals.html', 'utf8').replace(/\r\n/g, '\n');

function host(resp) {
  const dom = new JSDOM('<div id="ca-profile"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  const sent = [], applied = [], refetched = [];
  w.OperFiCustomerProfile = { render: P.render, injectStyles: function () {} };
  w.BROKER_API_BASE = 'https://api.test';
  w.closeProfile = w.showToast = function () {};
  w.fetchProfile = function (rec) { refetched.push(rec.ID); };
  w.applyDecisionResult = function (rec, vals) { applied.push(vals); };
  w.dropCustomerEventKinds = function () {};
  w.DECISION_CLEARED_KINDS = []; w.BOOST_CLEARED_KINDS = [];
  w.esc = P.esc;
  w.profileAttention = function () { return []; };
  w.parseMoney = function (v) { return Number(String(v || '').replace(/[$,]/g, '')) || 0; };
  w.fmtMoney = P.money;
  w.submitDecision = function () { throw new Error('generic route must not be used'); };
  w.submitBoostDecision = function (rec, outcome, vals) {
    sent.push({ outcome: outcome, vals: vals });
    return Promise.resolve(resp || { ok: true, credit_limit: 5000, emailed: true });
  };
  w.eval(page.match(/var PROFILE_ACTIONS =[\s\S]*?\n}\n/)[0]);
  w.eval(page.match(/function renderProfile\(rec, payload\) \{[\s\S]*?\n}\n/)[0]);
  w.renderProfile({ ID: '4455', Credit_Limit: '5000' }, OPEN);
  return { d: w.document, sent: sent, applied: applied, refetched: refetched };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('decline needs a note and sends nothing without one', () => {
  const h = host();
  h.d.querySelector('[data-boost="decline"]').click();
  assert.strictEqual(h.sent.length, 0);
  assert.ok(h.d.getElementById('cp-boost-msg').textContent.includes('note'));
});

test('decline goes to the boost route and keeps the customer approved', async () => {
  const h = host();
  h.d.getElementById('cp-boost-reason').value = '  Thin file  ';
  h.d.querySelector('[data-boost="decline"]').click();
  await tick(); await tick();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.sent[0])), { outcome: 'decline', vals: { credit_limit: '', reason: 'Thin file' } });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.applied[0])), { decision: 'Approved', credit_limit: '5000' });
  assert.deepStrictEqual(Array.from(h.refetched), ['4455']);
});

test('approve needs a limit above the current one', () => {
  const h = host();
  h.d.getElementById('cp-boost-limit').value = '5000';
  h.d.querySelector('[data-boost="approve"]').click();
  assert.strictEqual(h.sent.length, 0);
});

test('a refused save says why and re-enables the buttons', async () => {
  const h = host({ ok: false, error: 'The boost decision was not saved' });
  h.d.getElementById('cp-boost-reason').value = 'x';
  h.d.querySelector('[data-boost="decline"]').click();
  await tick(); await tick();
  assert.ok(h.d.getElementById('cp-boost-msg').textContent.includes('not saved'));
  assert.ok(!h.d.querySelector('[data-boost="decline"]').disabled);
});

// --- the detail pane shows the same sentence ---------------------------------

test('the detail pane renders the boost history from the shared sentence', () => {
  const dom = new JSDOM('<div id="ca-boost-history"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.OperFiCustomerProfile = { boostSentence: P.boostSentence, boostTone: P.boostTone };
  w.eval(page.match(/function renderBoostHistory\(rows\) \{[\s\S]*?\n}\n/)[0]);
  w.renderBoostHistory([DECLINED]);
  const box = w.document.getElementById('ca-boost-history');
  assert.ok(box.innerHTML.includes('Credit boost declined'));
  assert.ok(box.innerHTML.includes('Existing limit of <strong>$5,000</strong> kept'));
  assert.ok(box.querySelector('.ca-boost-no'));
});

test('the pane has the slot inside the Credit Decision section, filled with the files', () => {
  assert.ok(page.includes('\'<div id="ca-boost-history"></div>\' +'));
  assert.ok(page.includes('renderBoostHistory((payload && payload.history) || []);'));
});
