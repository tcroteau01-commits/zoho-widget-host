// Credit's "Send reminder" on the customer profile: the click reaches the
// profile's own nudge route, with the session cookie, for the right slot.
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');
const profileJs = fs.readFileSync(path.resolve('customer-profile.js'), 'utf8');
function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

const PAYLOAD = {
  submission_id: '4455', customer_name: 'ALL AMERICAN DRILLING INC', broker: 'Twin Torches',
  status: "Credit App Rec'd - Pending Review", contacts: {}, engine: null, identity: null,
  summary: null, fv_debtor: null, fv_candidates: [], priors: [], priors_unavailable: false,
  can_act: true, notes: [], activity: [],
  credit_app: { status: 'references_pending', legacy: true, references_completed: 1,
    references_total: 2, customer: null, references: [
      { slot: 'trade1', company: 'Preferred Pump', status: 'sent', response: null,
        can_nudge: true, reminders: 0 },
      { slot: 'trade3', company: 'Santa Maria Tool', status: 'completed',
        response: { legal_name: 'SANTA MARIA TOOL INC' }, can_nudge: false } ] }
};

async function boot(reply) {
  const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
                              url: 'https://x.github.io/' }).window;
  await wait(50);
  w.eval(profileJs);
  const calls = [];
  w.fetch = function(url, opts) {
    calls.push({ url: url, opts: opts || {} });
    if (/\/nudge$/.test(url)) return Promise.resolve(reply || { ok: true, status: 200,
      json: function() { return Promise.resolve({ ok: true, sent: true, to: 'bdunham@preferredpump.com' }); } });
    return Promise.resolve({ ok: true, status: 200, json: function() { return Promise.resolve(PAYLOAD); } });
  };
  w.renderProfile({ ID: '4455' }, PAYLOAD);
  return { w: w, d: w.document, calls: calls };
}

test('the imported app is labelled and the waiting reference offers a reminder', async () => {
  const { d } = await boot();
  const root = d.getElementById('ca-profile');
  assert.match(root.textContent, /Imported from the old Zoho Forms credit application/);
  assert.ok(root.querySelector('[data-nudge="trade1"]'));
  assert.strictEqual(root.querySelector('[data-nudge="trade3"]'), null, 'an answered reference is never offered');
});

test('Send reminder posts the slot to the profile nudge route with the session cookie', async () => {
  const { d, calls } = await boot();
  d.querySelector('[data-nudge="trade1"]').click();
  await wait(20);
  const nudge = calls.find(function(c) { return /\/customer-profile\/4455\/nudge$/.test(c.url); });
  assert.ok(nudge, 'the nudge route was called');
  assert.strictEqual(nudge.opts.method, 'POST');
  assert.strictEqual(nudge.opts.credentials, 'include');
  assert.deepStrictEqual(JSON.parse(nudge.opts.body), { slot: 'trade1' });
  assert.ok(calls.some(function(c) { return /\/customer-profile\/4455$/.test(c.url); }),
            'the profile re-fetches so the reminder count updates');
});

test('a refusal is shown and the button comes back', async () => {
  const { d } = await boot({ ok: false, status: 409,
    json: function() { return Promise.resolve({ error: 'nudged 3h ago' }); } });
  const btn = d.querySelector('[data-nudge="trade1"]');
  btn.click();
  await wait(20);
  assert.match(d.getElementById('toast').textContent, /nudged 3h ago/);
  assert.strictEqual(btn.disabled, false);
});
