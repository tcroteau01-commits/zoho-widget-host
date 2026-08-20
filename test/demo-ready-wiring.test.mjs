import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The 7 report widgets that carry the client-side fixture. Each resolves the
// Creator login email in a getInitParams() chain and then renders. isDemo() is
// synchronous but the account flag it now reads is resolved by an async /whoami
// call, so every one of them MUST await OPERFI_DEMO.ready(email) before its first
// render -- otherwise the fixture check runs too early, the widget fetches the
// real backend, and an invited demo user gets 404 / Unauthorized on every tile.
const FIXTURE_WIDGETS = [
  'dashboard', 'wallet', 'aging', 'loads-margins',
  'reserve-report', 'vendor-payments', 'credit-dashboard'
];

function read(name) {
  return fs.readFileSync(new URL('../' + name + '.html', import.meta.url), 'utf8');
}

test('every fixture widget awaits OPERFI_DEMO.ready() before rendering', () => {
  FIXTURE_WIDGETS.forEach(function (name) {
    assert.match(read(name), /window\.OPERFI_DEMO\.ready\(/,
      name + '.html never calls OPERFI_DEMO.ready(), so its isDemo() check races /whoami');
  });
});

test('every ready() call is guarded against demo-data.js failing to load', () => {
  // demo-data.js is served from app.operfi.com. If it fails to load, an unguarded
  // window.OPERFI_DEMO.ready() throws inside the init chain and the widget renders
  // nothing at all, a far worse failure than losing the fixture.
  FIXTURE_WIDGETS.forEach(function (name) {
    const html = read(name);
    const total = (html.match(/window\.OPERFI_DEMO\.ready\(/g) || []).length;
    const guarded = (html.match(/window\.OPERFI_DEMO && window\.OPERFI_DEMO\.ready\(/g) || []).length;
    assert.equal(guarded, total, name + '.html has an unguarded OPERFI_DEMO.ready() call');
    assert.ok(total > 0, name + '.html has no ready() call to guard');
  });
});
