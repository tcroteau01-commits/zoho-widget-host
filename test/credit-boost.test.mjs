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

test('creditBoostReady: Up to $50,000 needs no amount; Over $50,000 needs amount over 50000', () => {
  const w = boot();
  const base = { agreement: {}, coi: {}, ack: true };
  // Up to $50,000: amount is not required (records the ceiling)
  assert.equal(w.creditBoostReady({ ...base, band: 'Up to $50,000' }), true);
  assert.equal(w.creditBoostReady({ ...base, band: 'Up to $50,000', amount: '' }), true);
  // Over $50,000: requires a specific amount strictly greater than 50000
  assert.equal(w.creditBoostReady({ ...base, band: 'Over $50,000', amount: '75000' }), true);
  assert.equal(w.creditBoostReady({ ...base, band: 'Over $50,000', amount: '50000' }), false);
  assert.equal(w.creditBoostReady({ ...base, band: 'Over $50,000', amount: '' }), false);
  // band, both files, and ack are always required
  assert.equal(w.creditBoostReady({ ...base, band: '' }), false);
  assert.equal(w.creditBoostReady({ band: 'Up to $50,000', coi: {}, ack: true }), false);
  assert.equal(w.creditBoostReady({ band: 'Up to $50,000', agreement: {}, ack: true }), false);
  assert.equal(w.creditBoostReady({ band: 'Up to $50,000', agreement: {}, coi: {}, ack: false }), false);
});

test('openCreditBoost hides the desired-amount box until Over $50,000 is chosen', () => {
  const w = boot();
  w.openCreditBoost('s1');
  const doc = w.document;
  const wrap = doc.getElementById('cb-amount-wrap');
  assert.equal(wrap.style.display, 'none');
  const over = doc.querySelector('input[name="cb-band"][value="Over $50,000"]');
  over.checked = true;
  over.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.notEqual(wrap.style.display, 'none');
  const up = doc.querySelector('input[name="cb-band"][value="Up to $50,000"]');
  up.checked = true; over.checked = false;
  up.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(wrap.style.display, 'none');
});

test('submitting without the fee-ack checkbox highlights it red and does not POST', () => {
  const w = boot();
  w.brokerEmail = 'b@op.com';
  let called = false;
  w.fetch = () => { called = true; return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }); };
  w.openCreditBoost('s1');
  const doc = w.document;
  doc.getElementById('cb-submit').click();
  assert.equal(called, false, 'must not POST when required fields are missing');
  const ackRow = doc.getElementById('cb-ack-row');
  assert.match(ackRow.style.outline, /d92d20|solid/i, 'fee-ack row should be outlined red');
  // checking the box clears its highlight
  const ack = doc.getElementById('cb-ack');
  ack.checked = true;
  ack.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(ackRow.style.outline, '', 'highlight clears once acknowledged');
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
