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
