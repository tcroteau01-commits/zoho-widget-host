import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

function boot() {
  const html = fs.readFileSync(new URL('../customer-approvals.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x.github.io/' });
  return dom.window;
}

test('approved rows still render a Request Credit Boost button', () => {
  const w = boot();
  const html = w.rowHtml({ ID: 's1', Customer_Company_Name: 'ACME', Credit_Decision: 'Approved' }, 0);
  assert.match(html, /data-action="boost"/);
});

test('creditBoostReady requires band, positive amount, both files, and ack', () => {
  const w = boot();
  const full = { band: 'Up to $50,000', amount: '25000', agreement: {}, coi: {}, ack: true };
  assert.equal(w.creditBoostReady(full), true);
  assert.equal(w.creditBoostReady({ ...full, band: '' }), false);
  assert.equal(w.creditBoostReady({ ...full, amount: '0' }), false);
  assert.equal(w.creditBoostReady({ ...full, agreement: null }), false);
  assert.equal(w.creditBoostReady({ ...full, coi: null }), false);
  assert.equal(w.creditBoostReady({ ...full, ack: false }), false);
});

test('submitCreditBoost POSTs multipart to /credit-boost with the request fields', async () => {
  const w = boot();
  w.brokerEmail = 'broker@op.com';
  let captured = null;
  w.fetch = (u, o) => { captured = { u, body: o.body }; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, record_id: 'cbr_9' }) }); };
  const agreement = new w.Blob([new Uint8Array([1])], { type: 'application/pdf' });
  const coi = new w.Blob([new Uint8Array([2])], { type: 'application/pdf' });
  const res = await w.submitCreditBoost('sub_9', { band: 'Over $50,000', amount: '90000' }, { agreement, coi });
  assert.ok(captured.u.includes('/credit-boost'));
  assert.equal(captured.body.get('submission_id'), 'sub_9');
  assert.equal(captured.body.get('email'), 'broker@op.com');
  assert.equal(captured.body.get('requested_limit'), 'Over $50,000');
  assert.equal(captured.body.get('credit_limit'), '90000');
  assert.equal(captured.body.get('fee_ack'), 'true');
  assert.ok(captured.body.get('customer_agreement'));
  assert.ok(captured.body.get('certificate_of_insurance'));
  assert.equal(res.record_id, 'cbr_9');
});

test('markBoostRequested flips the local record status', () => {
  const w = boot();
  w.allRecords.length = 0;
  w.allRecords.push({ ID: 's7', Credit_Decision: 'Approved' });
  w.markBoostRequested('s7');
  assert.equal(w.allRecords[0].Credit_Decision, 'Credit Boost Requested');
});
