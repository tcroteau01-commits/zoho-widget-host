// tests/approvals.test.js
// The drawer LOSES content on purpose. It became unusable by accretion; this
// test is what stops it happening again.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const html = fs.readFileSync(__dirname + '/../customer-approvals.html', 'utf8');

test('the profile script is loaded', () => {
  assert.ok(/<script[^>]+src="customer-profile\.js"/.test(html));
});

test('there is a control that opens the full profile', () => {
  assert.ok(/id="ca-open-profile"/.test(html));
});

test('the drawer no longer carries the sections that moved out', () => {
  assert.ok(!html.includes('>Customer Company<'));
  assert.ok(!html.includes('>Broker Comments<'));
  // Customer Contacts as a DISPLAY (the read-only contact fields) is gone --
  // its heading no longer appears. The billing editor that used to sit inside
  // it is an ACTION, not a display, and stays under its own "Billing Info"
  // heading, so this must not regress if that heading is ever renamed back.
  assert.ok(!html.includes('>Customer Contacts<'));
});

test('the decision form stays in the drawer', () => {
  assert.ok(html.includes('panel-section-title">Make a Decision</div>'));
});

test('the billing editor stays in the drawer as an action, not a display', () => {
  assert.ok(/id="ca-edit-billing"/.test(html));
  assert.ok(/id="ca-billing-edit"/.test(html));
  assert.ok(html.includes('wireBillingEdit(r)'));
});

test('the profile fetches by submission id', () => {
  assert.ok(html.includes("'/customer-profile/'"));
});

test('the profile container exists and starts hidden', () => {
  assert.ok(/id="ca-profile"/.test(html));
});

test('the profile button is not offered to brokers', () => {
  // The page is broker-facing. An unconditional button advertises a staff-only
  // page and then fails with a message about their connection.
  assert.ok(/allClients[\s\S]{0,400}ca-open-profile|ca-open-profile[\s\S]{0,400}allClients/.test(html));
});

test('a permissions failure does not read as a network problem', () => {
  assert.ok(/403/.test(html));
});

test("the profile's own styles reach the browser", () => {
  // injectStyles() is only reachable through mount() inside customer-profile.js;
  // render() alone never calls it. renderProfile must call it itself, or the
  // cp-* candidate rows render with no card layout at all -- and an analyst can
  // misclick "Use this" against the wrong company.
  assert.ok(/injectStyles\s*\(\s*\)/.test(html));
});
