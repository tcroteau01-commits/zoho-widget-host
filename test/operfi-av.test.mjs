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

// Exception-only badge: clean carriers show NO status badge (no "Good to book",
// no "approved/pending" reassurance). Only vetting_flags from the backend render.
test('carrierBadge: clean carrier shows only pay terms, no status badge', async () => {
  const w = mk(carrierResp({ vendor_id: '1', carrier_name: 'ABC', mc: '123', pay_term: 'Net 30', vetting_flags: [], dnu: false }));
  w.OperFiAV.carrierBadge(w.document.getElementById('c'), { vendorId: '1', email: 'b@op.com', apiBase: 'http://api' });
  await new Promise(r => setTimeout(r, 20));
  const t = w.document.getElementById('c').textContent;
  assert.match(t, /Net 30/);
  assert.doesNotMatch(t, /Good to book/);
  assert.doesNotMatch(t, /NOA/);
});

test('carrierBadge: factored carrier with no flags shows no NOA warning (heuristic gone)', async () => {
  const w = mk(carrierResp({ vendor_id: '2', pay_term: 'Factoring Company', factoring_company: 'RTS', vetting_flags: [], dnu: false }));
  w.OperFiAV.carrierBadge(w.document.getElementById('c'), { vendorId: '2', email: 'b@op.com', apiBase: 'http://api' });
  await new Promise(r => setTimeout(r, 20));
  const t = w.document.getElementById('c').textContent;
  assert.match(t, /RTS/);
  assert.doesNotMatch(t, /No NOA/);
  assert.doesNotMatch(t, /Good to book/);
});

test('carrierBadge: missing-NOA flag shows amber warn chip', async () => {
  const w = mk(carrierResp({ vendor_id: '3', pay_term: 'Factoring Company', factoring_company: 'RTS',
    vetting_flags: [{ key: 'noa_needed', label: 'Missing NOA', level: 'warn' }], dnu: false }));
  const el = w.document.getElementById('c');
  w.OperFiAV.carrierBadge(el, { vendorId: '3', email: 'b@op.com', apiBase: 'http://api' });
  await new Promise(r => setTimeout(r, 20));
  assert.match(el.textContent, /Missing NOA/);
  assert.ok(el.querySelector('.opf-av-warn'), 'warn-level chip uses amber class');
});

test('carrierBadge: denied flag shows red danger chip', async () => {
  const w = mk(carrierResp({ vendor_id: '5',
    vetting_flags: [{ key: 'denied', label: 'Denied', level: 'danger' }], dnu: false }));
  const el = w.document.getElementById('c');
  w.OperFiAV.carrierBadge(el, { vendorId: '5', email: 'b@op.com', apiBase: 'http://api' });
  await new Promise(r => setTimeout(r, 20));
  assert.match(el.textContent, /Denied/);
  assert.ok(el.querySelector('.opf-av-dnu'), 'danger-level chip uses red class');
});

test('carrierBadge: DNU flag shows red Do Not Use chip', async () => {
  const w = mk(carrierResp({ vendor_id: '4',
    vetting_flags: [{ key: 'dnu', label: 'Do Not Use — flagged by OperFi', level: 'danger' }] }));
  const el = w.document.getElementById('c');
  w.OperFiAV.carrierBadge(el, { vendorId: '4', email: 'b@op.com', apiBase: 'http://api' });
  await new Promise(r => setTimeout(r, 20));
  assert.match(el.textContent, /Do Not Use/);
  assert.ok(el.querySelector('.opf-av-dnu'));
});

test('carrierBadge: multiple flags all render', async () => {
  const w = mk(carrierResp({ vendor_id: '6', vetting_flags: [
    { key: 'denied', label: 'Denied', level: 'danger' },
    { key: 'noa_needed', label: 'Missing NOA', level: 'warn' }] }));
  const el = w.document.getElementById('c');
  w.OperFiAV.carrierBadge(el, { vendorId: '6', email: 'b@op.com', apiBase: 'http://api' });
  await new Promise(r => setTimeout(r, 20));
  assert.match(el.textContent, /Denied/);
  assert.match(el.textContent, /Missing NOA/);
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

// Authority chip tests — call _carrierHtml directly through a shared window instance
const wAV = mk(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));

test('carrierHtml shows a red chip for dual authority', () => {
  const html = wAV.OperFiAV._carrierHtml({ authority_class: 'dual' }, true);
  assert.match(html, /double-broker/i);
  assert.match(html, /opf-av-dnu/);
});

test('carrierHtml shows a chip for broker_only', () => {
  const html = wAV.OperFiAV._carrierHtml({ authority_class: 'broker_only' }, true);
  assert.match(html, /Broker authority, not a carrier/i);
});

test('carrierHtml shows no authority chip for a carrier', () => {
  const html = wAV.OperFiAV._carrierHtml({ authority_class: 'carrier' }, true);
  assert.doesNotMatch(html, /double-broker|not a carrier/i);
});

test('carrierHtml suppresses the authority chip when showAuthority is false', () => {
  const html = wAV.OperFiAV._carrierHtml({ authority_class: 'dual' }, false);
  assert.doesNotMatch(html, /double-broker/i);
});
