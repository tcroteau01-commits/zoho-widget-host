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

test('summary fills tiles while reserves tile still shows a spinner', async () => {
  const w = mountLive({ summary: SUMMARY, reserves: { cash: 5, escrow: 6 },
                        summaryDelay: 10, reservesDelay: 200 });
  await wait(60);                                   // summary in, reserves still pending
  assert.ok(w.document.body.textContent.includes('Marek LLC'), 'account name rendered');
  assert.ok(w.document.querySelector('.reserves-loading'), 'reserves spinner still showing');
});

test('reserves tile fills after /wallet-reserves resolves', async () => {
  const w = mountLive({ summary: SUMMARY, reserves: { cash: 839.51, escrow: 13456.83 },
                        summaryDelay: 10, reservesDelay: 30 });
  await wait(150);
  assert.equal(w.document.querySelector('.reserves-loading'), null, 'spinner gone');
  assert.ok(w.document.body.textContent.includes('840') || w.document.body.textContent.includes('839'),
            'cash value rendered');
});

test('reserves failure leaves the rest of the dashboard intact', async () => {
  const w = mountLive({ summary: SUMMARY, reserves: {}, reservesReject: true,
                        summaryDelay: 10, reservesDelay: 10 });
  await wait(60);
  assert.ok(w.document.body.textContent.includes('Marek LLC'), 'dashboard still rendered');
  assert.ok(w.document.body.textContent.toLowerCase().includes('unavailable'), 'reserves shows unavailable');
});
