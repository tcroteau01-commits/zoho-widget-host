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

const ROW = { ID: '1', Purchase_Status: 'Purchased', Added_Time: '13-Jul-2026 06:40:15',
  Load_Rate_Confirmation_Number: '4471902', Customer_Reference_Number: 'PO-88213',
  Customer_Rate: '1000', Carrier_Rate: '900' };

test('rowHtml renders Load # as a labeled primary cell', () => {
  const w = makeDom();
  const html = w.rowHtml(ROW, 0);
  assert.match(html, /<div class="cell-label">Load #<\/div><div class="cell-val">4471902<\/div>/);
});

test('Load # is no longer a subordinate cell-sub line', () => {
  const w = makeDom();
  assert.doesNotMatch(w.rowHtml(ROW, 0), /cell-sub">Load#/);
});

test('Ref# stays in the Customer cell as a cell-sub', () => {
  const w = makeDom();
  assert.match(w.rowHtml(ROW, 0), /cell-sub">Ref# PO-88213/);
});

test('Load # cell comes first in the row', () => {
  const w = makeDom();
  const html = w.rowHtml(ROW, 0);
  assert.ok(html.indexOf('Load #') < html.indexOf('Customer'), 'Load # should precede Customer');
});

test('a missing Load # renders an em dash, not "undefined"', () => {
  const w = makeDom();
  const html = w.rowHtml({ ID: '2', Purchase_Status: 'Purchased', Added_Time: '13-Jul-2026 06:40:15' }, 0);
  assert.match(html, /<div class="cell-label">Load #<\/div><div class="cell-val">—<\/div>/);
  assert.doesNotMatch(html, /undefined/);
});
