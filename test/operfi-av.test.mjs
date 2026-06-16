import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const JS = readFileSync(new URL('../operfi-av.js', import.meta.url), 'utf8');
const HTML = '<!doctype html><html><body><div id="c"></div></body><script>' + JS + '</script></html>';

function mk(fetchImpl) {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) { w.fetch = fetchImpl; } });
  return dom.window;
}
const carrierResp = (row) => (url) => url.indexOf('/noa-status') !== -1
  ? Promise.resolve({ ok: true, json: () => Promise.resolve({ carriers: [row] }) })
  : Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
const creditResp = (obj) => (url) => url.indexOf('/funding-credit') !== -1
  ? Promise.resolve({ ok: true, json: () => Promise.resolve(obj) })
  : Promise.resolve({ ok: true, json: () => Promise.resolve({}) });

test('carrierBadge: clean carrier shows good-to-book + pay terms', async () => {
  const w = mk(carrierResp({ vendor_id: '1', carrier_name: 'ABC', mc: '123', pay_term: 'Net 30', dnu: false }));
  w.OperFiAV.carrierBadge(w.document.getElementById('c'), { vendorId: '1', email: 'b@op.com', apiBase: 'http://api' });
  await new Promise(r => setTimeout(r, 20));
  const t = w.document.getElementById('c').textContent;
  assert.match(t, /Good to book/);
  assert.match(t, /Net 30/);
});

test('carrierBadge: factored carrier with no doc warns', async () => {
  const w = mk(carrierResp({ vendor_id: '2', pay_term: 'Factored', factoring_company: 'RTS', doc_on_file: null, dnu: false }));
  w.OperFiAV.carrierBadge(w.document.getElementById('c'), { vendorId: '2', email: 'b@op.com', apiBase: 'http://api' });
  await new Promise(r => setTimeout(r, 20));
  const t = w.document.getElementById('c').textContent;
  assert.match(t, /RTS/);
  assert.match(t, /No NOA\/LOR on file/);
});

test('carrierBadge: doc on file shows on-file (no warn)', async () => {
  const w = mk(carrierResp({ vendor_id: '3', pay_term: 'Factored', doc_on_file: { type: 'NOA' }, dnu: false }));
  w.OperFiAV.carrierBadge(w.document.getElementById('c'), { vendorId: '3', email: 'b@op.com', apiBase: 'http://api' });
  await new Promise(r => setTimeout(r, 20));
  const t = w.document.getElementById('c').textContent;
  assert.match(t, /NOA on file/);
  assert.doesNotMatch(t, /No NOA/);
});

test('carrierBadge: DNU shows red warn', async () => {
  const w = mk(carrierResp({ vendor_id: '4', pay_term: 'Factored', dnu: true }));
  w.OperFiAV.carrierBadge(w.document.getElementById('c'), { vendorId: '4', email: 'b@op.com', apiBase: 'http://api' });
  await new Promise(r => setTimeout(r, 20));
  assert.match(w.document.getElementById('c').textContent, /Do Not Use/);
});

test('customerCredit: <80% green OK', async () => {
  const w = mk(creditResp({ available: true, Buy_Limit: '200,000.00', Remaining_Credit: '92,400.00', Percent_Used: '54.00%' }));
  w.OperFiAV.customerCredit(w.document.getElementById('c'), { customerId: '9', email: 'b@op.com', apiBase: 'http://api' });
  await new Promise(r => setTimeout(r, 20));
  const el = w.document.getElementById('c');
  assert.match(el.textContent, /Credit OK/);
  assert.ok(el.querySelector('.opf-av-credit.ok'));
});

test('customerCredit: >=80% amber near limit', async () => {
  const w = mk(creditResp({ available: true, Buy_Limit: '100,000.00', Remaining_Credit: '12,000.00', Percent_Used: '88.00%' }));
  w.OperFiAV.customerCredit(w.document.getElementById('c'), { customerId: '9', email: 'b@op.com', apiBase: 'http://api' });
  await new Promise(r => setTimeout(r, 20));
  assert.match(w.document.getElementById('c').textContent, /Near credit limit/);
  assert.ok(w.document.getElementById('c').querySelector('.opf-av-credit.amber'));
});

test('customerCredit: >=100% red over limit', async () => {
  const w = mk(creditResp({ available: true, Buy_Limit: '50,000.00', Remaining_Credit: '-6,000.00', Percent_Used: '112.00%' }));
  w.OperFiAV.customerCredit(w.document.getElementById('c'), { customerId: '9', email: 'b@op.com', apiBase: 'http://api' });
  await new Promise(r => setTimeout(r, 20));
  assert.match(w.document.getElementById('c').textContent, /Over credit limit/);
  assert.ok(w.document.getElementById('c').querySelector('.opf-av-credit.red'));
});

test('customerCredit: available:false shows quiet fallback', async () => {
  const w = mk(creditResp({ available: false }));
  w.OperFiAV.customerCredit(w.document.getElementById('c'), { customerId: '9', email: 'b@op.com', apiBase: 'http://api' });
  await new Promise(r => setTimeout(r, 20));
  assert.match(w.document.getElementById('c').textContent, /unavailable/i);
});

test('carrierBadge: usdot mode calls fetch with usdot param (not vendor_id)', async () => {
  let lastUrl;
  const w = mk(function (u) { lastUrl = u; return carrierResp({ vendor_id: '1', pay_term: 'Net 30', dnu: false })(u); });
  w.OperFiAV.carrierBadge(w.document.getElementById('c'), { usdot: '92261', email: 'b@op.com', apiBase: 'http://api' });
  await new Promise(r => setTimeout(r, 20));
  assert.ok(lastUrl.includes('usdot=92261'), 'url should include usdot=92261');
  assert.ok(!lastUrl.includes('vendor_id='), 'url should NOT include vendor_id=');
  assert.match(w.document.getElementById('c').textContent, /Good to book/);
  assert.match(w.document.getElementById('c').textContent, /Net 30/);
});

test('carrierBadge: usdot mode does not pollute vendorId cache', async () => {
  let callCount = 0;
  const w = mk(function (u) { callCount++; return carrierResp({ vendor_id: '1', pay_term: 'Quick Pay', dnu: false })(u); });
  const el = w.document.getElementById('c');
  w.OperFiAV.carrierBadge(el, { usdot: '92261', email: 'b@op.com', apiBase: 'http://api' });
  await new Promise(r => setTimeout(r, 20));
  w.OperFiAV.carrierBadge(el, { vendorId: '1', email: 'b@op.com', apiBase: 'http://api' });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(callCount, 2, 'usdot and vendorId keys should be separate cache entries');
});

test('carrierBadge: neither vendorId nor usdot clears element', async () => {
  const w = mk(carrierResp({ vendor_id: '1', pay_term: 'Net 30', dnu: false }));
  const el = w.document.getElementById('c');
  el.innerHTML = '<span>old</span>';
  w.OperFiAV.carrierBadge(el, { email: 'b@op.com', apiBase: 'http://api' });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(el.innerHTML, '', 'element should be cleared when neither vendorId nor usdot provided');
});

test('carrierBadge: stale response does not overwrite a newer selection', async () => {
  let calls = 0;
  const w = mk(function (url) {
    calls++;
    // first call (vendor 1) resolves LATE with pay_term Net 99; second (vendor 2) resolves fast with Net 30
    const isFirst = url.indexOf('vendor_id=1') !== -1;
    const row = isFirst ? { vendor_id:'1', pay_term:'Net 99', dnu:false } : { vendor_id:'2', pay_term:'Net 30', dnu:false };
    const delay = isFirst ? 60 : 5;
    return new Promise(function (res) { setTimeout(function () { res({ ok:true, json: () => Promise.resolve({ carriers:[row] }) }); }, delay); });
  });
  const el = w.document.getElementById('c');
  w.OperFiAV.carrierBadge(el, { vendorId: '1', email: 'b@op.com', apiBase: 'http://api' });
  w.OperFiAV.carrierBadge(el, { vendorId: '2', email: 'b@op.com', apiBase: 'http://api' });
  await new Promise(r => setTimeout(r, 120));
  assert.match(el.textContent, /Net 30/);
  assert.doesNotMatch(el.textContent, /Net 99/);
});
