// tests/submitted-by.test.js
// SUBMITBY1 (Tom, 2026-09-30): show the broker user who submitted the check.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const P = require('../customer-profile.js');

const BASE = { submission_id: '1', customer_name: 'OPERATION FINANCE INC',
  broker: 'TESTING OPERFI ACCOUNT', status: 'Approved', contacts: {}, engine: null,
  identity: null, summary: null, fv_debtor: null, fv_candidates: [], priors: [],
  priors_unavailable: false, can_act: true };

test('the profile header names the person, then the account', () => {
  const html = P.render(Object.assign({}, BASE, {
    submitted_by: { name: 'TOMMY BUNS', email: 't.croteau01@gmail.com' } }));
  assert.ok(html.includes('Submitted by TOMMY BUNS &middot; t.croteau01@gmail.com, TESTING OPERFI ACCOUNT'));
});

test('with no submitter it reads exactly as before', () => {
  assert.ok(P.render(BASE).includes('Submitted by TESTING OPERFI ACCOUNT</div>'));
});

test('the side pane line carries the submitter from the row', () => {
  const html = fs.readFileSync(__dirname + '/../customer-approvals.html', 'utf8').replace(/\r\n/g, '\n');
  const src = html.match(/function submitterOf\(r\) \{[\s\S]*?\n}\n/)[0];
  const submitterOf = new Function(src + '; return submitterOf;')();
  assert.deepStrictEqual(submitterOf({ Contact: { 'Contact_Name.first_name': 'TOMMY',
    'Contact_Name.last_name': 'BUNS', Email: 't.croteau01@gmail.com' } }),
    { name: 'TOMMY BUNS', email: 't.croteau01@gmail.com' });
  assert.strictEqual(submitterOf({}), null);
  assert.strictEqual(submitterOf({ Contact: '3773785000000481025' }), null);
  assert.ok(html.includes("' by ' + esc(submitterOf(r).name || submitterOf(r).email)"));
});
