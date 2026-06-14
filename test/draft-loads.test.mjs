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
    var u = String(url);
    var body;
    if (u.indexOf('/draft-loads/resolve-customer') !== -1) {
      body = { exact: false, source: 'TMS',
        best: { customer_id: '1', name: 'DINE SOUTH LLC', score: 0.89 },
        candidates: [{ customer_id: '1', name: 'DINE SOUTH LLC', score: 0.89 }] };
    } else if (u.indexOf('/draft-loads/resolve-carrier') !== -1) {
      body = { vendor_id: 'v2', matched_on: 'mc', conflict: false };
    } else if (u.indexOf('/draft-loads/submit') !== -1) {
      body = { submitted: ['900'], skipped: [], count: 1 };
    } else if (u.indexOf('/draft-loads/alias') !== -1) {
      body = { ok: true };
    } else if (/\/draft-loads\/\d+/.test(u)) {
      body = { status: 'ready', reasons: [] };
    } else if (u.indexOf('/draft-loads') !== -1) {
      body = { drafts: DRAFTS, count: 2, summary: { total: 2, ready: 1, attention: 1 } };
    } else if (u.indexOf('/tms-customers') !== -1) {
      body = { customers: [
        { customer_id: '1', customer_name: 'DINE SOUTH LLC' },
        { customer_id: '2', customer_name: 'PEPSICO INC' }
      ], count: 2 };
    } else if (u.indexOf('/tms-carriers') !== -1) {
      body = { carriers: [
        { vendor_id: 'v1', carrier_name: 'SWIFT HAUL LLC', mc: '982341', dnu: false },
        { vendor_id: 'v2', carrier_name: 'RELIANT', mc: '771204', dnu: false }
      ], count: 2 };
    } else {
      body = {};
    }
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

// ---- Task 16 ----
test('computeGroups groups attention drafts by distinct customer_raw with counts', () => {
  const { window } = makeWidget();
  const drafts = [
    { id: '1', status: 'attention', reasons: ['customer'], customer_name: '', customer_raw: 'Krogers', source: 'TMS' },
    { id: '2', status: 'attention', reasons: ['customer'], customer_name: '', customer_raw: 'Krogers', source: 'TMS' },
    { id: '3', status: 'attention', reasons: ['customer'], customer_name: '', customer_raw: 'Dine South', source: 'TMS' }
  ];
  const groups = window.computeGroups(drafts, 'customer');
  assert.equal(groups.length, 2);
  const krog = groups.find(g => g.raw === 'Krogers');
  assert.equal(krog.count, 2);
  assert.deepEqual([...krog.ids].sort(), ['1', '2']);
});

test('computeGroups for carriers groups by carrier_raw', () => {
  const { window } = makeWidget();
  const drafts = [
    { id: '1', status: 'attention', reasons: ['carrier'], carrier_name: '', carrier_raw: 'DOT 339', source: 'TMS' },
    { id: '2', status: 'attention', reasons: ['carrier'], carrier_name: '', carrier_raw: 'DOT 339', source: 'TMS' }
  ];
  const groups = window.computeGroups(drafts, 'carrier');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 2);
});

test('applyGroup PATCHes every id + one alias call when remember', async () => {
  const { window, records } = makeWidget();
  await window.applyGroup('Dine South Restaurant Grp', '1', ['901', '902'], true, 'customer');
  const patches = records.filter(r => /\/draft-loads\/\d+$/.test(r.url) && r.opts.method === 'PATCH');
  assert.equal(patches.length, 2);
  const aliases = records.filter(r => r.url.indexOf('/draft-loads/alias') !== -1);
  assert.equal(aliases.length, 1);
});

test('applyGroup with remember=false issues no alias call', async () => {
  const { window, records } = makeWidget();
  await window.applyGroup('Dine South', '1', ['901'], false, 'customer');
  const aliases = records.filter(r => r.url.indexOf('/draft-loads/alias') !== -1);
  assert.equal(aliases.length, 0);
});

// ---- Task 17 ----
test('clicking a flagged customer cell yields an inline select', () => {
  const { window } = makeWidget();
  window.renderQueue(DRAFTS);
  const rows = window.document.querySelectorAll('#queue-body tr');
  const cell = rows[1].querySelector('[data-edit="customer"]');
  assert.ok(cell);
  cell.click();
  assert.ok(rows[1].querySelector('select.cell'));
});

test('bulk-select shows the bar with the correct count', () => {
  const { window } = makeWidget();
  window.renderQueue(DRAFTS);
  const cbs = window.document.querySelectorAll('#queue-body input.rowcb');
  cbs[0].checked = true; cbs[0].dispatchEvent(new window.Event('change', { bubbles: true }));
  cbs[1].checked = true; cbs[1].dispatchEvent(new window.Event('change', { bubbles: true }));
  const bar = window.document.getElementById('bulkbar');
  assert.ok(!bar.classList.contains('hidden'));
  assert.match(bar.textContent, /2 selected/);
});

test('bulk Set customer PATCHes all selected ids', async () => {
  const { window, records } = makeWidget();
  window.__state.selected = ['900', '901'];
  await window.bulkSetCustomer('1');
  const patches = records.filter(r => /\/draft-loads\/\d+$/.test(r.url) && r.opts.method === 'PATCH');
  assert.equal(patches.length, 2);
});

// ---- Task 18 ----
test('submit-all posts only ready ids', async () => {
  const { window, records } = makeWidget();
  window.__state.drafts = DRAFTS;
  await window.submitAllReady();
  const sub = records.find(r => r.url.indexOf('/draft-loads/submit') !== -1);
  assert.ok(sub);
  const body = JSON.parse(sub.opts.body);
  assert.deepEqual([...body.ids], ['900']);
});

test('per-row submit posts a single id', async () => {
  const { window, records } = makeWidget();
  await window.submitOne('900');
  const sub = records.find(r => r.url.indexOf('/draft-loads/submit') !== -1);
  const body = JSON.parse(sub.opts.body);
  assert.deepEqual([...body.ids], ['900']);
});

test('skipped ids surface their reasons', () => {
  const { window } = makeWidget();
  window.handleSubmitResult({ submitted: ['900'], skipped: [{ id: '901', reasons: ['customer'] }], count: 1 });
  const toast = window.document.getElementById('toast').textContent;
  assert.match(toast, /1/);
  assert.match(toast, /customer/);
  assert.ok(window.__state.lastSkipped && window.__state.lastSkipped.length === 1);
});
