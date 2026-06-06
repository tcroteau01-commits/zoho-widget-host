import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
const WIDGETS = ['aging','carrier-onboarding','carrier-profile','company-profile','credit-check',
  'credit-dashboard','customer-approvals','dashboard','history','loads-margins','noa-management',
  'reserve-report','tms-load-board','tms-load-detail','vendor-payments','view-vendors','wallet'];
test('every portal widget includes operfi-impersonate.js', () => {
  WIDGETS.forEach(function (w) {
    const html = fs.readFileSync(new URL('../' + w + '.html', import.meta.url), 'utf8');
    assert.ok(/operfi-impersonate\.js/.test(html), w + ' missing operfi-impersonate.js include');
  });
});
