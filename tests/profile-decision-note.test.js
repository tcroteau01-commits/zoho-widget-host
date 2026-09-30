// tests/profile-decision-note.test.js
// DECNOTE1 (Tom, 2026-09-30): the profile's decision sends the broker a note,
// the same one the drawer's Notes box sends (Credit_Notes on /credit-decision).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const P = require('../customer-profile.js');

const BASE = {
  submission_id: '4455', customer_name: 'OPERATION FINANCE INC', broker: 'TESTING',
  status: 'Awaiting Credit Decision', contacts: {}, engine: null, identity: null,
  summary: null, fv_debtor: null, fv_candidates: [], priors: [], priors_unavailable: false,
  can_act: true
};

test('the decision controls carry a note to the broker', () => {
  const html = P.render(BASE);
  assert.ok(html.includes('id="cp-decision-notes"'));
  assert.ok(html.includes('Note to the broker'));
});

test('a viewer who cannot act gets no note box', () => {
  const html = P.render(Object.assign({}, BASE, { can_act: false }));
  assert.ok(!html.includes('id="cp-decision-notes"'));
});

const page = fs.readFileSync(__dirname + '/../customer-approvals.html', 'utf8').replace(/\r\n/g, '\n');

function host() {
  const dom = new JSDOM('<div id="ca-profile"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  const sent = [];
  w.OperFiCustomerProfile = { render: P.render, injectStyles: function () {} };
  w.BROKER_API_BASE = 'https://api.test';
  w.closeProfile = w.showToast = w.fetchProfile = w.applyDecisionResult = function () {};
  w.dropCustomerEventKinds = function () {};
  w.DECISION_CLEARED_KINDS = [];
  w.esc = P.esc;
  w.submitDecision = function (rec, vals) { sent.push(vals); return Promise.resolve({ ok: true }); };
  w.eval(page.match(/var PROFILE_ACTIONS =[\s\S]*?\n}\n/)[0]);
  w.eval(page.match(/function renderProfile\(rec, payload\) \{[\s\S]*?\n}\n/)[0]);
  w.renderProfile({ ID: '4455' }, BASE);
  return { d: w.document, sent: sent };
}

test('clicking a decision sends the note typed with it', () => {
  const h = host();
  h.d.getElementById('cp-limit').value = '20000';
  h.d.getElementById('cp-decision-notes').value = '  Make sure to get a contract  ';
  h.d.querySelector('[data-decide="Approved"]').click();
  assert.strictEqual(h.sent.length, 1);
  assert.strictEqual(h.sent[0].decision, 'Approved');
  assert.strictEqual(h.sent[0].credit_limit, '20000');
  assert.strictEqual(h.sent[0].credit_notes, 'Make sure to get a contract');
});

test('no note typed sends an empty note, which leaves an earlier one alone', () => {
  const h = host();
  h.d.querySelector('[data-decide="Denied"]').click();
  assert.strictEqual(h.sent[0].credit_notes, '');
});
