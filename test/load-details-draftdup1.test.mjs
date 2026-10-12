// DRAFTDUP1: a draft reopened in Load Details.
//
// United Front Logistics, 2026-10-05: a carrier's invoice-request upload landed
// as a draft holding only the carrier side. Reopened here, the form opened on
// step 1 (blank) and would not let the broker look at step 2, and Submit created
// a NEW funding record, so the load existed twice.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function makeDom(fetchImpl) {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.fetch = fetchImpl || (() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  w.ZOHO = { CREATOR: { UTIL: { getInitParams: () => ({ loginUser: 'b@x.com' }) },
                        init: () => Promise.resolve() } };
  w.OperFiAV = { carrierBadge: () => {}, customerCredit: () => {} };
  w.brokerEmail = 'b@x.com';
  return w;
}
function opt(w, id, value) {
  const sel = w.document.getElementById(id);
  const o = w.document.createElement('option');
  o.value = value; o.textContent = value; sel.appendChild(o);
}
function _doc(w, name) {
  return { name, ext: 'pdf', blob: new w.Blob(['x']), error: null };
}
const active = (w) => w.document.querySelector('.step-card.active').id;

// The invoice-request draft: carrier + its invoice on file, customer side empty.
function carrierOnlyDraft(w) {
  opt(w, 'carrier-select', 'v3');
  w.prefillFromDraft({ id: '4001', carrier_id: 'v3', carrier_factoring_invoice: 'INV-9',
    has_carrier_docs: true, has_customer_docs: false, source: 'Invoice Request' });
}

// ── free movement between steps 1 and 2 ─────────────────────────────────────

test('the carrier step can be opened while the customer step is blank', () => {
  const w = makeDom();
  assert.strictEqual(w.canGoTo('carrier'), true);
  w.goToStep('carrier');
  assert.strictEqual(active(w), 'card-carrier');
});

test('review is still locked until both steps are complete', () => {
  const w = makeDom();
  carrierOnlyDraft(w);
  assert.strictEqual(w.canGoTo('review'), false);
  w.goToStep('review');
  assert.notStrictEqual(active(w), 'card-review');
});

// ── where a reopened draft lands ────────────────────────────────────────────

test('a carrier-only draft opens on the carrier step', () => {
  const w = makeDom();
  carrierOnlyDraft(w);
  assert.strictEqual(active(w), 'card-carrier');
});

test('a draft with customer data and an incomplete customer step opens on the customer step', () => {
  const w = makeDom();
  w.prefillFromDraft({ id: '4002', customer_reference_number: 'PO-1' });
  assert.strictEqual(active(w), 'card-customer');
});

test('a draft whose customer step is complete opens on the carrier step', () => {
  const w = makeDom();
  opt(w, 'customer-select', 'c9');
  w.prefillFromDraft({ id: '4003', customer_id: 'c9', customer_reference_number: 'PO-1',
    customer_rate: '2500', has_customer_docs: true });
  assert.strictEqual(active(w), 'card-carrier');
});

// ── step status labels + the draft summary line ─────────────────────────────

test('each step label says what it still needs', () => {
  const w = makeDom();
  carrierOnlyDraft(w);
  const cust = w.document.getElementById('step-customer-sub').textContent;
  const carr = w.document.getElementById('step-carrier-sub').textContent;
  assert.match(cust, /customer/i);
  assert.match(cust, /docs/i);
  assert.match(carr, /rate/i);              // carrier rate still blank
  assert.doesNotMatch(carr, /docs/i);       // the carrier's invoice is on file
  assert.doesNotMatch(carr, /invoice/i);    // invoice # came with the draft
});

test('a complete step reads Complete', () => {
  const w = makeDom();
  carrierOnlyDraft(w);
  w.setField('carrier-rate', '2100');
  w.setField('rate-con', 'RC-7');
  w.refreshValidity();
  assert.match(w.document.getElementById('step-carrier-sub').textContent, /complete/i);
});

test('a reopened draft shows a summary line with a jump to the step that needs work', () => {
  const w = makeDom();
  carrierOnlyDraft(w);
  const s = w.document.getElementById('draft-summary');
  assert.ok(s && !s.hidden, 'summary visible for a reopened draft');
  assert.match(s.textContent, /carrier invoice is on file/i);
  const jump = s.querySelector('[data-goto="customer"]');
  assert.ok(jump, 'jump link to the customer step');
  jump.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(active(w), 'card-customer');
});

test('a new load shows no draft summary', () => {
  const w = makeDom();
  w.refreshValidity();
  assert.ok(w.document.getElementById('draft-summary').hidden);
});

// ── submit sends draft_id so the draft is submitted in place ─────────────────

function submitDom(seen) {
  const w = makeDom((url, opts) => {
    seen.push({ url: String(url), opts: opts || {} });
    if (String(url).includes('/funding-submit'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, record_id: '4001', from_draft: true }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, code: 3000 }) });
  });
  w._collectFields = () => ({ customer_id: 'c9' });
  w._mergedPdfs = () => Promise.resolve({ customer: new w.Blob(['x']), carrier: null });
  return w;
}

test('submitting a reopened draft sends its draft_id', async () => {
  const seen = [];
  const w = submitDom(seen);
  carrierOnlyDraft(w);
  await w.submitLoad();
  const body = JSON.parse(seen.find(s => s.url.includes('/funding-submit')).opts.body);
  assert.strictEqual(body.draft_id, '4001');
  // Only the freshly picked customer packet is uploaded; the carrier's invoice stays.
  const ups = seen.filter(s => s.url.includes('/upload-doc'));
  assert.strictEqual(ups.length, 1);
});

test('a new load sends no draft_id', async () => {
  const seen = [];
  const w = submitDom(seen);
  await w.submitLoad();
  const body = JSON.parse(seen.find(s => s.url.includes('/funding-submit')).opts.body);
  assert.ok(!('draft_id' in body));
});

test('after a draft is submitted the form forgets it, so the next load is new', async () => {
  const seen = [];
  const w = submitDom(seen);
  carrierOnlyDraft(w);
  await w.submitLoad();
  assert.ok(w.document.getElementById('draft-summary').hidden);
  seen.length = 0;
  await w.submitLoad();
  const body = JSON.parse(seen.find(s => s.url.includes('/funding-submit')).opts.body);
  assert.ok(!('draft_id' in body));
});
