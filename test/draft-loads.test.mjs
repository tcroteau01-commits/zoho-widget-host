import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../draft-loads.html', import.meta.url), 'utf8');

const DRAFTS = [
  { id: '900', status: 'ready', reasons: [], source: 'CSV',
    customer_name: 'PEPSICO INC', customer_raw: '',
    carrier_name: 'SWIFT HAUL LLC', carrier_mc: '982341', carrier_raw: '',
    customer_rate: '2850', carrier_rate: '2400',
    has_customer_docs: true, has_carrier_docs: true, customer_reference_number: 'CRX-44910' },
  { id: '901', status: 'attention', reasons: ['customer', 'customer_docs'], source: 'TMS',
    customer_name: '', customer_raw: 'Dine South Restaurant Grp',
    carrier_name: 'RELIANT', carrier_mc: '771204', carrier_raw: '',
    customer_rate: '1920', carrier_rate: '1650',
    has_customer_docs: false, has_carrier_docs: false }
];

function makeFetch(records) {
  return function (url, opts) {
    records.push({ url: String(url), opts: opts || {} });
    var body = { drafts: DRAFTS, count: 2, summary: { total: 2, ready: 1, attention: 1 } };
    return Promise.resolve({ json: function () { return Promise.resolve(body); } });
  };
}

function makeWidget() {
  const records = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/draft-loads.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = makeFetch(records);
    }
  });
  return { window: dom.window, records };
}

test('renderQueue: one row per draft + chip classes', () => {
  const { window } = makeWidget();
  window.renderQueue(DRAFTS);
  const rows = window.document.querySelectorAll('#queue-body tr');
  assert.equal(rows.length, 2);
  assert.ok(window.document.querySelector('.stat.ready'));
  assert.ok(window.document.querySelector('.stat.attn'));
});

test('renderQueue: margin = customer_rate - carrier_rate', () => {
  const { window } = makeWidget();
  window.renderQueue(DRAFTS);
  assert.match(window.document.querySelector('#queue-body').textContent, /\$450/);
  assert.match(window.document.querySelector('#queue-body').textContent, /\$270/);
});

test('renderQueue: resolved customer shows name, unresolved shows raw', () => {
  const { window } = makeWidget();
  window.renderQueue(DRAFTS);
  const body = window.document.querySelector('#queue-body').textContent;
  assert.match(body, /PEPSICO INC/);
  assert.match(body, /Dine South Restaurant Grp/);
});

test('renderQueue: docs cell counts both flags, ok class when both', () => {
  const { window } = makeWidget();
  window.renderQueue(DRAFTS);
  const rows = window.document.querySelectorAll('#queue-body tr');
  assert.ok(rows[0].querySelector('.docs.ok'));
  assert.match(rows[0].textContent, /2/);
  assert.ok(!rows[1].querySelector('.docs.ok'));
});

test('source badge per row', () => {
  const { window } = makeWidget();
  window.renderQueue(DRAFTS);
  assert.ok(window.document.querySelector('.src.csv'));
  assert.ok(window.document.querySelector('.src.tms'));
});

test('filter chips narrow the in-memory list', () => {
  const { window } = makeWidget();
  window.__state.drafts = DRAFTS;
  window.setFilter('attention');
  let rows = window.document.querySelectorAll('#queue-body tr');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /Dine South/);
  window.setFilter('ready');
  rows = window.document.querySelectorAll('#queue-body tr');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /PEPSICO/);
  window.setFilter('all');
  rows = window.document.querySelectorAll('#queue-body tr');
  assert.equal(rows.length, 2);
});

test('submit-all button label reflects ready count', () => {
  const { window } = makeWidget();
  window.renderSummary({ total: 2, ready: 1, attention: 1 });
  assert.match(window.document.getElementById('submit-all').textContent, /1/);
});
