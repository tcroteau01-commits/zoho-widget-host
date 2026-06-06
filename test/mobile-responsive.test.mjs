import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

const HEAVY = ['aging','loads-margins','vendor-payments','reserve-report','history',
  'credit-dashboard','customer-approvals','view-vendors','tms-load-board'];

test('heavy-table widgets have a 640px breakpoint', () => {
  HEAVY.forEach(function (w) {
    const html = fs.readFileSync(new URL('../' + w + '.html', import.meta.url), 'utf8');
    assert.ok(/@media[^{]*max-width:\s*640px/.test(html), w + ' missing @media max-width:640px');
  });
});

test('heavy-table widgets expose row labels for card reflow (data-label or label spans)', () => {
  HEAVY.forEach(function (w) {
    const html = fs.readFileSync(new URL('../' + w + '.html', import.meta.url), 'utf8');
    assert.ok(/data-label=|class="[^"]*label/.test(html), w + ' has no data-label/label hooks for card reflow');
  });
});

const GRIDFORM = ['dashboard','carrier-profile','carrier-onboarding','company-profile',
  'credit-check','wallet','noa-management','tms-load-detail'];

test('grid/form widgets have a 640px breakpoint', () => {
  GRIDFORM.forEach(function (w) {
    const html = fs.readFileSync(new URL('../' + w + '.html', import.meta.url), 'utf8');
    assert.ok(/@media[^{]*max-width:\s*640px/.test(html), w + ' missing @media max-width:640px');
  });
});

test('public widgets + admin bar have mobile handling', () => {
  ['tms-carrier-upload','resources'].forEach(function (w) {
    const html = fs.readFileSync(new URL('../' + w + '.html', import.meta.url), 'utf8');
    assert.ok(/@media[^{]*max-width:\s*640px/.test(html), w + ' missing @media max-width:640px');
  });
  const js = fs.readFileSync(new URL('../operfi-impersonate.js', import.meta.url), 'utf8');
  assert.ok(/@media[^{]*max-width:\s*640px/.test(js), 'operfi-impersonate.js admin bar missing 640px handling');
});
