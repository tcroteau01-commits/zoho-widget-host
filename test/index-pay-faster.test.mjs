// PAYCHG1 Task 8: Pay carrier faster on Submit Load (index.html).
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const PF_SRC = readFileSync(new URL('../pay-faster.js', import.meta.url), 'utf8');

const CTX = { enabled: true, trained: true, training_video_id: 'vid-1', qp_fee_pct: '4',
  operfi_share_pct: '2', reserve: { cash: 1250, status: 'ok' } };

const CARRIERS = [
  { vendor_id: 'v-net', carrier_name: 'Sample Hauling LLC', payment_terms: 'Standard Net 30' },
  { vendor_id: 'v-fac', carrier_name: 'Sample Freight Inc', payment_terms: 'Factoring Company - Example Capital' },
  { vendor_id: 'v-qp', carrier_name: 'Sample Express LLC', payment_terms: 'Quick Pay' },
  { vendor_id: 'v-fcqp', carrier_name: 'Sample Capital Carrier', payment_terms: 'Factoring Company - Quick Pay - Example Capital' },
  { vendor_id: 'v-x', carrier_name: 'Sample Other LLC', payment_terms: 'No Invoice - 180 Days' }
];

function makeDom(opts) {
  opts = opts || {};
  const calls = [];
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.__calls = calls;
  w.__opened = [];
  w.open = (u) => { w.__opened.push(u); };
  w.fetch = (url, o) => {
    const u = String(url);
    calls.push({ url: u, opts: o || {} });
    let status = 200, body = {};
    if (u.indexOf('/pay-change/context') !== -1) {
      if (opts.ctx === 404) { status = 404; body = { error: 'not_found' }; }
      else body = opts.ctx || CTX;
    } else if (u.indexOf('/tms-carriers') !== -1) {
      body = { carriers: CARRIERS, gate_enabled: false };
    } else if (u.indexOf('/funding-finalize') !== -1) {
      body = opts.finalize || { ok: true };
    } else if (u.indexOf('/funding-submit') !== -1) {
      body = { record_id: '4100000000000000001' };
    }
    return Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(body) });
  };
  w.ZOHO = { CREATOR: { UTIL: { getInitParams: () => ({ loginUser: 'b@x.com' }) }, init: () => Promise.resolve() } };
  w.OperFiAV = { carrierBadge: () => {}, customerCredit: () => {} };
  w.brokerEmail = 'b@x.com';
  w.eval(PF_SRC);
  return w;
}
const $ = (w, id) => w.document.getElementById(id);
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => { for (let i = 0; i < 8; i++) await tick(); };

function pickCarrier(w, vid) {
  const sel = $(w, 'carrier-select');
  if (!Array.prototype.some.call(sel.options, (o) => o.value === vid)) {
    const o = w.document.createElement('option'); o.value = vid; o.textContent = vid; sel.appendChild(o);
  }
  sel.value = vid;
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
}
function setVal(w, id, v) {
  const el = $(w, id); el.value = v;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
}
function toggle(w, on) {
  const t = $(w, 'pf-toggle'); t.checked = on;
  t.dispatchEvent(new w.Event('change', { bubbles: true }));
}
function pickPayer(w, p) {
  const r = $(w, 'pf-payer-' + p); r.checked = true;
  r.dispatchEvent(new w.Event('change', { bubbles: true }));
}
async function ready(opts) {
  const w = makeDom(opts);
  await flush();  // let the page boot (carrier list, listeners) before driving it
  await w.loadPayFasterContext();
  w.__calls.length = 0;
  return w;
}
const visible = (el) => !!el && el.style.display !== 'none' && !el.hidden;

test('hidden when context 404', async () => {
  const w = await ready({ ctx: 404 });
  pickCarrier(w, 'v-net');
  assert.ok(!visible($(w, 'pay-faster')));
  assert.strictEqual($(w, 'sum-pay-faster').innerHTML.trim(), '');
});

test('net30 shows toggle off by default', async () => {
  const w = await ready();
  pickCarrier(w, 'v-net');
  assert.ok(visible($(w, 'pay-faster')));
  assert.strictEqual($(w, 'pf-toggle').checked, false);
  assert.ok(!$(w, 'pf-payer-carrier'));
  assert.match($(w, 'sum-pay-faster').textContent, /Net 30/);
});

test('ineligible carrier hides the block', async () => {
  const w = await ready();
  pickCarrier(w, 'v-x');
  assert.ok(!visible($(w, 'pay-faster')));
});

test('quickpay carrier shows split without toggle', async () => {
  const w = await ready();
  setVal(w, 'carrier-rate', '2000');
  pickCarrier(w, 'v-qp');
  assert.ok(!visible($(w, 'pay-faster')));
  const s = $(w, 'sum-pay-faster').textContent;
  assert.match(s, /Quick Pay/);
  assert.match(s, /\$80\.00/);
  assert.match(s, /\$1,920\.00/);
});

test('toggle on requires payer before submit', async () => {
  const w = await ready();
  setVal(w, 'carrier-rate', '2000');
  pickCarrier(w, 'v-net');
  const btn = $(w, 'submit-btn');
  toggle(w, true);
  assert.ok($(w, 'pf-payer-carrier'));
  assert.strictEqual($(w, 'pf-payer-carrier').checked, false);
  assert.strictEqual($(w, 'pf-payer-broker').checked, false);
  assert.strictEqual(btn.disabled, true);
  assert.strictEqual(w.payFasterBlocksSubmit(), true);
  pickPayer(w, 'carrier');
  assert.match($(w, 'sum-pay-faster').textContent, /\$80\.00/);
  // other required fields are empty in this fixture, so assert the pay-faster gate directly
  assert.strictEqual(w.payFasterBlocksSubmit(), false);
  toggle(w, false);
  assert.strictEqual(w.payFasterBlocksSubmit(), false);
  toggle(w, true);
  assert.strictEqual(w.payFasterBlocksSubmit(), true);
});

test('rate_edit_recomputes', async () => {
  const w = await ready();
  setVal(w, 'customer-rate', '2500');
  setVal(w, 'carrier-rate', '2000');
  pickCarrier(w, 'v-net');
  toggle(w, true);
  pickPayer(w, 'carrier');
  assert.match($(w, 'sum-pay-faster').textContent, /\$80\.00/);
  const m1 = $(w, 'sum-margin').textContent;
  setVal(w, 'carrier-rate', '1000');
  const s = $(w, 'sum-pay-faster').textContent;
  assert.match(s, /\$40\.00/);
  assert.doesNotMatch(s, /\$80\.00/);
  assert.notStrictEqual($(w, 'sum-margin').textContent, m1);
  assert.match($(w, 'pf-options').textContent, /\$960\.00/);
});

test('carrier_switch_clears_pay_faster', async () => {
  const w = await ready();
  setVal(w, 'carrier-rate', '2000');
  pickCarrier(w, 'v-net');
  toggle(w, true);
  pickPayer(w, 'carrier');
  pickCarrier(w, 'v-qp');
  assert.ok(!visible($(w, 'pay-faster')));
  assert.strictEqual($(w, 'pf-toggle').checked, false);
  assert.strictEqual(w.payFasterPayload(), null);
  pickCarrier(w, 'v-net');
  assert.strictEqual($(w, 'pf-toggle').checked, false);
  assert.strictEqual(w.payFasterPayload(), null);
});

function fillAndSubmit(w) {
  setVal(w, 'customer-rate', '2500');
  setVal(w, 'carrier-rate', '2000');
  // bypass document merging for the fixture
  w.eval('_mergedPdfs = function () { return Promise.resolve({ customer: null, carrier: null }); };');
  return w.submitLoad();
}
const finalizeBody = (w) => {
  const c = w.__calls.filter((x) => x.url.indexOf('/funding-finalize') !== -1)[0];
  return c ? JSON.parse(c.opts.body) : null;
};

test('finalize body carries pay_faster', async () => {
  const w = await ready();
  pickCarrier(w, 'v-net');
  setVal(w, 'carrier-rate', '2000');
  toggle(w, true);
  pickPayer(w, 'broker');
  $(w, 'pf-note').value = 'Needs it by Friday';
  await fillAndSubmit(w);
  await flush();
  const b = finalizeBody(w);
  assert.deepStrictEqual(b.pay_faster, { payer: 'broker', broker_note: 'Needs it by Friday' });
});

test('finalize body has no pay_faster when toggle off or no payer', async () => {
  const w = await ready();
  pickCarrier(w, 'v-net');
  await fillAndSubmit(w);
  await flush();
  assert.ok(finalizeBody(w));
  assert.ok(!('pay_faster' in finalizeBody(w)));
  const w2 = await ready();
  pickCarrier(w2, 'v-net');
  toggle(w2, true);
  await fillAndSubmit(w2);
  await flush();
  assert.ok(finalizeBody(w2));
  assert.ok(!('pay_faster' in finalizeBody(w2)));
});

test('finalize pay_change failure shows message', async () => {
  const w = await ready({ finalize: { ok: true, pay_change: { ok: false, error: 'reserve' } } });
  pickCarrier(w, 'v-net');
  setVal(w, 'carrier-rate', '2000');
  toggle(w, true);
  pickPayer(w, 'carrier');
  await fillAndSubmit(w);
  await flush();
  const t = $(w, 'post-submit-banner').textContent;
  assert.match(t, /Your load was submitted, but the pay change request didn't go through\. Request it from Submission History\./);
});

test('finalize pay_change already_requested is treated as success', async () => {
  const w = await ready({ finalize: { ok: true, pay_change: { ok: false, error: 'already_requested' } } });
  pickCarrier(w, 'v-net');
  setVal(w, 'carrier-rate', '2000');
  toggle(w, true);
  pickPayer(w, 'carrier');
  await fillAndSubmit(w);
  await flush();
  const b = $(w, 'post-submit-banner');
  assert.doesNotMatch(b.textContent, /pay change request didn't go through/);
  assert.match(b.className, /\bok\b/);
});

test('draft finalize with pay faster on says it was not requested', async () => {
  const w = await ready({ finalize: { ok: true, record_id: '4100000000000000001', status: 'Draft' } });
  pickCarrier(w, 'v-net');
  setVal(w, 'carrier-rate', '2000');
  toggle(w, true);
  pickPayer(w, 'carrier');
  w.eval('_uploadDocsSequential = function () { return Promise.resolve(1); };');
  await fillAndSubmit(w);
  await flush();
  const t = $(w, 'post-submit-banner').textContent;
  assert.match(t, /Draft Loads/);
  assert.match(t, /Pay faster wasn't requested\. Re-select it when you resubmit\./);
  assert.doesNotMatch(t, /didn't go through/);
});

test('draft finalize without pay faster has no pay faster line', async () => {
  const w = await ready({ finalize: { ok: true, record_id: '4100000000000000001', status: 'Draft' } });
  pickCarrier(w, 'v-net');
  w.eval('_uploadDocsSequential = function () { return Promise.resolve(1); };');
  await fillAndSubmit(w);
  await flush();
  const t = $(w, 'post-submit-banner').textContent;
  assert.match(t, /Draft Loads/);
  assert.doesNotMatch(t, /Pay faster/);
});

test('impersonating hides the toggle and sends no pay_faster', async () => {
  const w = await ready();
  w.OPERFI_IMP = { target: () => 'client@sample-brokerage.example', isStaff: () => true };
  setVal(w, 'carrier-rate', '2000');
  pickCarrier(w, 'v-net');
  assert.ok(!visible($(w, 'pay-faster')));
  assert.strictEqual(w.payFasterPayload(), null);
  await fillAndSubmit(w);
  await flush();
  assert.ok(finalizeBody(w));
  assert.ok(!('pay_faster' in finalizeBody(w)));
  // No target set (staff not impersonating, or a broker): toggle offered as usual.
  const w2 = await ready();
  w2.OPERFI_IMP = { target: () => '', isStaff: () => false };
  pickCarrier(w2, 'v-net');
  assert.ok(visible($(w2, 'pay-faster')));
});

test('margin caption for broker pays', async () => {
  const w = await ready();
  setVal(w, 'customer-rate', '2500');
  setVal(w, 'carrier-rate', '2000');
  pickCarrier(w, 'v-net');
  toggle(w, true);
  pickPayer(w, 'broker');
  assert.strictEqual($(w, 'sum-margin-note').textContent, '$500.00 load − $40.00 QP fee');
  assert.match($(w, 'sum-margin').textContent, /\$460\.00/);
  pickPayer(w, 'carrier');
  assert.strictEqual($(w, 'sum-margin-note').textContent, '$500.00 load + $40.00 QP share');
});

test('factored wording says factoring company', async () => {
  const w = await ready();
  setVal(w, 'carrier-rate', '2000');
  pickCarrier(w, 'v-fac');
  assert.match($(w, 'pf-toggle-label').textContent, /Pay the factoring company faster/);
  toggle(w, true);
  pickPayer(w, 'carrier');
  assert.match($(w, 'pf-options').textContent, /Example Capital/);
  assert.match($(w, 'pf-options').textContent, /short pay/);
});

test('broker pick refetches context and short reserve resets payer', async () => {
  const w = await ready();
  setVal(w, 'carrier-rate', '2000');
  pickCarrier(w, 'v-net');
  toggle(w, true);
  const count = () => w.__calls.filter((x) => x.url.indexOf('/pay-change/context') !== -1).length;
  assert.strictEqual(count(), 0);
  const orig = w.fetch;
  w.fetch = (u, o) => String(u).indexOf('/pay-change/context') !== -1
    ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(Object.assign({}, CTX, { reserve: { cash: 10, status: 'ok' } })) })
    : orig(u, o);
  pickPayer(w, 'broker');
  await flush();
  assert.strictEqual(w.payFasterPayload(), null);
  assert.strictEqual($(w, 'pf-payer-broker').disabled, true);
});

test('broker pick triggers a context refetch', async () => {
  const w = await ready();
  setVal(w, 'carrier-rate', '2000');
  pickCarrier(w, 'v-net');
  toggle(w, true);
  pickPayer(w, 'broker');
  await flush();
  assert.strictEqual(w.__calls.filter((x) => x.url.indexOf('/pay-change/context') !== -1).length, 1);
});

test('zero or blank rate renders no dollar figures and blocks submit', async () => {
  const w = await ready();
  pickCarrier(w, 'v-net');
  toggle(w, true);
  assert.doesNotMatch($(w, 'pf-options').textContent, /\$/);
  assert.strictEqual(w.payFasterBlocksSubmit(), true);
  assert.strictEqual(w.payFasterPayload(), null);
});

test('untrained broker sees disabled toggle and video link opens help center', async () => {
  const w = await ready({ ctx: Object.assign({}, CTX, { trained: false }) });
  pickCarrier(w, 'v-net');
  assert.strictEqual($(w, 'pf-toggle').disabled, true);
  const a = $(w, 'pf-options').querySelector('a.pf-video-link');
  assert.ok(a);
  a.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.match(w.__opened[0], /help-center\.html/);
});

test('no em or en dashes in new markup', () => {
  const m = HTML.match(/id="pay-faster"[\s\S]*?<!-- \/pay-faster -->/);
  assert.ok(m);
  assert.doesNotMatch(m[0], /[–—]/);
});

test('quickpay carrier margin includes the QP share', async () => {
  const w = await ready();
  setVal(w, 'customer-rate', '2500');
  setVal(w, 'carrier-rate', '2000');
  pickCarrier(w, 'v-qp');
  assert.match($(w, 'sum-margin').textContent, /\$540\.00/);
  assert.strictEqual($(w, 'sum-margin-note').textContent, '$500.00 load + $40.00 QP share');
});

test('quickpay carrier with fee below 2 or missing gets no margin adjustment', async () => {
  for (const pct of [null, '1.5']) {
    const w = await ready({ ctx: Object.assign({}, CTX, { qp_fee_pct: pct }) });
    setVal(w, 'customer-rate', '2500');
    setVal(w, 'carrier-rate', '2000');
    pickCarrier(w, 'v-qp');
    assert.match($(w, 'sum-margin').textContent, /\$500\.00/);
    assert.strictEqual($(w, 'sum-margin-note').textContent, '');
  }
});

test('failed context refetch keeps ctx and marks reserve unavailable', async () => {
  const w = await ready();
  setVal(w, 'carrier-rate', '2000');
  pickCarrier(w, 'v-net');
  toggle(w, true);
  w.fetch = (u) => String(u).indexOf('/pay-change/context') !== -1
    ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
    : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  pickPayer(w, 'broker');
  await flush();
  assert.ok(visible($(w, 'pay-faster')));
  assert.strictEqual(w.payFasterPayload().payer, 'broker');
  assert.match($(w, 'pf-options').textContent, /couldn't check your reserve/);
});

test('a stale context response is ignored', async () => {
  const w = await ready();
  setVal(w, 'carrier-rate', '2000');
  pickCarrier(w, 'v-net');
  let first;
  const mk = (ctx) => ({ ok: true, status: 200, json: () => Promise.resolve(ctx) });
  w.fetch = () => new Promise((res) => { first = () => res(mk(Object.assign({}, CTX, { reserve: { cash: 5, status: 'ok' } }))); });
  const p1 = w.loadPayFasterContext(true);
  w.fetch = () => Promise.resolve(mk(Object.assign({}, CTX, { reserve: { cash: 900, status: 'ok' } })));
  await w.loadPayFasterContext(true);
  first();
  await p1;
  assert.strictEqual(w.eval('_pf.ctx.reserve.cash'), 900);
});

// PAYCHG2: waive the quick pay fee on one load (kind quickpay, waive_enabled).
const WCTX = Object.assign({}, CTX, { waive_enabled: true, fee_pick_enabled: false });

test('waive hidden when waive_enabled false', async () => {
  const w = await ready();
  setVal(w, 'carrier-rate', '2000');
  pickCarrier(w, 'v-qp');
  assert.ok(!visible($(w, 'pay-faster')));
  const w2 = await ready({ ctx: Object.assign({}, CTX, { waive_enabled: false }) });
  pickCarrier(w2, 'v-qp');
  assert.ok(!visible($(w2, 'pay-faster')));
});

test('waive shows and submits payer broker', async () => {
  const w = await ready({ ctx: WCTX });
  pickCarrier(w, 'v-qp');
  setVal(w, 'carrier-rate', '2000');
  assert.ok(visible($(w, 'pay-faster')));
  assert.strictEqual($(w, 'pf-toggle-label').textContent, 'Waive the quick pay fee (this load only)');
  toggle(w, true);
  assert.ok(!$(w, 'pf-payer-broker'));
  assert.match($(w, 'pf-options').textContent, /\$40\.00/);
  await fillAndSubmit(w);
  await flush();
  assert.deepStrictEqual(finalizeBody(w).pay_faster, { payer: 'broker', broker_note: '' });
});

test('waive short reserve blocks submit', async () => {
  const w = await ready({ ctx: Object.assign({}, WCTX, { reserve: { cash: 10, status: 'ok' } }) });
  pickCarrier(w, 'v-qp');
  setVal(w, 'carrier-rate', '2000');
  assert.strictEqual(w.payFasterBlocksSubmit(), false);
  toggle(w, true);
  assert.strictEqual(w.payFasterBlocksSubmit(), true);
  toggle(w, false);
  assert.strictEqual(w.payFasterBlocksSubmit(), false);
});

test('waive summary and margin', async () => {
  const w = await ready({ ctx: WCTX });
  setVal(w, 'customer-rate', '2500');
  setVal(w, 'carrier-rate', '2000');
  pickCarrier(w, 'v-qp');
  assert.match($(w, 'sum-margin').textContent, /\$540\.00/);
  toggle(w, true);
  assert.match($(w, 'sum-pay-faster').textContent, /fee waived/);
  assert.match($(w, 'sum-margin').textContent, /\$460\.00/);
  assert.match($(w, 'sum-margin-note').textContent, /-|−/);
  assert.match($(w, 'sum-margin-note').textContent, /\$40\.00/);
  toggle(w, false);
  assert.match($(w, 'sum-margin').textContent, /\$540\.00/);
  assert.doesNotMatch($(w, 'sum-pay-faster').textContent, /fee waived/);
});

test('waive untrained shows video link and no payload', async () => {
  const w = await ready({ ctx: Object.assign({}, WCTX, { trained: false }) });
  pickCarrier(w, 'v-qp');
  setVal(w, 'carrier-rate', '2000');
  assert.strictEqual($(w, 'pf-toggle').disabled, true);
  assert.ok($(w, 'pf-options').querySelector('a.pf-video-link'));
  assert.strictEqual(w.payFasterPayload(), null);
});

test('waive hidden while impersonating', async () => {
  const w = await ready({ ctx: WCTX });
  w.OPERFI_IMP = { target: () => 'client@sample-brokerage.example', isStaff: () => true };
  pickCarrier(w, 'v-qp');
  assert.ok(!visible($(w, 'pay-faster')));
});

test('FC-QP summary names factor', async () => {
  const w = await ready();
  setVal(w, 'carrier-rate', '2000');
  pickCarrier(w, 'v-fcqp');
  const s = $(w, 'sum-pay-faster').textContent;
  assert.match(s, /Paid to/);
  assert.match(s, /Example Capital/);
});

// PAYCHG3: per-load QP fee picker (fee_pick_enabled).
const PCTX = Object.assign({}, CTX, { waive_enabled: true, fee_pick_enabled: true });
const ctxCalls = (w) => w.__calls.filter((x) => x.url.indexOf('/pay-change/context') !== -1).length;

test('fee picker replaces radios when fee_pick_enabled', async () => {
  for (const vid of ['v-net', 'v-fac']) {
    const w = await ready({ ctx: PCTX });
    setVal(w, 'carrier-rate', '2000');
    pickCarrier(w, vid);
    toggle(w, true);
    assert.ok($(w, 'pf-fee'), vid);
    assert.ok(!$(w, 'pf-payer-carrier'));
    assert.ok(!$(w, 'pf-payer-broker'));
  }
});

test('picker default is saved fee', async () => {
  const w = await ready({ ctx: PCTX });
  setVal(w, 'carrier-rate', '2000');
  pickCarrier(w, 'v-net');
  toggle(w, true);
  assert.strictEqual($(w, 'pf-fee').value, '4');
  assert.strictEqual(w.payFasterBlocksSubmit(), false);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(w.payFasterPayload())), { carrier_fee_pct: '4', broker_note: '' });
});

test('picker default 0 when saved unset', async () => {
  for (const pct of [null, '1.5']) {
    const w = await ready({ ctx: Object.assign({}, PCTX, { qp_fee_pct: pct }) });
    setVal(w, 'carrier-rate', '2000');
    pickCarrier(w, 'v-net');
    toggle(w, true);
    assert.strictEqual($(w, 'pf-fee').value, '0');
    assert.match($(w, 'pf-options').textContent, /Your saved quick pay fee isn't set up\. Contact OperFi\./);
  }
});

test('picker validity', async () => {
  for (const v of ['', 'abc', '5.1', '-1']) {
    const w = await ready({ ctx: PCTX });
    pickCarrier(w, 'v-net');
    setVal(w, 'carrier-rate', '2000');
    toggle(w, true);
    setVal(w, 'pf-fee', v);
    assert.strictEqual(w.payFasterBlocksSubmit(), true, v);
    assert.strictEqual($(w, 'submit-btn').disabled, true, v);
    assert.strictEqual(w.payFasterPayload(), null, v);
    await fillAndSubmit(w);
    await flush();
    const fin = w.__calls.filter((x) => x.url.indexOf('/funding-finalize') !== -1);
    // The button is disabled (asserted above); a direct submitLoad() still finalizes, but never with pay_faster.
    assert.strictEqual(fin.filter((x) => 'pay_faster' in JSON.parse(x.opts.body)).length, 0, v);
  }
});

test('picker 1 sends carrier_fee_pct "1"', async () => {
  const w = await ready({ ctx: PCTX });
  pickCarrier(w, 'v-net');
  setVal(w, 'customer-rate', '2500');
  setVal(w, 'carrier-rate', '2000');
  toggle(w, true);
  const el = $(w, 'pf-fee');
  setVal(w, 'pf-fee', '1');
  assert.strictEqual($(w, 'pf-fee'), el, 'input element is kept while typing');
  assert.match($(w, 'pf-options').textContent, /Carrier pays 1% \(\$20\.00\) · you cover 1% \(\$20\.00\) from reserve · you earn \$0\.00/);
  const s = $(w, 'sum-pay-faster').textContent;
  assert.match(s, /Carrier is charged \(1%\)\$20\.00/);
  assert.match(s, /Charged to your reserve \(1%\)-\$20\.00/);
  assert.match(s, /OperFi earns \(2%\)\$40\.00/);
  assert.match($(w, 'sum-margin').textContent, /\$480\.00/);
  $(w, 'pf-note').value = 'Rush';
  await fillAndSubmit(w);
  await flush();
  assert.deepStrictEqual(finalizeBody(w).pay_faster, { carrier_fee_pct: '1', broker_note: 'Rush' });
});

test('quickpay picker at saved blocks', async () => {
  const w = await ready({ ctx: PCTX });
  setVal(w, 'customer-rate', '2500');
  setVal(w, 'carrier-rate', '2000');
  pickCarrier(w, 'v-qp');
  assert.ok(visible($(w, 'pay-faster')));
  assert.strictEqual($(w, 'pf-toggle-label').textContent, 'Change the quick pay fee (this load only)');
  assert.match($(w, 'sum-margin').textContent, /\$540\.00/);
  toggle(w, true);
  assert.strictEqual($(w, 'pf-fee').value, '4');
  assert.strictEqual(w.payFasterBlocksSubmit(), true);
  assert.strictEqual(w.payFasterPayload(), null);
  setVal(w, 'pf-fee', '3');
  assert.strictEqual(w.payFasterBlocksSubmit(), false);
  assert.match($(w, 'sum-margin').textContent, /\$520\.00/);
  setVal(w, 'pf-fee', '0');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(w.payFasterPayload())), { carrier_fee_pct: '0', broker_note: '' });
  assert.match($(w, 'sum-pay-faster').textContent, /fee waived/);
  assert.match($(w, 'sum-margin').textContent, /\$460\.00/);
});

test('picker refetches the reserve once when it first charges the reserve', async () => {
  const w = await ready({ ctx: PCTX });
  setVal(w, 'carrier-rate', '2000');
  pickCarrier(w, 'v-net');
  toggle(w, true);
  assert.strictEqual(ctxCalls(w), 0);
  const orig = w.fetch;
  w.fetch = (u, o) => String(u).indexOf('/pay-change/context') !== -1
    ? (w.__calls.push({ url: String(u), opts: {} }), Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(Object.assign({}, PCTX, { reserve: { cash: 10, status: 'ok' } })) }))
    : orig(u, o);
  setVal(w, 'pf-fee', '1');
  await flush();
  assert.strictEqual(ctxCalls(w), 1);
  assert.strictEqual(w.payFasterBlocksSubmit(), true);
  assert.match($(w, 'pf-options').textContent, /doesn't cover/);
  setVal(w, 'pf-fee', '0.5');
  await flush();
  assert.strictEqual(ctxCalls(w), 1);
});

test('picker carrier switch resets the fee', async () => {
  const w = await ready({ ctx: PCTX });
  setVal(w, 'carrier-rate', '2000');
  pickCarrier(w, 'v-net');
  toggle(w, true);
  setVal(w, 'pf-fee', '1');
  pickCarrier(w, 'v-fac');
  assert.strictEqual(w.payFasterPayload(), null);
  toggle(w, true);
  assert.strictEqual($(w, 'pf-fee').value, '4');
});

test('flag off keeps PAYCHG1 radios', async () => {
  const w = await ready({ ctx: Object.assign({}, PCTX, { fee_pick_enabled: false }) });
  setVal(w, 'carrier-rate', '2000');
  pickCarrier(w, 'v-net');
  toggle(w, true);
  assert.ok($(w, 'pf-payer-carrier'));
  assert.ok(!$(w, 'pf-fee'));
  pickCarrier(w, 'v-qp');
  assert.strictEqual($(w, 'pf-toggle-label').textContent, 'Waive the quick pay fee (this load only)');
});
