import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
const cp = fs.readFileSync(new URL('../company-profile.html', import.meta.url), 'utf8');
const co = fs.readFileSync(new URL('../carrier-onboarding.html', import.meta.url), 'utf8');

test('company-profile loads users from /broker-users, not the SDK', () => {
  assert.match(cp, /\/broker-users\?email=/);
  assert.ok(!/getRecords\(\{[^}]*Authorized_Users/s.test(cp), 'should not SDK-read Authorized_Users for the list');
});
test('carrier-onboarding gets self_contact_id from /broker-users', () => {
  assert.match(co, /\/broker-users\?email=/);
  assert.match(co, /self_contact_id/);
});
