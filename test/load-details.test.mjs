import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('includes operfi-impersonate.js', () => {
  assert.match(HTML, /operfi-impersonate\.js/);
});

test('targets the Render backend, not PythonAnywhere or the SDK getRecords', () => {
  assert.match(HTML, /operfi-broker-api\.onrender\.com/);
  assert.doesNotMatch(HTML, /pythonanywhere/i);
  assert.doesNotMatch(HTML, /CREATOR\.DATA\.getRecords/);
});

test('has the three stepper sections and a sticky summary rail', () => {
  const dom = new JSDOM(HTML);
  const d = dom.window.document;
  assert.ok(d.querySelector('[data-step="customer"]'));
  assert.ok(d.querySelector('[data-step="carrier"]'));
  assert.ok(d.querySelector('[data-step="review"]'));
  assert.ok(d.querySelector('#summary-rail'));
  assert.ok(d.querySelector('#submit-btn'));
});

test('preserves the client-side file-merge pipeline includes', () => {
  assert.match(HTML, /pdf-lib/);
  assert.match(HTML, /heic2any/);
  assert.match(HTML, /mammoth/);
  assert.match(HTML, /UTIF/i);
});

test('no test-only UI remains', () => {
  assert.doesNotMatch(HTML, /Fill Test Data/i);
  assert.doesNotMatch(HTML, /JS NOT RUNNING/i);
});

test('exposes the DOM controls later tasks will target', () => {
  const d = new JSDOM(HTML).window.document;
  ['customer-select','customer-reference','customer-rate','customer-error',
   'carrier-select','carrier-rate','carrier-factoring-invoice','rate-con',
   'carrier-error','credit-banner','submit-status'].forEach(function (id) {
    assert.ok(d.getElementById(id), 'missing #' + id);
  });
});

// ── B2: Render-backed customer/carrier loads ──────────────────────────────────

function makeB2Dom(fetchImpl, { avStubs } = {}) {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  // Stub ZOHO so the inline load handler doesn't throw; getInitParams returns
  // synchronously so resolveEmail() calls onReady() immediately on load — but
  // by the time we set fetch below the window.load listener hasn't fired yet
  // (JSDOM defers it). We set fetch before anything runs.
  w.fetch = fetchImpl;
  w.ZOHO = {
    CREATOR: {
      UTIL: { getInitParams: () => ({ loginUser: 'b@x.com' }) },
      init: () => Promise.resolve()
    }
  };
  // Stub OperFiAV so loadCredit / onCarrierChange don't throw.
  // Callers can pass avStubs to inject spies.
  w.OperFiAV = Object.assign(
    { carrierBadge: () => {}, customerCredit: () => {} },
    avStubs || {}
  );
  // Set brokerEmail directly so we can call loadCustomers/loadCarriers
  // without relying on the auto-boot path
  w.brokerEmail = 'b@x.com';
  return dom;
}

test('loadCustomers fetches /tms-customers and keeps only approved', async () => {
  const dom = makeB2Dom((url) => {
    if (String(url).includes('/tms-customers')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({
        customers: [
          { customer_id: 'c9', customer_name: 'ACME', credit_decision: 'Approved' },
          { customer_id: 'c8', customer_name: 'BETA', credit_decision: 'Declined' }
        ]
      })});
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ carriers: [] }) });
  });
  const w = dom.window;
  await w.loadCustomers();
  const opts = [...w.document.querySelectorAll('#customer-select option')].map(o => o.textContent);
  assert.ok(opts.some(t => /ACME/.test(t)), 'ACME (Approved) should be present');
  assert.ok(!opts.some(t => /BETA/.test(t)), 'BETA (Declined) should be filtered out');
});

test('failed customer load shows inline error with retry, not silent empty', async () => {
  const dom = makeB2Dom(() =>
    Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) })
  );
  const w = dom.window;
  await w.loadCustomers();
  assert.match(w.document.querySelector('#customer-error').textContent, /unable|retry|try again/i);
});

test('loadCarriers populates carrier select and stores rows for terms lookup', async () => {
  const dom = makeB2Dom((url) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(
      String(url).includes('/tms-carriers')
        ? { carriers: [{ vendor_id: 'v3', carrier_name: 'Hauler', payment_terms: 'Quickpay 2%' }] }
        : { customers: [] }
    )})
  );
  const w = dom.window;
  await w.loadCarriers();
  const opts = [...w.document.querySelectorAll('#carrier-select option')].map(o => o.textContent);
  assert.ok(opts.some(t => /Hauler/.test(t)), 'Hauler should appear in carrier select');
  assert.ok(Array.isArray(w._carriers), '_carriers array should be stored');
  assert.ok(w._carriers.some(c => c.vendor_id === 'v3'), 'v3 should be in _carriers');
});

test('selecting a carrier shows its payment terms (no extra fetch)', async () => {
  let fetchCount = 0;
  const dom = makeB2Dom((url) => {
    fetchCount++;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(
      String(url).includes('/tms-carriers')
        ? { carriers: [{ vendor_id: 'v3', carrier_name: 'Hauler', payment_terms: 'Quickpay 2%' }] }
        : { customers: [] }
    )});
  });
  const w = dom.window;
  await w.loadCarriers();
  const beforeCount = fetchCount;
  const sel = w.document.getElementById('carrier-select');
  sel.value = 'v3';
  sel.dispatchEvent(new w.Event('change'));
  assert.strictEqual(fetchCount, beforeCount, 'no extra fetch on carrier selection');
  assert.match(w.document.getElementById('terms-readout-value').textContent, /Quickpay 2%/);
});

test('customer names with & are HTML-escaped (no markup breakage)', async () => {
  const dom = makeB2Dom((url) => {
    if (String(url).includes('/tms-customers')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({
        customers: [{ customer_id: 'c1', customer_name: 'J&B Trucking', credit_decision: 'Approved' }]
      })});
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ carriers: [] }) });
  });
  const w = dom.window;
  await w.loadCustomers();
  const opt = w.document.querySelector('#customer-select option[value="c1"]');
  assert.ok(opt, 'option present');
  assert.strictEqual(opt.textContent, 'J&B Trucking');
});

// ── B3: credit banner + live margin badge ─────────────────────────────────────

test('loadCredit delegates to OperFiAV.customerCredit with the customer id', async () => {
  const calls = [];
  const dom = makeB2Dom(
    () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    { avStubs: { customerCredit: (el, opts) => calls.push(opts) } }
  );
  const w = dom.window;
  await w.loadCredit('c9');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].customerId, 'c9');
  assert.strictEqual(calls[0].email, 'b@x.com');
});

test('loadCredit delegates to OperFiAV.customerCredit even when customerId is empty', async () => {
  const calls = [];
  const dom = makeB2Dom(
    () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    { avStubs: { customerCredit: (el, opts) => calls.push(opts) } }
  );
  const w = dom.window;
  await w.loadCredit('');
  assert.strictEqual(calls.length, 1, 'customerCredit still called (component handles empty id)');
  assert.strictEqual(calls[0].customerId, '');
});

test('loadCredit adds .show to #credit-banner so it becomes visible', async () => {
  const dom = makeB2Dom(
    () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    { avStubs: { customerCredit: () => {} } }
  );
  const w = dom.window;
  const banner = w.document.getElementById('credit-banner');
  assert.ok(banner, '#credit-banner must exist');
  assert.ok(!banner.classList.contains('show'), 'banner should start without .show');
  await w.loadCredit('c9');
  assert.ok(banner.classList.contains('show'), 'banner must have .show after loadCredit');
});

test('margin badge computes customer minus carrier rate, $ and %', () => {
  const dom = makeB2Dom(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  const w = dom.window;
  const m = w.computeMargin(2500, 2100);
  assert.strictEqual(m.dollars, 400);
  assert.strictEqual(m.percent, 16);
});

test('computeMargin handles zero/blank customer rate without NaN', () => {
  const dom = makeB2Dom(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  const w = dom.window;
  const m = w.computeMargin('', '100');
  assert.strictEqual(m.dollars, -100);
  assert.strictEqual(m.percent, 0);
});

test('loadCredit returns a Promise (callers can await it)', async () => {
  const dom = makeB2Dom(
    () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  );
  const w = dom.window;
  const result = w.loadCredit('c9');
  assert.ok(result && typeof result.then === 'function', 'loadCredit must return a Promise');
  await result; // should not throw
});

// ── AV1: OperFiAV component wiring ───────────────────────────────────────────

test('includes operfi-av.js script tag', () => {
  assert.match(HTML, /operfi-av\.js/);
});

test('carrier section has #carrier-av container in markup', () => {
  const d = new JSDOM(HTML).window.document;
  assert.ok(d.getElementById('carrier-av'), 'missing #carrier-av');
});

test('selecting a carrier calls OperFiAV.carrierBadge with the vendor id', async () => {
  const badgeCalls = [];
  const dom = makeB2Dom(
    (url) => Promise.resolve({ ok: true, json: () => Promise.resolve(
      String(url).includes('/tms-carriers')
        ? { carriers: [{ vendor_id: 'v3', carrier_name: 'Hauler', payment_terms: 'Quickpay 2%' }] }
        : { customers: [] }
    )}),
    { avStubs: { carrierBadge: (el, opts) => badgeCalls.push(opts) } }
  );
  const w = dom.window;
  await w.loadCarriers();
  const sel = w.document.getElementById('carrier-select');
  sel.value = 'v3';
  sel.dispatchEvent(new w.Event('change'));
  assert.strictEqual(badgeCalls.length, 1, 'carrierBadge should be called on carrier change');
  assert.strictEqual(badgeCalls[0].vendorId, 'v3');
  assert.strictEqual(badgeCalls[0].email, 'b@x.com');
});

test('deselecting carrier calls OperFiAV.carrierBadge with empty vendor id', async () => {
  const badgeCalls = [];
  const dom = makeB2Dom(
    (url) => Promise.resolve({ ok: true, json: () => Promise.resolve(
      String(url).includes('/tms-carriers')
        ? { carriers: [{ vendor_id: 'v3', carrier_name: 'Hauler', payment_terms: 'Quickpay 2%' }] }
        : { customers: [] }
    )}),
    { avStubs: { carrierBadge: (el, opts) => badgeCalls.push(opts) } }
  );
  const w = dom.window;
  await w.loadCarriers();
  const sel = w.document.getElementById('carrier-select');
  sel.value = '';
  sel.dispatchEvent(new w.Event('change'));
  assert.strictEqual(badgeCalls.length, 1);
  assert.strictEqual(badgeCalls[0].vendorId, '');
});

// ── B4: Stepper gating + submit-enable logic ──────────────────────────────────

test('submit stays disabled until all required fields valid', () => {
  const dom = makeB2Dom(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  const w = dom.window, d = w.document;
  assert.strictEqual(d.querySelector('#submit-btn').disabled, true);
  w.setField('customer-select', 'c9');
  w.setField('customer-reference', 'PO-1');
  w.setField('customer-rate', '2500');
  w.setField('carrier-select', 'v3');
  w.setField('carrier-rate', '2100');
  w.setField('carrier-factoring-invoice', 'F1');
  w.setField('rate-con', 'RC-7');
  w.refreshValidity();
  assert.strictEqual(d.querySelector('#submit-btn').disabled, false);
});

test('submit re-disables if a required field is cleared', () => {
  const dom = makeB2Dom(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  const w = dom.window, d = w.document;
  ['customer-select','customer-reference','customer-rate','carrier-select','carrier-rate','carrier-factoring-invoice','rate-con']
    .forEach(function (id, i) { w.setField(id, id.indexOf('rate')>-1 ? '100' : 'x'); });
  w.refreshValidity();
  assert.strictEqual(d.querySelector('#submit-btn').disabled, false);
  w.setField('carrier-rate', '');
  w.refreshValidity();
  assert.strictEqual(d.querySelector('#submit-btn').disabled, true);
});

test('cannot reach review step until customer+carrier valid', () => {
  const dom = makeB2Dom(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  const w = dom.window;
  assert.strictEqual(w.canGoTo('review'), false);
  w.setField('customer-select', 'c9');
  w.setField('customer-reference', 'PO-1');
  w.setField('customer-rate', '2500');
  assert.strictEqual(w.canGoTo('carrier'), true);
  assert.strictEqual(w.canGoTo('review'), false);
  w.setField('carrier-select', 'v3');
  w.setField('carrier-rate', '2100');
  w.setField('carrier-factoring-invoice', 'F1');
  w.setField('rate-con', 'RC-7');
  assert.strictEqual(w.canGoTo('review'), true);
});

test('completed step is clickable to go back', () => {
  const dom = makeB2Dom(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  const w = dom.window, d = w.document;
  w.setField('customer-select', 'c9');
  w.setField('customer-reference', 'PO-1');
  w.setField('customer-rate', '2500');
  w.goToStep('carrier');
  assert.strictEqual(w.canGoTo('customer'), true); // back to a completed step always allowed
});

// ── B5: Submit via /funding-submit + /upload-doc ──────────────────────────────

test('submit posts /funding-submit with the raw field payload then uploads both PDFs', async () => {
  const seen = [];
  const dom = makeB2Dom((url, opts) => { seen.push({ url: String(url), opts });
    if (String(url).includes('/funding-submit'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, record_id: 'rec_500', warnings: [] }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 3000 }) });
  });
  const w = dom.window;
  w._collectFields = () => ({ customer_id: 'c9', customer_reference_number: 'PO-1',
    customer_rate: '2500', carrier_id: 'v3', carrier_rate: '2100',
    carrier_factoring_invoice: 'F1', load_rate_confirmation_number: 'RC-7' });
  w._mergedPdfs = () => Promise.resolve({ customer: new w.Blob(['x'], {type:'application/pdf'}),
                                          carrier: new w.Blob(['y'], {type:'application/pdf'}) });
  await w.submitLoad();
  const sub = seen.find(s => s.url.includes('/funding-submit'));
  const body = JSON.parse(sub.opts.body);
  assert.strictEqual(body.customer_id, 'c9');
  assert.strictEqual(body.email, 'b@x.com');
  assert.strictEqual(seen.filter(s => s.url.includes('/upload-doc')).length, 2);
});

test('submit failure keeps the form and surfaces an error (no record id)', async () => {
  const dom = makeB2Dom(() => Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ error: 'x' }) }));
  const w = dom.window;
  w._collectFields = () => ({ customer_id: 'c9' });
  w._mergedPdfs = () => Promise.resolve({ customer: null, carrier: null });
  await w.submitLoad();
  assert.match(w.document.getElementById('submit-status').textContent, /error|failed|try again/i);
});

test('record created but an upload fails surfaces a non-lost-work message with the record id', async () => {
  const dom = makeB2Dom((url) => {
    if (String(url).includes('/funding-submit'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, record_id: 'rec_777', warnings: [] }) });
    return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }); // upload fails
  });
  const w = dom.window;
  w._collectFields = () => ({ customer_id: 'c9' });
  w._mergedPdfs = () => Promise.resolve({ customer: new w.Blob(['x']), carrier: null });
  await w.submitLoad();
  const t = w.document.getElementById('submit-status').textContent;
  assert.match(t, /rec_777/);
  assert.match(t, /upload/i);
});

test('submit is blocked from firing twice concurrently', async () => {
  let submitCalls = 0;
  const dom = makeB2Dom((url) => {
    if (String(url).includes('/funding-submit')) { submitCalls++;
      return new Promise(res => setTimeout(() => res({ ok: true, json: () => Promise.resolve({ ok:true, record_id:'r1', warnings:[] }) }), 5)); }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 3000 }) });
  });
  const w = dom.window;
  w._collectFields = () => ({ customer_id: 'c9' });
  w._mergedPdfs = () => Promise.resolve({ customer: null, carrier: null });
  await Promise.all([w.submitLoad(), w.submitLoad()]);
  assert.strictEqual(submitCalls, 1);
});

// ── Task 22: Save-as-Draft manual feeder + draft reopen ───────────────────────

test('there is a Save as Draft button next to Submit', () => {
  const d = new JSDOM(HTML).window.document;
  assert.ok(d.getElementById('save-draft-btn'), 'missing #save-draft-btn');
});

test('saveDraft POSTs /draft-loads with source Manual and the collected fields, even when incomplete', async () => {
  const seen = [];
  const dom = makeB2Dom((url, opts) => { seen.push({ url: String(url), opts });
    if (String(url).includes('/draft-loads'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ record_id: '950' }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  const w = dom.window;
  // only a couple of fields filled — drafts are lenient
  w._collectFields = () => ({ customer_id: 'c9', customer_reference_number: 'PO-7' });
  await w.saveDraft();
  const draft = seen.find(s => s.url.includes('/draft-loads'));
  assert.ok(draft, '/draft-loads was called');
  assert.strictEqual(draft.opts.method, 'POST');
  const body = JSON.parse(draft.opts.body);
  assert.strictEqual(body.source, 'Manual');
  assert.strictEqual(body.email, 'b@x.com');
  assert.strictEqual(body.source_load_ref, 'PO-7');
  assert.strictEqual(body.customer_id, 'c9');
  assert.deepStrictEqual(body.source_payload, { customer_id: 'c9', customer_reference_number: 'PO-7' });
});

function makeStorageDom() {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://tcroteau01-commits.github.io/index.html'
  });
  const w = dom.window;
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  w.ZOHO = { CREATOR: { UTIL: { getInitParams: () => ({ loginUser: 'b@x.com' }) }, init: () => Promise.resolve() } };
  w.OperFiAV = { carrierBadge: () => {}, customerCredit: () => {} };
  return dom;
}

test('_resolveDraftId reads sessionStorage.draftId (Edit handoff) and clears it', () => {
  const w = makeStorageDom().window;
  w.sessionStorage.setItem('draftId', '777');
  const id = w._resolveDraftId({});
  assert.strictEqual(id, '777');
  assert.strictEqual(w.sessionStorage.getItem('draftId'), null, 'draftId cleared after read');
});

test('_resolveDraftId still prefers an explicit param over sessionStorage', () => {
  const w = makeStorageDom().window;
  w.sessionStorage.setItem('draftId', '777');
  assert.strictEqual(w._resolveDraftId({ draftId: '900' }), '900');
});

test('reopening a draft whose customer is not approved shows a clear warning (no silent blank)', () => {
  const w = makeStorageDom().window;
  const sel = w.document.getElementById('customer-select');
  sel.innerHTML = '<option value="">Select…</option><option value="c1">APPROVED CO</option>';
  w.prefillFromDraft({ id: 'd1', customer_id: 'cX', customer_name: 'ABC Shipping' });
  const warn = w.document.getElementById('draft-customer-warning');
  assert.ok(warn, 'warning element exists');
  assert.notStrictEqual(warn.style.display, 'none', 'warning visible');
  assert.match(warn.textContent, /ABC Shipping/);
});

test('reopening a draft whose customer IS approved keeps the warning hidden', () => {
  const w = makeStorageDom().window;
  const sel = w.document.getElementById('customer-select');
  sel.innerHTML = '<option value="">Select…</option><option value="c1">APPROVED CO</option>';
  w.prefillFromDraft({ id: 'd1', customer_id: 'c1', customer_name: 'APPROVED CO' });
  const warn = w.document.getElementById('draft-customer-warning');
  assert.strictEqual(warn.style.display, 'none');
  assert.strictEqual(sel.value, 'c1');
});

test('a second saveDraft PATCHes the stored record id instead of POSTing again', async () => {
  const seen = [];
  const dom = makeB2Dom((url, opts) => { seen.push({ url: String(url), opts: opts || {} });
    if (String(url).includes('/draft-loads'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ record_id: '950', status: 'draft', reasons: [] }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  const w = dom.window;
  w._collectFields = () => ({ customer_id: 'c9' });
  await w.saveDraft();
  await w.saveDraft();
  const calls = seen.filter(s => s.url.includes('/draft-loads'));
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].opts.method, 'POST');
  assert.strictEqual(calls[1].opts.method, 'PATCH');
  assert.match(calls[1].url, /\/draft-loads\/950/);
});

test('saveDraft failure surfaces a visible message (no silent success)', async () => {
  const dom = makeB2Dom(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }));
  const w = dom.window;
  w._collectFields = () => ({ customer_id: 'c9' });
  await w.saveDraft();
  assert.match(w.document.getElementById('submit-status').textContent, /fail|error|try again/i);
});

test('prefillFromDraft populates the form inputs from a draft object', () => {
  const dom = makeB2Dom(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  const w = dom.window, d = w.document;
  w.prefillFromDraft({
    id: '950',
    customer_id: 'c9',
    customer_reference_number: 'PO-7',
    customer_rate: '2500',
    carrier_id: 'v3',
    carrier_rate: '2100',
    carrier_factoring_invoice: 'F1',
    load_rate_confirmation_number: 'RC-7',
    source_payload: { load_comments: 'rush load' }
  });
  assert.strictEqual(d.getElementById('customer-reference').value, 'PO-7');
  assert.strictEqual(d.getElementById('customer-rate').value, '2500');
  assert.strictEqual(d.getElementById('carrier-factoring-invoice').value, 'F1');
  assert.strictEqual(d.getElementById('rate-con').value, 'RC-7');
  assert.strictEqual(d.getElementById('Load_Comments').value, 'rush load');
});

test('prefillFromDraft sets currentDraftId so a later saveDraft PATCHes that draft', async () => {
  const seen = [];
  const dom = makeB2Dom((url, opts) => { seen.push({ url: String(url), opts: opts || {} });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'draft', reasons: [] }) });
  });
  const w = dom.window;
  w.prefillFromDraft({ id: '321', customer_id: 'c9' });
  w._collectFields = () => ({ customer_id: 'c9' });
  await w.saveDraft();
  const call = seen.find(s => s.url.includes('/draft-loads'));
  assert.strictEqual(call.opts.method, 'PATCH');
  assert.match(call.url, /\/draft-loads\/321/);
});
