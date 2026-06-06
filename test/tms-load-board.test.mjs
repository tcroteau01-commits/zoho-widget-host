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
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/tms-load-board.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = () => Promise.resolve({ json: () => Promise.resolve(LOADS) });
      Object.defineProperty(window, '_navTarget', { value: nav, writable: true });
    }
  });
  return { window: dom.window, nav };
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
