import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

function boot(){
  const html = fs.readFileSync(new URL('../customer-approvals.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x.github.io/' });
  return dom.window;
}

test('DECISION_VALUES exposes all 8 settable values', () => {
  const w = boot();
  assert.ok(Array.isArray(w.DECISION_VALUES));
  assert.equal(w.DECISION_VALUES.length, 8);
  assert.ok(w.DECISION_VALUES.includes('Approved'));
  assert.ok(w.DECISION_VALUES.includes('Denied'));
});

test('submitDecision blocks Approved without a limit and posts otherwise', async () => {
  const w = boot();
  w.brokerEmail = 'rev@op.com';
  const calls = [];
  w.fetch = (u, o) => { calls.push({ u, body: JSON.parse(o.body) }); return Promise.resolve({ json: () => Promise.resolve({ ok: true, decision: JSON.parse(o.body).decision }) }); };
  // Approved with no limit -> rejected, no POST
  const blocked = await w.submitDecision({ ID: '555' }, { decision: 'Approved', credit_limit: '', credit_notes: '' });
  assert.equal(blocked.ok, false);
  assert.equal(calls.length, 0);
  // Approved with a limit -> posts the right body
  await w.submitDecision({ ID: '555' }, { decision: 'Approved', credit_limit: '30000', credit_notes: 'ok' });
  assert.ok(calls[0].u.includes('/credit-decision'));
  assert.equal(calls[0].body.submission_id, '555');
  assert.equal(calls[0].body.decision, 'Approved');
  assert.equal(calls[0].body.credit_limit, '30000');
});
