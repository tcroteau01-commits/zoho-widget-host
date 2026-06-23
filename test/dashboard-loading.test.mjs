import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');

// Mount the widget in the LIVE path (not mock) with a controllable fetch so we
// can observe the skeleton while data is still pending.
function mountLive({ summary = {}, reserves = {}, summaryDelay = 0, reservesDelay = 0,
                     summaryReject = false, reservesReject = false } = {}) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://x/dashboard.html',
    beforeParse(w) {
      w.Chart = function () {};
      w.ZOHO = { CREATOR: { UTIL: { getInitParams: () => Promise.resolve({ loginUser: 'a@b.com' }) } } };
      w.fetch = (url) => {
        const isReserves = /wallet-reserves/.test(url);
        const delay = isReserves ? reservesDelay : summaryDelay;
        const reject = isReserves ? reservesReject : summaryReject;
        const body = isReserves ? reserves : summary;
        return new Promise((res, rej) => setTimeout(() => {
          if (reject) return rej(new Error('network'));
          res({ ok: true, status: 200, json: () => Promise.resolve(body) });
        }, delay));
      };
    },
  });
  return dom.window;
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Poll until fn() returns truthy or timeout expires. Returns fn()'s final result.
async function waitFor(fn, { timeout = 1000, step = 10 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (fn()) return true; await wait(step); }
  return fn();
}

test('skeleton paints before data arrives, with live Quick Actions', async () => {
  const w = mountLive({ summaryDelay: 10000 });   // summary never resolves in-window
  await wait(30);
  assert.ok(w.document.querySelector('.shimmer'), 'shimmer placeholder present');
  assert.ok(w.document.querySelector('[data-action="submit-load"]'), 'Quick Actions live');
  assert.ok(w.document.querySelector('[data-action="nav-vendor-payments"]'), 'Key Tasks live');
});

const SUMMARY = {
  accountName: 'Marek LLC', header: { usdot: '1', mc: '2', status: 'Active' },
  watch: { chargebackRisk: { amount: 0, invoiceCount: 0 }, creditLimits: { customersAtRisk: 0 }, dsoDays: 38 },
  snapshot: {
    openAR: { amount: 1000, count: 1 }, openAP: { amount: 900, count: 1 },
    thisMonth: { purchases: 5000, loads: 2, marginPct: 20 },
  },
  insights: { agingBuckets: [{ label: '0-30', amount: 1000, count: 1 }], concentration: [], monthly: [] },
};

// Helpers to detect rendered DOM state (textContent includes raw <script> source,
// so we check rendered elements specifically rather than body.textContent).
function getNameEl(w)      { return w.document.querySelector('.header-strip .name'); }
function getReservesBody(w){ return w.document.getElementById('reserves-body'); }

test('summary fills tiles while reserves tile still shows a spinner', async () => {
  const w = mountLive({ summary: SUMMARY, reserves: { cash: 5, escrow: 6 },
                        summaryDelay: 10, reservesDelay: 2000 });
  // Wait until render() has actually populated the header name element
  await waitFor(() => getNameEl(w) && getNameEl(w).textContent.includes('Marek LLC'));
  assert.ok(getNameEl(w).textContent.includes('Marek LLC'), 'account name rendered');
  // Reserves still pending — spinner must still be in #reserves-body
  assert.ok(w.document.querySelector('.reserves-loading'), 'reserves spinner still showing');
});

test('reserves tile fills after /wallet-reserves resolves', async () => {
  const w = mountLive({ summary: SUMMARY, reserves: { cash: 839.51, escrow: 13456.83 },
                        summaryDelay: 10, reservesDelay: 30 });
  // Wait for render() then for reserves to fill (spinner disappears)
  await waitFor(() => getNameEl(w) !== null);
  await waitFor(() => w.document.querySelector('.reserves-loading') === null);
  assert.equal(w.document.querySelector('.reserves-loading'), null, 'spinner gone');
  const rbText = getReservesBody(w) && getReservesBody(w).textContent || '';
  assert.ok(rbText.includes('840') || rbText.includes('839'), 'cash value rendered');
});

test('reserves failure leaves the rest of the dashboard intact', async () => {
  const w = mountLive({ summary: SUMMARY, reserves: {}, reservesReject: true,
                        summaryDelay: 10, reservesDelay: 10 });
  // Wait for render() then for failure text to appear in #reserves-body
  await waitFor(() => getNameEl(w) !== null);
  await waitFor(() => {
    const rb = getReservesBody(w);
    return rb && rb.textContent.toLowerCase().includes('unavailable');
  });
  assert.ok(getNameEl(w).textContent.includes('Marek LLC'), 'dashboard still rendered');
  assert.ok(getReservesBody(w).textContent.toLowerCase().includes('unavailable'), 'reserves shows unavailable');
});

test('reserves-before-render: data held in state and applied when summary renders', async () => {
  // reserves resolves (10ms) before summary (100ms) — fillReserves no-ops on missing
  // #reserves-body, value sits in state.reserves, re-applied at end of render()
  const w = mountLive({ summary: SUMMARY, reserves: { cash: 839.51, escrow: 13456.83 },
                        reservesDelay: 10, summaryDelay: 100 });
  // Wait for render() to run (header name appears)
  await waitFor(() => getNameEl(w) && getNameEl(w).textContent.includes('Marek'));
  // render() calls fillReserves(state.reserves) synchronously at the end — spinner should be gone immediately
  await waitFor(() => w.document.querySelector('.reserves-loading') === null);
  const rbText = getReservesBody(w) && getReservesBody(w).textContent || '';
  assert.ok(rbText.includes('839') || rbText.includes('840'), 'cash value rendered after race');
  assert.equal(w.document.querySelector('.reserves-loading'), null, 'no reserves spinner remaining');
});
