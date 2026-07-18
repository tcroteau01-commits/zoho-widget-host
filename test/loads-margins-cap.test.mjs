import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../loads-margins.html', import.meta.url), 'utf8');

// A backend /loads response: `loads` is the (possibly capped) row list, while
// `totals` + `total` describe the WHOLE date window. The bug being fixed: the
// widget summed the row list for its KPI cards, so a window with more loads
// than the returned rows showed understated Loads / Purchase / Margin.
function makeDom() {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/loads-margins.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = () => new Promise(() => {});
    },
  });
  return dom.window;
}

function renderLoads(w, loadsData, filterOverrides) {
  w.state.currentTab = 'loads';
  w.state.loadsLoading = false;
  w.state.loadsData = loadsData;
  Object.assign(w.state.loadsFilters, { vendor: '', loadId: '' }, filterOverrides || {});
  w.renderShell();
  return w.document.getElementById('loadsResultsWrap');
}

// Window with 6,143 loads but only the newest 5,000 rows shipped to the browser.
function cappedPayload() {
  const loads = [];
  for (let i = 0; i < 5000; i++) {
    loads.push({ loadId: String(i), loadNumber: String(i), buyDate: '2026-06-01',
                 debtorId: '1', debtorName: 'ACME', vendorName: 'CARRIER ' + i,
                 purchaseAmount: 100, margin: 15, marginPct: 15 });
  }
  return {
    loads,
    total: 6143,
    totals: { count: 6143, purchaseAmount: 921450, margin: 138217.5, marginPct: 15 },
  };
}

test('KPI cards use the full-window server totals, not the returned row count', () => {
  const w = makeDom();
  const wrap = renderLoads(w, cappedPayload());
  const cards = wrap.querySelectorAll('.kpi-card .kpi-value');
  // Loads / Purchase / Margin / Margin%
  assert.equal(cards[0].textContent, '6,143', 'Loads card must show the full-window count');
  assert.equal(cards[1].textContent, '$921,450', 'Purchase must cover the whole window');
  assert.equal(cards[2].textContent, '$138,218', 'Margin must cover the whole window');
  assert.equal(cards[3].textContent, '15.0%');
});

test('a truncation note is shown when the row list is capped below the window total', () => {
  const w = makeDom();
  const wrap = renderLoads(w, cappedPayload());
  const txt = wrap.textContent;
  assert.match(txt, /5,000/);
  assert.match(txt, /6,143/);
  assert.match(txt, /Export/i, 'note should point to Export for the full set');
});

test('no truncation note when the returned rows cover the whole window', () => {
  const w = makeDom();
  const loads = [
    { loadId: '1', loadNumber: '1', buyDate: '2026-06-01', debtorId: '1',
      debtorName: 'ACME', vendorName: 'X', purchaseAmount: 100, margin: 15, marginPct: 15 },
    { loadId: '2', loadNumber: '2', buyDate: '2026-06-02', debtorId: '1',
      debtorName: 'ACME', vendorName: 'Y', purchaseAmount: 200, margin: 20, marginPct: 10 },
  ];
  const wrap = renderLoads(w, {
    loads, total: 2,
    totals: { count: 2, purchaseAmount: 300, margin: 35, marginPct: 11.6667 },
  });
  assert.doesNotMatch(wrap.textContent, /Showing the newest/i);
  const cards = wrap.querySelectorAll('.kpi-card .kpi-value');
  assert.equal(cards[0].textContent, '2');
});

test('an active vendor/load search narrows the KPI cards to the matched subset', () => {
  const w = makeDom();
  // Server totals describe the whole window, but a search must reflect matches.
  const loads = [
    { loadId: '1', loadNumber: '1', buyDate: '2026-06-01', debtorId: '1',
      debtorName: 'ACME', vendorName: 'ALPHA LOGISTICS', purchaseAmount: 100, margin: 15, marginPct: 15 },
    { loadId: '2', loadNumber: '2', buyDate: '2026-06-02', debtorId: '1',
      debtorName: 'ACME', vendorName: 'BETA FREIGHT', purchaseAmount: 200, margin: 20, marginPct: 10 },
  ];
  const wrap = renderLoads(w, {
    loads, total: 500,
    totals: { count: 500, purchaseAmount: 999999, margin: 111111, marginPct: 11.1 },
  }, { vendor: 'alpha' });
  const cards = wrap.querySelectorAll('.kpi-card .kpi-value');
  assert.equal(cards[0].textContent, '1', 'search count is the matched subset, not 500');
  assert.equal(cards[1].textContent, '$100', 'search purchase is the subset, not the window total');
});

test('fetchLoads requests the whole window in one call (pageSize=5000)', () => {
  const w = makeDom();
  let capturedUrl = '';
  w.fetch = function (url) { capturedUrl = url; return new Promise(() => {}); };
  w.state.clientId = '6556';
  w.fetchLoads();
  assert.match(capturedUrl, /[?&]pageSize=5000\b/, 'fetchLoads must send pageSize=5000');
});
