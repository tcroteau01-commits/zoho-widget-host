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

function makeB2Dom(fetchImpl) {
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
