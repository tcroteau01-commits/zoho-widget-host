// Every record in "All" must be reachable by some chip.
//
// The bug: buildChips() rendered a hardcoded six — All, Processing, On Hold,
// Verifying NOA, Verifying Invoice, Purchased — while allRecords also carries
// Draft and Pending Docs, and statusMeta() buckets anything unrecognised as
// 'unknown'. Those rows counted toward "All", Total Submissions and Total Volume,
// but no filter reached them. On the demo account that read "All 7" with chips
// summing to 4, and three rows that appeared under no chip at all.
//
// The fix appends a chip for any status actually present that the core list does
// not cover, so a status added to the Creator form later surfaces on its own
// rather than silently going missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../history.html', import.meta.url), 'utf8');

function makeDom() {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/history.html?serviceOrigin=https://brokerhub.operfi.com',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ records: [] }) });
    }
  });
  return dom.window;
}

const rec = (id, status) => ({
  ID: String(id), Purchase_Status: status,
  Customer_Reference_Number: 'REF-' + id, Customer_Rate: '1000', Carrier_Rate: '900',
});

/** Render the chip bar over a given record set and read back key -> count. */
function chipsFor(w, records) {
  w.__setRecords(records);
  w.buildChips();
  const out = {};
  w.document.querySelectorAll('#chips .chip').forEach((el) => {
    out[el.dataset.key] = Number(el.querySelector('.count').textContent);
  });
  return out;
}

test('the demo account case: All equals the sum of the other chips', () => {
  const w = makeDom();
  // Exactly what was on screen: 3 drafts, one of each hold state, one purchased.
  const records = [
    rec(1, 'Draft'), rec(2, 'Draft'), rec(3, 'Draft'),
    rec(4, 'On Hold'),
    rec(5, 'On Hold - Need NOA Verification'),
    rec(6, 'On Hold - Need Invoice Verification'),
    rec(7, 'Purchased'),
  ];
  const chips = chipsFor(w, records);
  assert.equal(chips.all, 7);
  const summed = Object.keys(chips)
    .filter((k) => k !== 'all')
    .reduce((n, k) => n + chips[k], 0);
  assert.equal(summed, 7, `chips sum to ${summed}, leaving ${7 - summed} rows unreachable`);
});

test('a Draft chip appears once drafts are present', () => {
  const w = makeDom();
  const chips = chipsFor(w, [rec(1, 'Draft'), rec(2, 'Purchased')]);
  assert.equal(chips.draft, 1);
});

test('Pending Docs gets a chip too', () => {
  const w = makeDom();
  const chips = chipsFor(w, [rec(1, 'Pending Docs'), rec(2, 'Purchased')]);
  assert.equal(chips['pending-docs'], 1);
});

test('a status nobody has mapped still gets a chip rather than vanishing', () => {
  const w = makeDom();
  const chips = chipsFor(w, [rec(1, 'Some Future Status'), rec(2, 'Purchased')]);
  assert.equal(chips.unknown, 1, 'an unmapped status must remain reachable');
});

test('the core chips still render at zero', () => {
  // "Processing 0" is information. Appending must not turn the bar into
  // only-what-exists.
  const w = makeDom();
  const chips = chipsFor(w, [rec(1, 'Purchased')]);
  ['all', 'processing', 'hold', 'verifying-noa', 'verifying-inv', 'purchased']
    .forEach((k) => assert.ok(k in chips, `core chip ${k} missing`));
  assert.equal(chips.processing, 0);
  assert.ok(!('draft' in chips), 'no drafts present, so no Draft chip');
});

test('filtering to an appended chip returns exactly those rows', () => {
  const w = makeDom();
  const records = [rec(1, 'Draft'), rec(2, 'Draft'), rec(3, 'Purchased')];
  chipsFor(w, records);
  w.__setStatus('draft');
  const shown = records.filter((r) => w.statusMeta(r).key === w.__getStatus());
  assert.equal(shown.length, 2);
});

test('narrowing the range past the active chip falls back to All', () => {
  // Otherwise currentStatus points at a chip that no longer exists: an empty list
  // with nothing highlighted and no way to tell why.
  const w = makeDom();
  chipsFor(w, [rec(1, 'Draft')]);
  w.__setStatus('draft');
  chipsFor(w, [rec(2, 'Purchased')]);   // drafts drop out of range
  assert.equal(w.__getStatus(), 'all');
});

test('the On Hold KPI is labelled as the rollup it actually is', () => {
  // It sums On Hold + Verifying NOA + Verifying Invoice, so a card reading
  // "On Hold 3" sat directly above a chip reading "On Hold 1" — the same words
  // with different numbers, which reads as the page contradicting itself.
  const w = makeDom();
  const label = w.document.querySelector('#kpi-hold')
    .closest('.kpi').querySelector('.kpi-label').textContent;
  assert.match(label, /verifying/i, `KPI label "${label}" does not say it is a rollup`);
});

test('the On Hold KPI still counts all three held states', () => {
  const w = makeDom();
  w.__setRecords([
    rec(1, 'On Hold'),
    rec(2, 'On Hold - Need NOA Verification'),
    rec(3, 'On Hold - Need Invoice Verification'),
    rec(4, 'Purchased'),
  ]);
  w.renderKpis();
  assert.equal(w.document.getElementById('kpi-hold').textContent, '3');
});
