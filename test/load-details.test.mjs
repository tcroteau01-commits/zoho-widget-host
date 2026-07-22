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

test('loadCustomers fetches /tms-customers and keeps only fundable customers', async () => {
  const dom = makeB2Dom((url) => {
    if (String(url).includes('/tms-customers')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({
        customers: [
          { customer_id: 'c9', customer_name: 'ACME', credit_decision: 'Approved' },
          { customer_id: 'c7', customer_name: 'GAMMA', credit_decision: 'Credit Boost Requested' },
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
  // A boost customer is already approved with a limit and is only asking for more,
  // so it stays selectable and funds against its existing limit.
  assert.ok(opts.some(t => /GAMMA/.test(t)), 'GAMMA (Credit Boost Requested) should be present');
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

test('carrier options show a status suffix and are disabled for non-approved/DNU carriers', async () => {
  const dom = makeB2Dom((url) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(
      String(url).includes('/tms-carriers')
        ? { carriers: [
            { vendor_id: 'v1', carrier_name: 'Good Carrier', mc: '111', hiring_decision: 'Approve', dnu: false },
            { vendor_id: 'v2', carrier_name: 'Unreviewed Carrier', mc: '222', hiring_decision: 'Not Reviewed', dnu: false },
            { vendor_id: 'v3', carrier_name: 'Blocked Carrier', mc: '333', hiring_decision: 'Approve', dnu: true }
          ] }
        : { customers: [] }
    )})
  );
  const w = dom.window;
  await w.loadCarriers();
  const opts = [...w.document.querySelectorAll('#carrier-select option')];
  const v1 = opts.find(o => o.value === 'v1');
  const v2 = opts.find(o => o.value === 'v2');
  const v3 = opts.find(o => o.value === 'v3');
  assert.strictEqual(v1.disabled, false, 'approved carrier should not be disabled');
  assert.strictEqual(v2.disabled, true, 'unreviewed carrier should be disabled');
  assert.match(v2.textContent, /Not Reviewed/);
  assert.strictEqual(v3.disabled, true, 'DNU carrier should be disabled');
  assert.match(v3.textContent, /DNU/);
});

test('carrier combobox results show the same status suffix and a blocked class', () => {
  const dom = makeB2Dom(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ carriers: [] }) }));
  const w = dom.window;
  w._carriers = [
    { vendor_id: 'v1', carrier_name: 'Good Carrier', mc: '111', hiring_decision: 'Approve', dnu: false },
    { vendor_id: 'v2', carrier_name: 'Unreviewed Carrier', mc: '222', hiring_decision: 'Not Reviewed', dnu: false },
    { vendor_id: 'v3', carrier_name: 'Blocked Carrier', mc: '333', hiring_decision: 'Approve', dnu: true }
  ];
  w.renderCarrierResults('');
  const list = w.document.getElementById('carrier-list');
  const v1Row = list.querySelector('.combo-opt[data-vid="v1"]');
  const v2Row = list.querySelector('.combo-opt[data-vid="v2"]');
  const v3Row = list.querySelector('.combo-opt[data-vid="v3"]');
  assert.match(v2Row.textContent, /Not Reviewed/);
  assert.match(v3Row.textContent, /DNU/);
  assert.ok(v2Row.classList.contains('combo-blocked'), 'unreviewed row should carry a blocked class');
  assert.ok(v3Row.classList.contains('combo-blocked'), 'DNU row should carry a blocked class');
  assert.ok(!v1Row.classList.contains('combo-blocked'), 'approved row should not carry a blocked class');
});

test('carrier options are never disabled when the account gate is switched off', async () => {
  const dom = makeB2Dom((url) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(
      String(url).includes('/tms-carriers')
        ? { gate_enabled: false, carriers: [
            { vendor_id: 'v2', carrier_name: 'Unreviewed Carrier', mc: '222', hiring_decision: 'Not Reviewed', dnu: false },
            { vendor_id: 'v3', carrier_name: 'DNU Carrier', mc: '333', hiring_decision: 'Approve', dnu: true }
          ] }
        : { customers: [] }
    )})
  );
  const w = dom.window;
  await w.loadCarriers();
  const opts = [...w.document.querySelectorAll('#carrier-select option')];
  const v2 = opts.find(o => o.value === 'v2');
  const v3 = opts.find(o => o.value === 'v3');
  assert.strictEqual(v2.disabled, false, 'unreviewed carrier should not be disabled when the gate is off');
  assert.strictEqual(v3.disabled, false, 'DNU carrier should not be disabled when the gate is off');
});

test('mousedown on a blocked combobox row does not select the carrier', async () => {
  const dom = makeB2Dom((url) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(
      String(url).includes('/tms-carriers')
        ? { carriers: [
            { vendor_id: 'v1', carrier_name: 'Good Carrier', mc: '111', hiring_decision: 'Approve', dnu: false },
            { vendor_id: 'v3', carrier_name: 'Blocked Carrier', mc: '333', hiring_decision: 'Approve', dnu: true }
          ] }
        : { customers: [] }
    )})
  );
  const w = dom.window;
  // The mousedown handler is wired up inside the window 'load' listener (unlike
  // loadCarriers' own inline change listener), so wait for it before dispatching.
  await new Promise((resolve) => w.addEventListener('load', resolve, { once: true }));
  await w.loadCarriers();
  w.renderCarrierResults('');
  const list = w.document.getElementById('carrier-list');
  const sel = w.document.getElementById('carrier-select');
  const v3Row = list.querySelector('.combo-opt[data-vid="v3"]');
  v3Row.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }));
  assert.strictEqual(sel.value, '', 'blocked carrier should not be selected');

  const v1Row = list.querySelector('.combo-opt[data-vid="v1"]');
  v1Row.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }));
  assert.strictEqual(sel.value, 'v1', 'non-blocked carrier should still be selectable');
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

test('submit stays disabled until all required fields AND documents are present', () => {
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
  assert.strictEqual(d.querySelector('#submit-btn').disabled, true, 'fields complete but no docs -> still blocked');
  w.fileStore = { cust_docs: [_doc(w, 'bol.pdf')], carrier_docs: [_doc(w, 'rc.pdf')] };
  w.refreshValidity();
  assert.strictEqual(d.querySelector('#submit-btn').disabled, false, 'fields + both required docs -> enabled');
});

test('submit re-disables if a required field is cleared', () => {
  const dom = makeB2Dom(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  const w = dom.window, d = w.document;
  ['customer-select','customer-reference','customer-rate','carrier-select','carrier-rate','carrier-factoring-invoice','rate-con']
    .forEach(function (id, i) { w.setField(id, id.indexOf('rate')>-1 ? '100' : 'x'); });
  w.fileStore = { cust_docs: [_doc(w, 'a.pdf')], carrier_docs: [_doc(w, 'b.pdf')] };
  w.refreshValidity();
  assert.strictEqual(d.querySelector('#submit-btn').disabled, false);
  w.setField('carrier-rate', '');
  w.refreshValidity();
  assert.strictEqual(d.querySelector('#submit-btn').disabled, true);
});

test('cannot reach review step until customer+carrier fields AND docs valid', () => {
  const dom = makeB2Dom(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  const w = dom.window;
  assert.strictEqual(w.canGoTo('review'), false);
  w.setField('customer-select', 'c9');
  w.setField('customer-reference', 'PO-1');
  w.setField('customer-rate', '2500');
  w.fileStore = { cust_docs: [], carrier_docs: [] };
  assert.strictEqual(w.canGoTo('carrier'), false, 'customer fields ok but no customer doc -> cannot advance');
  w.fileStore.cust_docs = [_doc(w, 'a.pdf')];
  assert.strictEqual(w.canGoTo('carrier'), true);
  assert.strictEqual(w.canGoTo('review'), false);
  w.setField('carrier-select', 'v3');
  w.setField('carrier-rate', '2100');
  w.setField('carrier-factoring-invoice', 'F1');
  w.setField('rate-con', 'RC-7');
  assert.strictEqual(w.canGoTo('review'), false, 'carrier fields ok but no carrier doc -> cannot reach review');
  w.fileStore.carrier_docs = [_doc(w, 'b.pdf')];
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

test('submit failure keeps the form and surfaces the backend error message (no record id)', async () => {
  const dom = makeB2Dom(() => Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ error: 'x' }) }));
  const w = dom.window;
  w._collectFields = () => ({ customer_id: 'c9' });
  w._mergedPdfs = () => Promise.resolve({ customer: null, carrier: null });
  await w.submitLoad();
  assert.match(w.document.getElementById('submit-status').textContent, /x/);
});

test('submit failure with no backend error message falls back to the generic message', async () => {
  const dom = makeB2Dom(() => Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({}) }));
  const w = dom.window;
  w._collectFields = () => ({ customer_id: 'c9' });
  w._mergedPdfs = () => Promise.resolve({ customer: null, carrier: null });
  await w.submitLoad();
  assert.match(w.document.getElementById('submit-status').textContent, /error|failed|try again/i);
});

test('/funding-submit rejection surfaces the specific gate reason from the backend', async () => {
  const dom = makeB2Dom(() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({
    error: 'This carrier\'s hiring decision is "Hold" — complete the Confirm checklist.',
    reason: 'carrier_not_approved'
  })}));
  const w = dom.window;
  w._collectFields = () => ({ customer_id: 'c9' });
  w._mergedPdfs = () => Promise.resolve({ customer: null, carrier: null });
  await w.submitLoad();
  assert.match(w.document.getElementById('submit-status').textContent, /complete the Confirm checklist/);
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
  const t = w.document.getElementById('post-submit-banner').textContent;
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

// ── B5b: sequential uploads + Creator code check + audit finalize ─────────────

test('submit uploads documents sequentially, never two writes to the record at once', async () => {
  let inFlight = 0, maxConcurrent = 0;
  const dom = makeB2Dom((url) => {
    if (String(url).includes('/funding-submit'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, record_id: 'rec_900', warnings: [] }) });
    if (String(url).includes('/upload-doc')) {
      inFlight++; maxConcurrent = Math.max(maxConcurrent, inFlight);
      return new Promise(res => setTimeout(() => { inFlight--; res({ ok: true, json: () => Promise.resolve({ code: 3000 }) }); }, 5));
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 3000 }) });  // finalize
  });
  const w = dom.window;
  w._collectFields = () => ({ customer_id: 'c9' });
  w._mergedPdfs = () => Promise.resolve({ customer: new w.Blob(['x']), carrier: new w.Blob(['y']) });
  await w.submitLoad();
  assert.strictEqual(maxConcurrent, 1, 'two uploads overlapped -> Creator row-lock drop risk');
});

test('submit calls /funding-finalize with the record id after the uploads', async () => {
  let finalizeBody = null;
  const dom = makeB2Dom((url, opts) => {
    if (String(url).includes('/funding-submit'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, record_id: 'rec_901', warnings: [] }) });
    if (String(url).includes('/funding-finalize')) { finalizeBody = JSON.parse(opts.body);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, status: 'Processing' }) }); }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 3000 }) });
  });
  const w = dom.window;
  w._collectFields = () => ({ customer_id: 'c9' });
  w._mergedPdfs = () => Promise.resolve({ customer: new w.Blob(['x']), carrier: new w.Blob(['y']) });
  await w.submitLoad();
  assert.ok(finalizeBody, '/funding-finalize was not called');
  assert.strictEqual(finalizeBody.record_id, 'rec_901');
  assert.strictEqual(finalizeBody.email, 'b@x.com');
});

test('an upload returning HTTP 200 with a non-3000 Creator code is treated as failed', async () => {
  const dom = makeB2Dom((url) => {
    if (String(url).includes('/funding-submit'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, record_id: 'rec_902', warnings: [] }) });
    if (String(url).includes('/upload-doc'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 3105, message: 'record locked' }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 3000 }) });  // finalize ok
  });
  const w = dom.window;
  w._collectFields = () => ({ customer_id: 'c9' });
  w._mergedPdfs = () => Promise.resolve({ customer: new w.Blob(['x']), carrier: null });
  await w.submitLoad();
  const t = w.document.getElementById('post-submit-banner').textContent;
  assert.match(t, /rec_902/);
  assert.match(t, /upload/i);
});

test('a failed doc upload calls /funding-finalize with docs_ok:false', async () => {
  let finalizeBody = null;
  const dom = makeB2Dom((url, opts) => {
    if (String(url).includes('/funding-submit'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, record_id: 'rec_910', warnings: [] }) });
    if (String(url).includes('/upload-doc'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 3105, message: 'record locked' }) });
    if (String(url).includes('/funding-finalize')) { finalizeBody = JSON.parse(opts.body);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, status: 'Draft' }) }); }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 3000 }) });
  });
  const w = dom.window;
  w._collectFields = () => ({ customer_id: 'c9' });
  w._mergedPdfs = () => Promise.resolve({ customer: new w.Blob(['x']), carrier: null });
  await w.submitLoad();
  assert.ok(finalizeBody, '/funding-finalize was not called');
  assert.strictEqual(finalizeBody.docs_ok, false);
});

test('a successful submit calls /funding-finalize with docs_ok:true', async () => {
  let finalizeBody = null;
  const dom = makeB2Dom((url, opts) => {
    if (String(url).includes('/funding-submit'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, record_id: 'rec_911', warnings: [] }) });
    if (String(url).includes('/funding-finalize')) { finalizeBody = JSON.parse(opts.body);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, status: 'Processing' }) }); }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 3000 }) });
  });
  const w = dom.window;
  w._collectFields = () => ({ customer_id: 'c9' });
  w._mergedPdfs = () => Promise.resolve({ customer: new w.Blob(['x']), carrier: new w.Blob(['y']) });
  await w.submitLoad();
  assert.strictEqual(finalizeBody.docs_ok, true);
});

test('the failed-upload banner points the broker to Draft Loads', async () => {
  const dom = makeB2Dom((url) => {
    if (String(url).includes('/funding-submit'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, record_id: 'rec_912', warnings: [] }) });
    if (String(url).includes('/upload-doc'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 3105 }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, status: 'Draft' }) });
  });
  const w = dom.window;
  w._collectFields = () => ({ customer_id: 'c9' });
  w._mergedPdfs = () => Promise.resolve({ customer: new w.Blob(['x']), carrier: null });
  await w.submitLoad();
  const t = w.document.getElementById('post-submit-banner').textContent;
  assert.match(t, /Draft Loads/);
  assert.doesNotMatch(t, /Submission History/);
});

test('a finalize that never lands does NOT show the "submitted" banner (Missions strand)', async () => {
  // Docs upload fine, but finalize keeps failing (Render down / demote row-lock).
  // The record is still stranded at Pending Docs, so the broker must be pointed at
  // Draft Loads, NEVER told the load reached Submission History.
  const dom = makeB2Dom((url) => {
    if (String(url).includes('/funding-submit'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, record_id: 'rec_920', warnings: [] }) });
    if (String(url).includes('/upload-doc'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 3000 }) });  // uploads OK
    if (String(url).includes('/funding-finalize'))
      return Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ ok: false }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 3000 }) });
  });
  const w = dom.window;
  w._FINALIZE_RETRY_MS = 0;  // skip backoff
  w._collectFields = () => ({ customer_id: 'c9' });
  w._mergedPdfs = () => Promise.resolve({ customer: new w.Blob(['x']), carrier: new w.Blob(['y']) });
  await w.submitLoad();
  const t = w.document.getElementById('post-submit-banner').textContent;
  assert.match(t, /Draft Loads/);
  assert.doesNotMatch(t, /Submission History/);
});

test('finalize is retried when the first call fails', async () => {
  let finalizeCalls = 0;
  const dom = makeB2Dom((url) => {
    if (String(url).includes('/funding-submit'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, record_id: 'rec_921', warnings: [] }) });
    if (String(url).includes('/funding-finalize')) {
      finalizeCalls++;
      // Fail the first attempt, succeed on the second.
      if (finalizeCalls < 2) return Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, status: 'Processing' }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 3000 }) });
  });
  const w = dom.window;
  w._FINALIZE_RETRY_MS = 0;
  w._collectFields = () => ({ customer_id: 'c9' });
  w._mergedPdfs = () => Promise.resolve({ customer: new w.Blob(['x']), carrier: new w.Blob(['y']) });
  await w.submitLoad();
  assert.ok(finalizeCalls >= 2, 'finalize was not retried after a failure');
  const t = w.document.getElementById('post-submit-banner').textContent;
  assert.match(t, /Submission History/, 'a retried-and-succeeded finalize should confirm clean submit');
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

// ── Vendor_ID handoff from View Vendors' Submit Invoice action ────────────────

test('_resolveVendorId reads sessionStorage.loadDetailsVendorId (View Vendors handoff) and clears it', () => {
  const w = makeStorageDom().window;
  w.sessionStorage.setItem('loadDetailsVendorId', 'VND777');
  const id = w._resolveVendorId({});
  assert.strictEqual(id, 'VND777');
  assert.strictEqual(w.sessionStorage.getItem('loadDetailsVendorId'), null, 'loadDetailsVendorId cleared after read');
});

test('_resolveVendorId still prefers an explicit param over sessionStorage', () => {
  const w = makeStorageDom().window;
  w.sessionStorage.setItem('loadDetailsVendorId', 'VND777');
  assert.strictEqual(w._resolveVendorId({ vendorId: 'VND900' }), 'VND900');
});

test('onReady preselects the carrier once carriers load, when a Vendor_ID handoff is pending', async () => {
  // Drives the real boot path end-to-end (sessionStorage set before the page's
  // own 'load' listener fires resolveEmail() -> onReady()), same as production,
  // rather than poking _pendingVendorId directly.
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://tcroteau01-commits.github.io/index.html'
  });
  const w = dom.window;
  w.fetch = (url) => {
    if (String(url).includes('/tms-carriers')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({
        carriers: [{ vendor_id: 'v1', carrier_name: 'Acme Trucking', hiring_decision: 'Approve' }]
      }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ customers: [] }) });
  };
  w.ZOHO = { CREATOR: { UTIL: { getInitParams: () => ({ loginUser: 'b@x.com' }) }, init: () => Promise.resolve() } };
  w.OperFiAV = { carrierBadge: () => {}, customerCredit: () => {} };
  w.sessionStorage.setItem('loadDetailsVendorId', 'v1');
  await new Promise(function (r) { setTimeout(r, 100); });
  assert.strictEqual(w.document.getElementById('carrier-select').value, 'v1');
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

// ── Task 4: on-file indicator + remove control ────────────────────────────────

test('prefillFromDraft shows an on-file indicator for existing docs', () => {
  const w = makeStorageDom().window;
  w.prefillFromDraft({ id: '900', customer_id: '', carrier_id: '',
    has_customer_docs: true, has_carrier_docs: false });
  const cust = w.document.getElementById('cust_docs_label');
  const carr = w.document.getElementById('carrier_docs_label');
  assert.match(cust.textContent, /on file/i);
  assert.doesNotMatch(carr.textContent, /on file/i);
  // a remove control is present for the customer slot
  assert.ok(w.document.querySelector('[data-remove-doc="customer"]'));
});

test('removeDraftDoc calls remove-doc and clears the indicator', async () => {
  const seen = [];
  const dom = makeB2Dom((url, opts) => { seen.push({ url: String(url), opts: opts || {} });
    if (String(url).includes('/remove-doc'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, slot: 'customer', has_customer_docs: false, has_carrier_docs: false }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  const w = dom.window;
  w.brokerEmail = 'b@x.com';
  w.currentDraftId = '900';
  w.prefillFromDraft({ id: '900', has_customer_docs: true, has_carrier_docs: false });
  await w.removeDraftDoc('customer');
  const hit = seen.find(r => r.url.indexOf('/draft-loads/900/remove-doc') !== -1);
  assert.ok(hit, '/draft-loads/900/remove-doc was called');
  assert.doesNotMatch(w.document.getElementById('cust_docs_label').textContent, /on file/i);
});

// ── Doc merge hardening: read-on-select + fail-loud (no baked error pages) ─────

test('mergeFiles reads bytes at selection and stores a detached Blob, not the live File handle', async () => {
  const dom = makeB2Dom(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  const w = dom.window;
  // A File whose arrayBuffer() works ONCE (at selection) then goes stale and throws,
  // exactly like a file moved/renamed/cloud-evicted between pick and submit.
  let reads = 0;
  const flaky = { name: 'rate_con.pdf', size: 3, type: 'application/pdf',
    arrayBuffer: () => { reads++; return reads > 1
      ? Promise.reject(new Error('A requested file or directory could not be found'))
      : Promise.resolve(new Uint8Array([1, 2, 3]).buffer); } };
  await w.mergeFiles('cust_docs', [flaky]);
  const entry = w.fileStore['cust_docs'][0];
  assert.strictEqual(entry.name, 'rate_con.pdf');
  assert.strictEqual(entry.error, null, 'selection read succeeded so no error');
  assert.ok(entry.blob instanceof w.Blob, 'bytes captured into a detached Blob');
  // The 3 source bytes were copied into the detached Blob at selection time, so
  // they survive even though the original handle is now stale.
  assert.strictEqual(entry.blob.size, 3, 'captured bytes detached from the live handle');
  assert.strictEqual(reads, 1, 'the live File handle is read exactly once, at selection');
});

test('mergeFiles records a read error when a file cannot be read at selection', async () => {
  const dom = makeB2Dom(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  const w = dom.window;
  const broken = { name: 'broken.pdf', size: 5, type: 'application/pdf',
    arrayBuffer: () => Promise.reject(new Error('boom')) };
  await w.mergeFiles('cust_docs', [broken]);
  const entry = w.fileStore['cust_docs'][0];
  assert.strictEqual(entry.blob, null);
  assert.match(entry.error, /boom/);
});

test('mergeFilesToPDF fails loudly on an unreadable file instead of baking an error page', async () => {
  const dom = makeB2Dom(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  const w = dom.window;
  await assert.rejects(
    () => w.mergeFilesToPDF([{ name: 'rate_con.pdf', ext: 'pdf', blob: null, error: 'NotFoundError' }]),
    (err) => {
      assert.match(err.message, /rate_con\.pdf/);
      assert.ok(err.docMessage, 'carries a broker-facing docMessage');
      return true;
    });
});

test('submit blocks and creates NO funding record when a picked file is unreadable', async () => {
  const seen = [];
  const dom = makeB2Dom((url, opts) => { seen.push({ url: String(url), opts });
    if (String(url).includes('/funding-submit'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, record_id: 'rec_X' }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  const w = dom.window;
  w._collectFields = () => ({ customer_id: 'c9' });
  // Real _mergedPdfs / mergeFilesToPDF — a stale customer doc must abort before any POST.
  w.fileStore = { cust_docs: [{ name: 'rate_con.pdf', ext: 'pdf', blob: null, error: 'NotFoundError' }],
                  carrier_docs: [] };
  await w.submitLoad();
  assert.strictEqual(seen.filter(s => s.url.includes('/funding-submit')).length, 0,
    'no funding record created when a doc is unreadable');
  const t = w.document.getElementById('submit-status').textContent;
  assert.match(t, /rate_con\.pdf/);
  assert.match(t, /re-?select|select it again|remove/i);
  assert.strictEqual(w.document.getElementById('submit-btn').disabled, false,
    'submit re-enabled so the broker can fix and retry');
});

// ── Hard gates: required documents per step + red/green feedback ───────────────

function _doc(w, name) {
  return { name: name, ext: name.split('.').pop().toLowerCase(), blob: new w.Blob(['x']), error: null };
}
function _fillCustomer(w) {
  w.setField('customer-select', 'c9');
  w.setField('customer-reference', 'PO-1');
  w.setField('customer-rate', '2500');
}
function _fillCarrier(w) {
  w.setField('carrier-select', 'v3');
  w.setField('carrier-rate', '2100');
  w.setField('carrier-factoring-invoice', 'F1');
  w.setField('rate-con', 'RC-7');
}

test('stepValid gates each step on its required document, not just the fields', () => {
  const w = makeB2Dom(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })).window;
  _fillCustomer(w); _fillCarrier(w);
  w.fileStore = { cust_docs: [], carrier_docs: [] };
  assert.strictEqual(w.stepValid('customer'), false, 'customer fields ok but no customer doc -> invalid');
  assert.strictEqual(w.stepValid('carrier'), false, 'carrier fields ok but no carrier doc -> invalid');
  w.fileStore.cust_docs = [_doc(w, 'bol.pdf')];
  assert.strictEqual(w.stepValid('customer'), true);
  assert.strictEqual(w.stepValid('carrier'), false, 'still no carrier doc');
  w.fileStore.carrier_docs = [_doc(w, 'rc.pdf')];
  assert.strictEqual(w.stepValid('carrier'), true);
});

test('a doc that failed to read does not satisfy the gate', () => {
  const w = makeB2Dom(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })).window;
  _fillCustomer(w);
  w.fileStore = { cust_docs: [{ name: 'bad.pdf', ext: 'pdf', blob: null, error: 'x' }], carrier_docs: [] };
  assert.strictEqual(w.stepValid('customer'), false, 'an unreadable-only doc set is not a satisfied gate');
});

test('a draft packet already on file satisfies the document gate', () => {
  const w = makeB2Dom(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })).window;
  _fillCustomer(w);
  w.fileStore = { cust_docs: [], carrier_docs: [] };
  assert.strictEqual(w.stepValid('customer'), false);
  w._setDocOnFile('customer', true);  // reopened draft with has_customer_docs
  assert.strictEqual(w.stepValid('customer'), true, 'an existing on-file packet counts as satisfied');
});

test('trying to advance without the required doc is blocked and flags the dropzone + message', () => {
  const w = makeB2Dom(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })).window;
  _fillCustomer(w);
  w.fileStore = { cust_docs: [], carrier_docs: [] };
  w.goToStep('carrier');
  assert.ok(!w.document.getElementById('card-carrier').classList.contains('active'), 'did not advance to carrier');
  assert.ok(w.document.getElementById('cust_docs_area').classList.contains('invalid'), 'dropzone flagged red');
  assert.ok(w.document.getElementById('customer-error').classList.contains('show'), 'required message shown');
});

test('a blocked advance flags the visible carrier search box red, not the hidden select', () => {
  const w = makeB2Dom(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })).window;
  _fillCustomer(w);
  // carrier fields filled but NO carrier picked and no carrier doc
  w.setField('carrier-rate', '2100'); w.setField('carrier-factoring-invoice', 'F1'); w.setField('rate-con', 'RC-7');
  w.fileStore = { cust_docs: [_doc(w, 'a.pdf')], carrier_docs: [] };
  w.goToStep('review');  // blocked at the carrier step
  assert.ok(w.document.getElementById('carrier-search').classList.contains('invalid'), 'search box flagged red');
  assert.ok(!w.document.getElementById('carrier-select').classList.contains('invalid'), 'hidden select is not the flag target');
});

test('updateDocVisuals marks a satisfied dropzone valid (green) and clears invalid', () => {
  const w = makeB2Dom(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })).window;
  const area = w.document.getElementById('cust_docs_area');
  area.classList.add('invalid');
  w.fileStore = { cust_docs: [_doc(w, 'bol.pdf')], carrier_docs: [] };
  w.updateDocVisuals();
  assert.ok(area.classList.contains('valid'), 'present doc -> green');
  assert.ok(!area.classList.contains('invalid'), 'invalid flag cleared');
});

// ── Searchable carrier selector (name / MC / DOT) ─────────────────────────────

function makeCarrierDom() {
  const dom = makeB2Dom((url) => Promise.resolve({ ok: true, json: () => Promise.resolve(
    String(url).includes('/tms-carriers')
      ? { carriers: [
          { vendor_id: 'v3', carrier_name: 'Hauler', mc: '123456', dot: '654321', payment_terms: 'Quickpay 2%' },
          { vendor_id: 'v7', carrier_name: 'Brennan Trucking', mc: '998877', dot: '112233', payment_terms: 'Net 30' }
        ] }
      : { customers: [] }
  )}));
  return dom.window;
}

test('carrier section renders a search input over a hidden select', () => {
  const d = new JSDOM(HTML).window.document;
  assert.ok(d.getElementById('carrier-search'), 'missing #carrier-search');
  assert.ok(d.getElementById('carrier-list'), 'missing #carrier-list results container');
  assert.ok(d.getElementById('carrier-select'), 'hidden #carrier-select state holder remains');
});

test('carrier search filters by name, MC, or DOT', async () => {
  const w = makeCarrierDom();
  await w.loadCarriers();
  w.renderCarrierResults('brennan');
  let rows = [...w.document.querySelectorAll('#carrier-list .combo-opt')];
  assert.ok(rows.some(r => /Brennan/i.test(r.textContent)), 'name match present');
  assert.ok(!rows.some(r => /Hauler/.test(r.textContent)), 'non-matches excluded');
  w.renderCarrierResults('654321');  // Hauler's DOT
  rows = [...w.document.querySelectorAll('#carrier-list .combo-opt')];
  assert.ok(rows.some(r => /Hauler/.test(r.textContent)), 'DOT search matches');
  w.renderCarrierResults('998877');  // Brennan's MC
  rows = [...w.document.querySelectorAll('#carrier-list .combo-opt')];
  assert.ok(rows.some(r => /Brennan/i.test(r.textContent)), 'MC search matches');
});

test('carrier result rows show the carrier MC and DOT', async () => {
  const w = makeCarrierDom();
  await w.loadCarriers();
  w.renderCarrierResults('hauler');
  const row = w.document.querySelector('#carrier-list .combo-opt');
  assert.match(row.textContent, /123456/, 'MC shown on the row');
  assert.match(row.textContent, /654321/, 'DOT shown on the row');
});

test('selecting a carrier from search sets the value, fills the box, and shows terms', async () => {
  const w = makeCarrierDom();
  await w.loadCarriers();
  w.selectCarrierFromSearch('v3');
  assert.strictEqual(w.document.getElementById('carrier-select').value, 'v3', 'hidden select carries the id');
  assert.match(w.document.getElementById('carrier-search').value, /Hauler/, 'search box shows the chosen name');
  assert.match(w.document.getElementById('terms-readout-value').textContent, /Quickpay 2%/, 'terms populated via onCarrierChange');
});

// ── Soft warning: factoring carrier with no factor named on file ──────────────

function makeFactoringDom() {
  const dom = makeB2Dom((url) => Promise.resolve({ ok: true, json: () => Promise.resolve(
    String(url).includes('/tms-carriers')
      ? { carriers: [
          { vendor_id: 'vF', carrier_name: 'No Factor Co', mc: '1', dot: '2', payment_terms: 'Factoring Company' },
          { vendor_id: 'vG', carrier_name: 'Named Factor Co', mc: '3', dot: '4', payment_terms: 'Factoring Company - RTS FINANCIAL SERVICES' },
          { vendor_id: 'vN', carrier_name: 'Net Co', mc: '5', dot: '6', payment_terms: 'Net 30' }
        ] }
      : { customers: [] }
  )}));
  return dom.window;
}

test('factoringMissingFactor flags bare Factoring-Company terms only', () => {
  const wd = makeFactoringDom();
  assert.strictEqual(wd.factoringMissingFactor('Factoring Company'), true);
  assert.strictEqual(wd.factoringMissingFactor('Factoring Company - Quick Pay'), true);
  assert.strictEqual(wd.factoringMissingFactor('Factoring Company - RTS FINANCIAL SERVICES'), false);
  assert.strictEqual(wd.factoringMissingFactor('Net 30'), false);
  assert.strictEqual(wd.factoringMissingFactor(''), false);
});

test('selecting a factoring carrier with no factor shows the soft missing-factor warning', async () => {
  const w = makeFactoringDom();
  await w.loadCarriers();
  w.selectCarrierFromSearch('vF');
  const warn = w.document.getElementById('terms-warn-factor');
  assert.ok(warn, 'warning element exists');
  assert.notStrictEqual(warn.style.display, 'none', 'shown for bare Factoring Company');
});

test('selecting a factoring carrier WITH a named factor hides the warning', async () => {
  const w = makeFactoringDom();
  await w.loadCarriers();
  w.selectCarrierFromSearch('vG');
  assert.strictEqual(w.document.getElementById('terms-warn-factor').style.display, 'none');
});

test('selecting a non-factoring carrier hides the missing-factor warning', async () => {
  const w = makeFactoringDom();
  await w.loadCarriers();
  w.selectCarrierFromSearch('vN');
  assert.strictEqual(w.document.getElementById('terms-warn-factor').style.display, 'none');
});

// ── Post-submit reset: clear the form so the same load can't be sent twice ─────

test('a successful submit clears the form, returns to step 1, and blocks resubmission', async () => {
  const dom = makeB2Dom((url) => {
    if (String(url).includes('/funding-submit'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, record_id: 'rec_900' }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 3000 }) });  // upload-doc ok
  });
  const w = dom.window, d = w.document;
  w.setField('customer-select', 'c9'); w.setField('customer-reference', 'PO-1'); w.setField('customer-rate', '2500');
  w.setField('carrier-select', 'v3'); w.setField('carrier-rate', '2100');
  w.setField('carrier-factoring-invoice', 'F1'); w.setField('rate-con', 'RC-7');
  d.getElementById('carrier-search').value = 'Hauler';
  w.fileStore = { cust_docs: [_doc(w, 'bol.pdf')], carrier_docs: [_doc(w, 'rc.pdf')] };
  w._mergedPdfs = () => Promise.resolve({ customer: new w.Blob(['x']), carrier: new w.Blob(['y']) });
  w.gotoStep('review');
  await w.submitLoad();
  assert.strictEqual(d.getElementById('customer-reference').value, '', 'fields cleared');
  assert.strictEqual(d.getElementById('rate-con').value, '');
  assert.strictEqual(d.getElementById('carrier-search').value, '', 'carrier search cleared');
  assert.strictEqual(d.getElementById('carrier-select').value, '', 'carrier selection cleared');
  assert.strictEqual((w.fileStore.cust_docs || []).length, 0, 'documents cleared');
  assert.ok(d.getElementById('card-customer').classList.contains('active'), 'returned to step 1');
  assert.ok(!d.getElementById('card-review').classList.contains('active'));
  assert.strictEqual(d.getElementById('submit-btn').disabled, true, 'empty form -> cannot resubmit the same load');
  assert.match(d.getElementById('post-submit-banner').textContent, /PO-1/, 'confirmation references the broker load number');
  assert.doesNotMatch(d.getElementById('post-submit-banner').textContent, /rec_900/, 'confirmation does not show the OperFi record id when a reference exists');
});

test('confirmation falls back to the OperFi record id when no reference was entered', async () => {
  const dom = makeB2Dom((url) => {
    if (String(url).includes('/funding-submit'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, record_id: 'rec_950' }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 3000 }) });
  });
  const w = dom.window, d = w.document;
  w._collectFields = () => ({ customer_id: 'c9' });  // no customer-reference set on the form
  w._mergedPdfs = () => Promise.resolve({ customer: null, carrier: null });
  await w.submitLoad();
  assert.match(d.getElementById('post-submit-banner').textContent, /rec_950/, 'no reference -> show the record id');
});

test('submit shows a document-merge progress message before the network call', () => {
  const dom = makeB2Dom(() => new Promise(() => {}));  // network never resolves
  const w = dom.window, d = w.document;
  w._collectFields = () => ({ customer_id: 'c9' });
  w._mergedPdfs = () => new Promise(() => {});  // merge pending -> entry message persists
  w.fileStore = { cust_docs: [_doc(w, 'bol.pdf')], carrier_docs: [] };
  w.submitLoad();  // not awaited: capture the synchronous entry status
  assert.match(d.getElementById('submit-status').textContent, /merging|document/i);
});

test('reopenDraft falls back to GET /draft-loads/<id> when not in the draft list', async () => {
  const calls = [];
  const dom = makeB2Dom((url) => {
    calls.push(String(url));
    if (/\/draft-loads\?/.test(String(url))) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ drafts: [] }) });
    }
    if (/\/draft-loads\/902/.test(String(url))) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ draft: { id: '902' } }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  const w = dom.window;
  let got = null;
  w.prefillFromDraft = (d) => { got = d; };
  const ok = await w.reopenDraft('902');
  assert.ok(calls.some(u => /\/draft-loads\/902/.test(u)), 'by-id endpoint called');
  assert.equal(got.id, '902');
  assert.equal(ok, true);
});

test('reopen overlay show/hide/error toggles visibility', () => {
  const dom = makeB2Dom(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  const w = dom.window;
  const o = () => w.document.getElementById('reopen-overlay');
  assert.strictEqual(o().hidden, true);              // hidden by default
  w._showReopenOverlay();
  assert.strictEqual(o().hidden, false);
  w._hideReopenOverlay();
  assert.strictEqual(o().hidden, true);
  w._showReopenError();
  assert.strictEqual(o().hidden, false);
  assert.match(o().className, /error/);
});
