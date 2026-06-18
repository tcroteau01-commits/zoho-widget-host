import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../tms-load-board.html', import.meta.url), 'utf8');

const LOADS = { loads: [
  { id: 'l1', load_number: 'L-1', status: 'Booked', customer_name: 'Big Shipper',
    carrier_name: 'ROADWAY', lane: 'Dallas, TX → Atlanta, GA',
    invoice_amount: 2000, carrier_pay: 1500, margin: 500, added_time: '31-May-2026 09:00:00' },
  { id: 'l2', load_number: 'L-2', status: 'Delivered', customer_name: 'Small Co',
    carrier_name: 'MIDWEST', lane: 'Phoenix, AZ → Denver, CO',
    invoice_amount: 1000, carrier_pay: 900, margin: 100, added_time: '30-May-2026 09:00:00' },
], count: 2 };

function makeWidget() {
  const nav = [];
  const posts = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/tms-load-board.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = function(url, init) {
        if (init && init.method === 'POST') {
          posts.push({ url: url, body: JSON.parse(init.body) });
          if (String(url).indexOf('/tms-status-bulk') !== -1) {
            const ids = JSON.parse(init.body).load_ids || [];
            return Promise.resolve({ json: () => Promise.resolve({ ok: true, updated: ids, skipped: [] }) });
          }
          return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
        }
        return Promise.resolve({ json: () => Promise.resolve(LOADS) });
      };
      Object.defineProperty(window, '_navTarget', { value: nav, writable: true });
    }
  });
  return { window: dom.window, nav, posts };
}

test('renderBoard renders a row per load with margin', () => {
  const { window } = makeWidget();
  window.renderBoard(LOADS);
  const rows = window.document.querySelectorAll('#board-body tr');
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /L-1/);
  assert.match(rows[0].textContent, /Big Shipper/);
  assert.match(rows[0].textContent, /\$500/);
});

test('initial table shows a loading placeholder', () => {
  const { window } = makeWidget();
  const rows = window.document.querySelectorAll('#board-body tr');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /Loading/i);
});

test('empty loads renders empty state', () => {
  const { window } = makeWidget();
  window.renderBoard({ loads: [], count: 0 });
  const rows = window.document.querySelectorAll('#board-body tr');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /No loads/i);
});

test('status filter narrows the rendered rows', () => {
  const { window } = makeWidget();
  window.allLoads = LOADS.loads;
  window.activeStatus = 'Delivered';
  window.applyFilters();
  const rows = window.document.querySelectorAll('#board-body tr');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /L-2/);
});

test('search filters by load number / customer / carrier', () => {
  const { window } = makeWidget();
  window.allLoads = LOADS.loads;
  window.activeStatus = 'all';
  window.searchTerm = 'midwest';
  window.applyFilters();
  const rows = window.document.querySelectorAll('#board-body tr');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /L-2/);
});

test('selectForEdit stores id in localStorage bridge for the detail widget', () => {
  const { window } = makeWidget();
  window.selectForEdit('l1');
  const stored = JSON.parse(window.localStorage.getItem('tmsLoadTarget'));
  assert.equal(stored.load_id, 'l1');
  assert.equal(stored.mode, 'edit');
  assert.ok(stored.ts);
});

test('newLoad stores a create flag', () => {
  const { window } = makeWidget();
  window.newLoad();
  const stored = JSON.parse(window.localStorage.getItem('tmsLoadTarget'));
  assert.equal(stored.load_id, '');
  assert.equal(stored.mode, 'new');
});

test('default (all) view hides Cancelled loads; Draft is shown', () => {
  const { window } = makeWidget();
  window.allLoads = [
    { id: '1', load_number: 'L-1', status: 'Draft', customer_name: 'A', lane: '', carrier_name: '' },
    { id: '2', load_number: 'L-2', status: 'Cancelled', customer_name: 'B', lane: '', carrier_name: '' },
    { id: '3', load_number: 'L-3', status: 'Booked', customer_name: 'C', lane: '', carrier_name: '' },
  ];
  window.activeStatus = 'all';
  window.applyFilters();
  const text = window.document.getElementById('board-body').textContent;
  assert.match(text, /L-1/);
  assert.match(text, /L-3/);
  assert.ok(!/L-2/.test(text), 'Cancelled hidden by default');
});

test('Cancelled pill shows only cancelled loads', () => {
  const { window } = makeWidget();
  window.allLoads = [
    { id: '2', load_number: 'L-2', status: 'Cancelled', customer_name: 'B', lane: '', carrier_name: '' },
    { id: '3', load_number: 'L-3', status: 'Booked', customer_name: 'C', lane: '', carrier_name: '' },
  ];
  window.activeStatus = 'Cancelled';
  window.applyFilters();
  const rows = window.document.querySelectorAll('#board-body tr');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /L-2/);
});

test('applyFilters clears selection and hides bulk bar', () => {
  const { window } = makeWidget();
  window.brokerEmail = 'test@op.com';
  window.allLoads = [
    { id: '20', load_number: 'L-20', status: 'Booked', customer_name: 'A', lane: '', carrier_name: '' },
  ];
  window.activeStatus = 'all';
  window.applyFilters();
  // check a row to show the bulk bar
  const cb = window.document.querySelector('.row-checkbox[data-load-id="20"]');
  cb.checked = true;
  cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.ok(!window.document.getElementById('bulk-bar').classList.contains('hidden'), 'bar visible after check');
  // simulate a filter change (pill click or search)
  window.applyFilters();
  assert.ok(window.document.getElementById('bulk-bar').classList.contains('hidden'), 'bar hidden after applyFilters');
  assert.equal(window.selectedLoadIds.length, 0, 'selectedLoadIds cleared');
});

test('checking a row reveals the bulk bar and bulkApply posts selected ids', () => {
  const { window, posts } = makeWidget();
  window.brokerEmail = 'test@op.com';
  window.allLoads = [
    { id: '10', load_number: 'L-10', status: 'Booked', customer_name: 'A', lane: '', carrier_name: '' },
    { id: '11', load_number: 'L-11', status: 'Booked', customer_name: 'B', lane: '', carrier_name: '' },
  ];
  window.activeStatus = 'all';
  window.applyFilters();
  const cb = window.document.querySelector('.row-checkbox[data-load-id="10"]');
  cb.checked = true;
  cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.ok(!window.document.getElementById('bulk-bar').classList.contains('hidden'));
  window.document.getElementById('bulk-status').value = 'Dispatched';
  window.bulkApply();
  return Promise.resolve().then(() => {
    const last = posts.at(-1);
    assert.match(last.url, /\/tms-status-bulk/);
    assert.deepEqual(last.body.load_ids, ['10']);
    assert.equal(last.body.status, 'Dispatched');
  });
});
