// tests/approvals.test.js
// The drawer LOSES content on purpose. It became unusable by accretion; this
// test is what stops it happening again.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const html = fs.readFileSync(__dirname + '/../customer-approvals.html', 'utf8');

test('the profile script is loaded', () => {
  assert.ok(html.includes('customer-profile.js'));
});

test('there is a control that opens the full profile', () => {
  assert.ok(/id="ca-open-profile"/.test(html));
});

test('the drawer no longer carries the sections that moved out', () => {
  assert.ok(!html.includes('>Customer Company<'));
  assert.ok(!html.includes('>Broker Comments<'));
});

test('the decision form stays in the drawer', () => {
  assert.ok(html.includes('Make a Decision'));
});

test('the profile fetches by submission id', () => {
  assert.ok(html.includes("'/customer-profile/'"));
});

test('the profile container exists and starts hidden', () => {
  assert.ok(/id="ca-profile"/.test(html));
});
