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

const BASE = { ID: '1', Purchase_Status: 'Purchased', Load_Rate_Confirmation_Number: '4471902',
  Customer_Reference_Number: 'PO-88213', Customer_Rate: '1000', Carrier_Rate: '900' };

const row = (w, addedTime) => w.rowHtml({ ...BASE, Added_Time: addedTime }, 0);

test('the submitted time carries a CT zone label', () => {
  const w = makeDom();
  assert.match(row(w, '14-Jul-2026 10:34:16'), /10:34 AM CT/);
});

test('the time digits are labeled, never shifted', () => {
  const w = makeDom();
  const html = row(w, '14-Jul-2026 10:34:16');
  // This exact-digit assertion is the load-bearing guard. Added_Time is already Central wall
  // clock, so we LABEL it rather than convert it; parseDate builds a local-naive Date on purpose,
  // which preserves these digits for every viewer regardless of their own timezone. If someone
  // later "fixes" parseDate into a real timezone conversion, the digits shift and this fails.
  assert.match(html, /cell-val">10:34 AM CT</);
  // Spelled out because it is the most likely form of that regression: parsing Added_Time as an
  // absolute instant makes 10:34 CDT render as 15:34 UTC.
  assert.doesNotMatch(html, /3:34 PM/);
});

test('a late-evening time does not roll to another day or hour', () => {
  const w = makeDom();
  assert.match(row(w, '14-Jul-2026 23:15:00'), /11:15 PM CT/);
});

// "CST" would be wrong Mar-Nov: US/Central observes DST and is CDT for most of the year.
test('the label is the DST-safe "CT", not "CST" or "CDT"', () => {
  const w = makeDom();
  const html = row(w, '14-Jul-2026 10:34:16');
  assert.doesNotMatch(html, /CST|CDT/);
});

// Anchored to the Submitted cell rather than scanning the whole row: a bare /CT/ would false-fail
// on any fixture with a carrier like "ACT TRANSPORT" or a Connecticut customer.
const submittedCell = /Submitted<\/div><div class="cell-val">([^<]*)</;

// Bulk-imported records have no real submit time — they must not gain a fabricated "12:00 AM CT".
test('a midnight bulk-import row still renders an em dash, unlabeled', () => {
  const w = makeDom();
  const cell = row(w, '14-Jul-2026 00:00:00').match(submittedCell)[1];
  assert.equal(cell, '—');
});

test('a missing Added_Time still renders an em dash, unlabeled', () => {
  const w = makeDom();
  const cell = w.rowHtml({ ...BASE }, 0).match(submittedCell)[1];
  assert.equal(cell, '—');
});
