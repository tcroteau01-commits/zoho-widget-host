import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
const cp = fs.readFileSync(new URL('../company-profile.html', import.meta.url), 'utf8');
const co = fs.readFileSync(new URL('../carrier-onboarding.html', import.meta.url), 'utf8');

test('company-profile loads users from /broker-users, not the SDK', () => {
  assert.match(cp, /\/broker-users\?email=/);
  assert.ok(!/getRecords\(\{[^}]*Authorized_Users/s.test(cp), 'should not SDK-read Authorized_Users for the list');
});
// ONBLINK1: /broker-users is gated on Company Profile, which a client admin can
// remove. The send route resolves the contact server-side, so onboarding must
// not depend on it.
test('carrier-onboarding does not depend on /broker-users', () => {
  assert.doesNotMatch(co, /\/broker-users/);
  assert.doesNotMatch(co, /self_contact_id/);
});
