import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../vendor-payments.html', import.meta.url), 'utf8');

// ── Static source checks ──────────────────────────────────────────────────────

test('loads operfi-av.js script tag', () => {
  assert.match(HTML, /operfi-av\.js/);
});

test('detail pane markup contains #vp-carrier-av container', () => {
  assert.match(HTML, /vp-carrier-av/);
});

test('"Carrier Vetting" section heading is present', () => {
  assert.match(HTML, /Carrier Vetting/);
});

test('old future-enhancement placeholder text is gone', () => {
  assert.doesNotMatch(HTML, /future enhancement/i);
});

test('targets the Render backend', () => {
  assert.match(HTML, /operfi-broker-api\.onrender\.com/);
});

// ── Runtime helpers ───────────────────────────────────────────────────────────

const MOCK_ROW = {
  _id: 'm1',
  'Load #': '8662',
  'Debtor': 'Sunbelt Rentals',
  'Vendor Name': 'A&M FAST TRANSPORT',
  'USDOT': '92261',
  'Vendor Amount': 850.00,
  'Vendor Due': '2026-05-29',
  'Date of Buy Date': '2026-05-08',
  'Vendor Pmt Terms': 'Factoring Company',
  'Broker Pmt Terms': 'Quick Pay',
  'Factoring Company': 'RTS Financial',
  'Pmt Acct Number': 'XXXX0001',
  'Vendor Invoice #': 'INV1',
  'Invoice #': '8662',
  'Payment Status': 'Pending Payment',
  'Purchase Date': '2026-05-08',
  'AR Balance': 0,
  'Vendor Gross Amt': 850,
  'PO #': 'PO1',
  'Other Reference': 'REF1'
};

// Build a JSDOM instance with the ?email= override so the widget boots without
// the Zoho SDK. We set OperFiAV + fetch stubs in beforeParse so they are
// available when the inline script runs.
function makeWidget(avStubs) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://tcroteau01-commits.github.io/vendor-payments.html?email=broker@test.com',
    beforeParse(window) {
      // Stub ZOHO so waitForZoho doesn't spin (the ?email= path bypasses it,
      // but the IIFE references ZOHO conditionally so we need it defined).
      window.ZOHO = {
        CREATOR: {
          UTIL: { getInitParams: () => Promise.resolve({ loginUser: 'broker@test.com' }) },
          init: () => Promise.resolve()
        }
      };

      // OperFiAV stub — callers can override carrierBadge with a spy.
      window.OperFiAV = Object.assign(
        { carrierBadge: () => {}, customerCredit: () => {} },
        avStubs || {}
      );

      // Stub fetch: return the mock row for /vendor-payments/open.
      window.fetch = (url) => {
        if (String(url).includes('/vendor-payments/open')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              accountName: 'Marek LLC',
              rows: [MOCK_ROW],
              totals: { openLoads: 1, totalOwed: 850, carrierCount: 1 }
            })
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      };
    }
  });
  return dom;
}

// Poll for a condition, up to 300ms.
async function waitFor(fn, timeout = 300) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise(r => setTimeout(r, 10));
  }
}

// ── Runtime: detail pane ─────────────────────────────────────────────────────

test('#vp-carrier-av exists in DOM after opening a detail row', async () => {
  const dom = makeWidget();
  const w = dom.window;

  // Fire the load event to boot the widget (the ?email= path fires onReady immediately).
  w.dispatchEvent(new w.Event('load'));

  // Wait for fetch to resolve and the table to render.
  await waitFor(() => w.document.querySelector('#open-table-wrap tbody tr[data-id]'));

  const tr = w.document.querySelector('#open-table-wrap tbody tr[data-id]');
  assert.ok(tr, 'at least one row must render in the Open AP table');
  tr.click();

  const avEl = w.document.getElementById('vp-carrier-av');
  assert.ok(avEl, '#vp-carrier-av must exist in the DOM after the detail panel opens');
});

test('carrierBadge is called with the row USDOT, email, and apiBase', async () => {
  const calls = [];
  const dom = makeWidget({ carrierBadge: (el, opts) => calls.push({ el, opts }) });
  const w = dom.window;

  w.dispatchEvent(new w.Event('load'));
  await waitFor(() => w.document.querySelector('#open-table-wrap tbody tr[data-id]'));

  w.document.querySelector('#open-table-wrap tbody tr[data-id]').click();

  assert.equal(calls.length, 1, 'carrierBadge must be called exactly once');
  const { el, opts } = calls[0];
  assert.equal(opts.usdot, MOCK_ROW['USDOT'], 'usdot must match the row USDOT field');
  assert.equal(opts.email, 'broker@test.com', 'email must be the login email');
  assert.match(opts.apiBase, /onrender\.com/, 'apiBase must be the Render URL');
  assert.ok(el instanceof w.HTMLElement, 'first arg must be a DOM element');
});

test('carrierBadge is NOT called when OperFiAV is absent (no throw)', async () => {
  const dom = makeWidget();
  const w = dom.window;
  delete w.OperFiAV; // simulate script not yet loaded

  w.dispatchEvent(new w.Event('load'));
  await waitFor(() => w.document.querySelector('#open-table-wrap tbody tr[data-id]'));

  let threw = false;
  try {
    w.document.querySelector('#open-table-wrap tbody tr[data-id]').click();
  } catch (e) {
    threw = true;
  }
  assert.ok(!threw, 'clicking a row without OperFiAV must not throw');

  // Container is still in the DOM even without the badge.
  assert.ok(w.document.getElementById('vp-carrier-av'), '#vp-carrier-av must still be in DOM');
});

// ── Broker term preference in list Terms cell ─────────────────────────────────

test('both list Terms cells prefer Broker Pmt Terms with a vendor-term fallback', () => {
  // Source-level guard so both tables stay in sync.
  const matches = HTML.match(/r\['Broker Pmt Terms'\]\s*\|\|\s*r\['Vendor Pmt Terms'\]/g) || [];
  assert.ok(matches.length >= 2, 'expected broker-term fallback in open + history tables');
});

test('open table renders the broker term when present', async () => {
  const row = Object.assign({}, MOCK_ROW, { 'Broker Pmt Terms': 'Quick Pay', 'Vendor Pmt Terms': 'Standard Net 30' });
  const dom = makeWidget();
  const w = dom.window;
  // Override fetch to serve our custom row.
  w.fetch = (url) => {
    if (String(url).includes('/vendor-payments/open')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ accountName: 'Test Co', rows: [row], totals: { openLoads: 1, totalOwed: 850, carrierCount: 1 } })
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
  w.dispatchEvent(new w.Event('load'));
  await waitFor(() => w.document.querySelector('#open-table-wrap td[data-label="Terms"]'));
  const cell = w.document.querySelector('#open-table-wrap td[data-label="Terms"]');
  assert.ok(cell, 'Terms cell rendered');
  assert.strictEqual(cell.textContent.trim(), 'Quick Pay');
});

test('open table falls back to the vendor term when broker term is empty', async () => {
  const row = Object.assign({}, MOCK_ROW, { 'Broker Pmt Terms': '', 'Vendor Pmt Terms': 'Standard Net 30' });
  const dom = makeWidget();
  const w = dom.window;
  w.fetch = (url) => {
    if (String(url).includes('/vendor-payments/open')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ accountName: 'Test Co', rows: [row], totals: { openLoads: 1, totalOwed: 850, carrierCount: 1 } })
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
  w.dispatchEvent(new w.Event('load'));
  await waitFor(() => w.document.querySelector('#open-table-wrap td[data-label="Terms"]'));
  const cell = w.document.querySelector('#open-table-wrap td[data-label="Terms"]');
  assert.strictEqual(cell.textContent.trim(), 'Standard Net 30');
});

// ── Task 5: detail pane broker term + factoring company ───────────────────────

test('detail pane disclaimer "will be added in a future enhancement" is absent', () => {
  // Regression guard — the detail pane Terms & Routing section already renders
  // real values; the old placeholder text must never return.
  assert.doesNotMatch(HTML, /will be added in a future enhancement/i);
});

test('detail pane renders broker term and factoring company from row data', async () => {
  const row = Object.assign({}, MOCK_ROW, {
    'Broker Pmt Terms': 'Quick Pay',
    'Factoring Company': 'RTS Financial'
  });
  const dom = makeWidget();
  const w = dom.window;
  // Serve the row with populated broker term + factoring company.
  w.fetch = (url) => {
    if (String(url).includes('/vendor-payments/open')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          accountName: 'Test Co',
          rows: [row],
          totals: { openLoads: 1, totalOwed: 850, carrierCount: 1 }
        })
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
  w.dispatchEvent(new w.Event('load'));

  // Wait for the table to render with at least one clickable row.
  await waitFor(() => w.document.querySelector('#open-table-wrap tbody tr[data-id]'));

  // Click the row — this calls openDetail() inside the IIFE, which appends
  // #detail-panel to document.body.
  w.document.querySelector('#open-table-wrap tbody tr[data-id]').click();

  const panel = w.document.getElementById('detail-panel');
  assert.ok(panel, '#detail-panel must exist after clicking a row');

  const text = panel.textContent;
  assert.match(text, /Quick Pay/, 'detail panel must show the broker pmt term "Quick Pay"');
  assert.match(text, /RTS Financial/, 'detail panel must show the factoring company "RTS Financial"');
});

test('Open AP table has a Factor column header', () => {
  assert.match(HTML, /<th>Factor<\/th>/);
});

test('factorLabel renders Direct/dash logic', () => {
  assert.match(HTML, /function factorLabel/);
  assert.match(HTML, /_av_resolved/);
});

test('search widened to load/invoice/PO (not just vendor/USDOT)', () => {
  assert.match(HTML, /\['Load #'\]|\["Load #"\]/);
  assert.match(HTML, /\['PO #'\]|\["PO #"\]/);
});

test('factor dropdown elements exist', () => {
  assert.match(HTML, /id="open-factor"/);
  assert.match(HTML, /id="hist-factor"/);
});

// ── Task 6: see-all Client column + client filter + history presets ────────────

test('history presets are This Week / This Month / Last Month / Specific Date', () => {
  assert.match(HTML, /value="week"/);
  assert.match(HTML, />This Week</);
  assert.match(HTML, />Specific Date</);
  assert.doesNotMatch(HTML, /Last 90 Days/);
});

test('see-all helpers and Client cell exist', () => {
  assert.match(HTML, /function clientSelect/);
  assert.match(HTML, /function matchesClient/);
  assert.match(HTML, /state\.seeAll/);
  assert.match(HTML, /data-label="Client"/);
});

test('open fetch stores seeAll from response', () => {
  assert.match(HTML, /state\.seeAll = !!\s*data\.seeAll|state\.seeAll = data\.seeAll/);
});

test('history dropdown defaults to This Month to match the loaded range', () => {
  assert.match(HTML, /getElementById\('hist-preset'\)\.value = 'this'/);
});

test('renders Client column when response is seeAll', async () => {
  const dom = makeWidget({});
  const win = dom.window;
  win.fetch = (url) => {
    if (String(url).indexOf('/vendor-payments/open') !== -1) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
        seeAll: true, accountName: 'All clients',
        totals: { openLoads: 1, totalOwed: 1000, carrierCount: 1 },
        rows: [{ _id: 'x', 'Load #': '10949', 'Client': 'Good Manners', 'Vendor Name': 'EFFECTUAL',
                 'USDOT': '4200178', 'Vendor Amount': 1000, 'Factoring Company': 'RTS Financial',
                 'Payment Status': 'Pending', 'Broker Pmt Terms': 'Factoring', '_av_resolved': true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  };
  win.dispatchEvent(new win.Event('load'));
  await waitFor(() => win.document.querySelector('#open-table-wrap tbody tr[data-id]'));
  const html = win.document.getElementById('panel-open').innerHTML;
  assert.match(html, /<th>Client<\/th>/);
  assert.match(html, /Good Manners/);
  assert.match(html, /RTS Financial/);
});

test('admin see-all table gets vp-seeall class + column-width rules', () => {
  assert.match(HTML, /vp-table' \+ \(state\.seeAll \? ' vp-seeall' : ''\)/);
  assert.match(HTML, /\.vp-table\.vp-seeall th:nth-child\(2\)/);
});
