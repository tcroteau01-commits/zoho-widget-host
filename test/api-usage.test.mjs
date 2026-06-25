// test/api-usage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../api-usage.html', import.meta.url), 'utf8');

test('calls the admin usage endpoint and whoami gate', () => {
  assert.match(html, /\/admin\/api-usage\?email=/);
  assert.match(html, /\/whoami\?email=/);
});
test('includes the impersonate helper and a version stamp', () => {
  assert.match(html, /operfi-impersonate\.js/);
  assert.match(html, /version-stamp/);
});
test('defines gauge band thresholds (60 and 85 percent)', () => {
  assert.match(html, /usageBand/);
  assert.match(html, /85/);
  assert.match(html, /60/);
});
test('renders native and unattributed reconciliation', () => {
  assert.match(html, /native/i);
  assert.match(html, /unattributed/i);
});
