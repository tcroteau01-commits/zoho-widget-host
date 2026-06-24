import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../view-vendors.html', import.meta.url), 'utf8');

// ── Static source checks ──────────────────────────────────────────────────────

test('loads operfi-av.js script', () => {
  assert.match(HTML, /operfi-av\.js/);
});

test('detail pane markup template contains vv-carrier-av container', () => {
  assert.match(HTML, /vv-carrier-av/);
});

test('does not show carrier-wide Payment Terms field() call in panel', () => {
  // The generic field('Payment Terms', r.Payment_Terms) call should be gone.
  assert.doesNotMatch(HTML, /field\('Payment Terms'/);
});

test('targets the Render backend', () => {
  assert.match(HTML, /operfi-broker-api\.onrender\.com/);
});

// ── Runtime: carrierBadge is called when a vendor detail is opened ──────────
//
// The widget IIFE does not expose internals on window, so we drive it via the
// DOM: load records through the /broker-report fetch stub, let the list render,
// then click the first row to open the panel.

function makeDom(avStubs) {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;

  // Stub ZOHO SDK so bootApp resolves synchronously.
  w.ZOHO = {
    CREATOR: {
      UTIL: { getInitParams: () => ({ loginUser: 'broker@test.com' }) },
      init: () => Promise.resolve()
    }
  };

  // Stub OperFiAV before scripts run so the guard check works.
  w.OperFiAV = Object.assign({ carrierBadge: () => {}, customerCredit: () => {} }, avStubs || {});

  return dom;
}

// Return a fetch stub that answers /broker-report with the given records.
function makeFetch(records) {
  return (url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ records })
  });
}

// Wait for the row list to render (fetch is async even in stubs).
async function waitForRows(w, timeout = 200) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (w.document.querySelector('.row')) return;
    await new Promise(r => setTimeout(r, 10));
  }
}

const VENDOR = { ID: 'VND001', Vendor_Name: 'Test Carrier', Vendor_Status: 'Approved',
                 Email: 'tc@ex.com', MC: '12345' };

test('panel opens with #vv-carrier-av after clicking a vendor row', async () => {
  const dom = makeDom();
  const w = dom.window;
  w.fetch = makeFetch([VENDOR]);

  // Fire load event to boot the app.
  w.dispatchEvent(new w.Event('load'));
  await waitForRows(w);

  const row = w.document.querySelector('.row');
  assert.ok(row, 'at least one vendor row must render');
  row.click();

  const avEl = w.document.getElementById('vv-carrier-av');
  assert.ok(avEl, '#vv-carrier-av must exist in the DOM after panel opens');
});

test('carrierBadge is called with r.ID, brokerEmail, and BROKER_API_BASE', async () => {
  const calls = [];
  const dom = makeDom({ carrierBadge: (el, opts) => calls.push({ el, opts }) });
  const w = dom.window;
  w.fetch = makeFetch([VENDOR]);

  w.dispatchEvent(new w.Event('load'));
  await waitForRows(w);

  w.document.querySelector('.row').click();

  assert.equal(calls.length, 1, 'carrierBadge should be called exactly once');
  const { el, opts } = calls[0];
  assert.equal(opts.vendorId, 'VND001', 'vendorId must be r.ID');
  assert.equal(opts.email, 'broker@test.com', 'email must be brokerEmail');
  assert.match(opts.apiBase, /onrender\.com/, 'apiBase must be the Render URL');
  assert.ok(el instanceof w.HTMLElement, 'first arg must be a DOM element');
});

test('carrierBadge fires again on panel navigation to a second vendor', async () => {
  const calls = [];
  const dom = makeDom({ carrierBadge: (el, opts) => calls.push(opts.vendorId) });
  const w = dom.window;

  const v2 = { ID: 'VND002', Vendor_Name: 'Second Carrier', Vendor_Status: 'Approved' };
  // Second record sorts after first (Approved, alpha) so rows[0]=Test Carrier, rows[1]=Second Carrier
  // But sorted alphabetically: "Second" < "Test" so v2 is index 0, VENDOR is index 1.
  w.fetch = makeFetch([VENDOR, v2]);

  w.dispatchEvent(new w.Event('load'));
  await waitForRows(w);

  // Click the first row to open panel at index 0.
  const rows = w.document.querySelectorAll('.row');
  rows[0].click();

  // Navigate to next vendor via the panel nav button.
  const nextBtn = w.document.getElementById('p-next');
  assert.ok(nextBtn && !nextBtn.classList.contains('disabled'), 'next nav btn must exist and be enabled');
  nextBtn.click();

  assert.equal(calls.length, 2, 'carrierBadge should fire once per panel render');
});

test('carrierBadge is skipped (no throw) when OperFiAV is not loaded', async () => {
  const dom = makeDom();
  const w = dom.window;
  delete w.OperFiAV; // simulate script not yet loaded
  w.fetch = makeFetch([VENDOR]);

  w.dispatchEvent(new w.Event('load'));
  await waitForRows(w);

  // Should not throw even with OperFiAV absent.
  let threw = false;
  try { w.document.querySelector('.row').click(); } catch (e) { threw = true; }
  assert.ok(!threw, 'clicking a row without OperFiAV must not throw');

  // Container still rendered in the panel.
  assert.ok(w.document.getElementById('vv-carrier-av'), '#vv-carrier-av still in DOM');
});

// ── Relationship date: row "Since" column ──────────────────────────────────
const DATED = [
  { ID: 'A', Vendor_Name: 'Alpha Freight', Vendor_Status: 'Approved', Added_Time: '14-Mar-2025 10:00:00' },
  { ID: 'B', Vendor_Name: 'Bravo Lines',  Vendor_Status: 'Approved' /* no Added_Time */ },
];

test('row renders a Since cell with compact Mon YYYY', async () => {
  const dom = makeDom();
  const w = dom.window;
  w.fetch = makeFetch(DATED);
  w.dispatchEvent(new w.Event('load'));
  await waitForRows(w);
  const labels = [...w.document.querySelectorAll('.row .cell-label')].map(e => e.textContent);
  assert.ok(labels.includes('Since'), 'a Since column label is rendered');
  assert.match(w.document.body.textContent, /Mar 2025/);
});

test('row Since cell shows em-dash when Added_Time is absent', async () => {
  const dom = makeDom();
  const w = dom.window;
  w.fetch = makeFetch([DATED[1]]);
  w.dispatchEvent(new w.Event('load'));
  await waitForRows(w);
  // The Bravo row has no date; its Since cell must render the em-dash sentinel.
  const row = w.document.querySelector('.row');
  assert.match(row.textContent, /—/);
});

test('addressFieldHtml wraps the address in a Maps link; plain when empty', () => {
  const dom = makeDom();
  const w = dom.window;
  w.dispatchEvent(new w.Event('load'));

  const linked = w.addressFieldHtml('500 W Adams St, Phoenix, AZ 85003');
  assert.match(linked, /class="field-label">Address</);
  assert.match(linked, /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=/);
  assert.match(linked, /target="_blank"/);

  const empty = w.addressFieldHtml('');
  assert.ok(!/href=/.test(empty), 'no link when empty');
});
