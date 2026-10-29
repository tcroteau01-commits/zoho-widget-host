// COIHOLD1: the contingent cargo hold on the three purchase pages. The API is the gate
// (403 {error: "coi_hold", message}); these check the banner, the disabled submit, and that
// the refusal shows the message instead of "coi_hold".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HELPER = readFileSync(new URL('../operfi-coi-hold.js', import.meta.url), 'utf8');
const page = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const HOLD = { reason: 'no_contingent_cargo',
  message: 'We need a current certificate of insurance showing contingent cargo coverage before we can fund ' +
           'your invoices. Please upload it, or have your insurance agent email it to insurance@operfi.com.' };
const tick = () => new Promise(r => setTimeout(r, 20));
const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

function mk(file, fetchImpl, records) {
  const dom = new JSDOM(page(file), { runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://app.operfi.com/' + file });
  const w = dom.window;
  w.fetch = (url, opts) => { records && records.push({ url: String(url), opts: opts || {} }); return fetchImpl(String(url), opts); };
  w.eval(HELPER);
  w.brokerEmail = 'b@x.test';
  return w;
}
const holdFetch = (hold) => (u) => u.indexOf('/coi-hold') !== -1 ? json(200, { hold }) : json(200, {});

// ── the helper ───────────────────────────────────────────────────────────────

test('check resolves the hold, null when clear, null when the call fails (fails open)', async () => {
  let w = mk('draft-loads.html', holdFetch(HOLD));
  assert.deepEqual(await w.OperFiCoiHold.check({ email: 'b@x.test', apiBase: 'http://api' }), HOLD);
  w = mk('draft-loads.html', holdFetch(null));
  assert.equal(await w.OperFiCoiHold.check({ email: 'b@x.test', apiBase: 'http://api' }), null);
  w = mk('draft-loads.html', () => Promise.reject(new Error('down')));
  assert.equal(await w.OperFiCoiHold.check({ email: 'b@x.test', apiBase: 'http://api' }), null);
  w = mk('draft-loads.html', () => json(500, {}));
  assert.equal(await w.OperFiCoiHold.check({ email: 'b@x.test', apiBase: 'http://api' }), null);
});

test('the banner shows the message with insurance@ as a mailto link, and hides when clear', () => {
  const w = mk('draft-loads.html', holdFetch(null));
  const el = w.document.getElementById('coi-hold-banner');
  w.OperFiCoiHold.render(el, HOLD);
  assert.match(el.textContent, /contingent cargo/);
  assert.equal(el.querySelector('a[href="mailto:insurance@operfi.com"]').textContent, 'insurance@operfi.com');
  assert.notEqual(el.style.display, 'none');
  w.OperFiCoiHold.render(el, null);
  assert.equal(el.style.display, 'none');
  assert.equal(el.innerHTML, '');
});

test('the banner escapes the message', () => {
  const w = mk('draft-loads.html', holdFetch(null));
  assert.doesNotMatch(w.OperFiCoiHold._html({ message: '<img src=x onerror=alert(1)>' }), /<img/);
});

test('refusal reads only a coi_hold answer', () => {
  const w = mk('draft-loads.html', holdFetch(null));
  assert.equal(w.OperFiCoiHold.refusal({ error: 'coi_hold', message: 'M' }), 'M');
  assert.match(w.OperFiCoiHold.refusal({ error: 'coi_hold' }), /insurance@operfi\.com/);
  assert.equal(w.OperFiCoiHold.refusal({ error: 'Forbidden' }), null);
  assert.equal(w.OperFiCoiHold.refusal(null), null);
});

test('all three purchase pages load the helper and carry a banner slot', () => {
  for (const f of ['index.html', 'draft-loads.html', 'tms-load-detail.html']) {
    assert.match(page(f), /operfi-coi-hold\.js/, f);
    assert.match(page(f), /coi-hold-banner/, f);
  }
});

// ── Quick Submit (index.html) ────────────────────────────────────────────────

test('Quick Submit: a held broker sees the banner and cannot submit', async () => {
  const w = mk('index.html', holdFetch(HOLD));
  w.stepValid = () => true;
  w.payFasterBlocksSubmit = () => false;
  w.refreshValidity();
  assert.equal(w.document.getElementById('submit-btn').disabled, false, 'valid form, no hold yet');
  await w.loadCoiHold();
  assert.equal(w.document.getElementById('submit-btn').disabled, true);
  assert.match(w.document.getElementById('coi-hold-banner').textContent, /contingent cargo/);
});

test('Quick Submit: a clear broker is not affected', async () => {
  const w = mk('index.html', holdFetch(null));
  w.stepValid = () => true;
  w.payFasterBlocksSubmit = () => false;
  await w.loadCoiHold();
  assert.equal(w.document.getElementById('submit-btn').disabled, false);
  assert.equal(w.document.getElementById('coi-hold-banner').style.display, 'none');
});

test('Quick Submit: a coi_hold refusal shows the message, not "coi_hold"', async () => {
  const w = mk('index.html', (u) => u.indexOf('/funding-submit') !== -1
    ? json(403, { error: 'coi_hold', reason: 'no_contingent_cargo', message: HOLD.message }) : json(200, {}));
  w._mergedPdfs = () => Promise.resolve({});
  await w.submitLoad();
  const status = w.document.getElementById('submit-status').textContent;
  assert.match(status, /contingent cargo/);
  assert.doesNotMatch(status, /coi_hold/);
  assert.equal(w.document.getElementById('submit-btn').disabled, true, 'stays disabled while held');
  assert.match(w.document.getElementById('coi-hold-banner').textContent, /insurance@operfi\.com/);
});

// ── Draft Loads ──────────────────────────────────────────────────────────────

test('Draft Loads: a held broker posts nothing and Submit all Ready is disabled', async () => {
  const records = [];
  const w = mk('draft-loads.html', holdFetch(HOLD), records);
  await w.loadCoiHold();
  w.renderSummary({ total: 1, ready: 1, attention: 0 });
  assert.equal(w.document.getElementById('submit-all').disabled, true);
  await w.submitIds(['900']);
  assert.ok(!records.find(r => r.url.indexOf('/draft-loads/submit') !== -1), 'no submit posted');
  assert.match(w.document.getElementById('coi-hold-banner').textContent, /contingent cargo/);
});

test('Draft Loads: a coi_hold refusal raises the banner instead of "Submit failed"', async () => {
  const w = mk('draft-loads.html', (u) => u.indexOf('/draft-loads/submit') !== -1
    ? json(403, { error: 'coi_hold', reason: 'no_contingent_cargo', message: HOLD.message }) : json(200, {}));
  const toasts = [];
  w.showToast = (m) => toasts.push(m);
  await w.submitIds(['900']);
  assert.match(w.document.getElementById('coi-hold-banner').textContent, /contingent cargo/);
  assert.ok(!toasts.includes('Submit failed'), toasts.join(' | '));
});

test('Draft Loads: a clear broker still submits', async () => {
  const records = [];
  const w = mk('draft-loads.html', (u) => u.indexOf('/draft-loads/submit') !== -1
    ? json(200, { submitted: [], skipped: [], count: 0 }) : holdFetch(null)(u), records);
  await w.loadCoiHold();
  await w.submitIds(['900']);
  assert.ok(records.find(r => r.url.indexOf('/draft-loads/submit') !== -1));
});

// ── TMS Load Detail ──────────────────────────────────────────────────────────

const LOAD = { id: '55', carrier_id: 'v1', status: 'Ready to Submit', documents: [] };

test('TMS Load Detail: a held broker cannot click Submit for Factoring', async () => {
  const w = mk('tms-load-detail.html', holdFetch(HOLD));
  w._gateFailures = () => [];
  w.renderSubmitPanel(LOAD);
  assert.equal(w.document.getElementById('btn-submit-factoring').disabled, false, 'no hold yet');
  await w.loadCoiHold();
  assert.equal(w.document.getElementById('btn-submit-factoring').disabled, true);
  assert.match(w.document.getElementById('coi-hold-banner').textContent, /contingent cargo/);
  w.renderSubmitPanel(LOAD);  // a re-render keeps the hold
  assert.equal(w.document.getElementById('btn-submit-factoring').disabled, true);
  assert.match(w.document.getElementById('coi-hold-banner').textContent, /contingent cargo/);
});

test('TMS Load Detail: a coi_hold refusal shows the message', async () => {
  const w = mk('tms-load-detail.html', (u) => u.indexOf('/tms-submit') !== -1
    ? json(403, { error: 'coi_hold', reason: 'no_contingent_cargo', message: HOLD.message }) : json(200, {}));
  w._gateFailures = () => [];
  w.renderSubmitPanel(LOAD);
  await w.submitForFactoring(LOAD);
  assert.match(w.document.getElementById('submit-result').textContent, /contingent cargo/);
  assert.equal(w.document.getElementById('btn-submit-factoring').disabled, true);
});
