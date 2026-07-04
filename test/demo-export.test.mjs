import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
const impJs = fs.readFileSync(new URL('../operfi-impersonate.js', import.meta.url), 'utf8');
const ledgerJs = fs.readFileSync(new URL('../demo-ledger.js', import.meta.url), 'utf8');
const dataJs = fs.readFileSync(new URL('../demo-data.js', import.meta.url), 'utf8');

function boot() {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://x.github.io/' });
  const w = dom.window;
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
  w.eval(impJs); w.localStorage.setItem('operfiImpersonate', 'demo@operfi.com');
  w.eval(ledgerJs); w.eval(dataJs);
  return w;
}

// Poll a condition on real timers, up to `timeout` ms.
async function waitFor(fn, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('waitFor: condition never became true');
}

test('csvFromRows produces a header row plus one row per record, quoting commas', () => {
  const w = boot();
  const csv = w.OPERFI_DEMO.csvFromRows([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], [{ a: 'x,y', b: 2 }]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'A,B');
  assert.equal(lines[1], '"x,y",2');
});

test('downloadCSV triggers exactly one anchor click with a blob: href', () => {
  const w = boot();
  let clicked = 0;
  const realCreate = w.document.createElement.bind(w.document);
  w.document.createElement = (tag) => {
    const el = realCreate(tag);
    if (tag === 'a') { const realClick = el.click.bind(el); el.click = () => { clicked++; assert.ok(el.href.startsWith('blob:')); }; }
    return el;
  };
  w.URL.createObjectURL = () => 'blob:mock';
  w.URL.revokeObjectURL = () => {};
  w.OPERFI_DEMO.downloadCSV('test.csv', 'A,B\r\n1,2');
  assert.equal(clicked, 1);
});

// ── aging.html widget wiring ────────────────────────────────────────────────
// aging.html's init() only calls fetchAging() after ZOHO.CREATOR.UTIL.getInitParams()
// resolves with a loginUser (mirrors real usage: an OperFi admin logs in via
// Creator, THEN impersonates the demo account via localStorage). The stub below
// resolves promptly instead of hanging, matching that real flow.
//
// aging.html loads operfi-impersonate.js/demo-ledger.js/demo-data.js via
// external <script src> tags pointed at app.operfi.com; jsdom does not fetch
// or execute those without a live network + `resources: 'usable'`, so we eval
// the same source jsdom would have loaded directly onto the window before
// parsing continues (beforeParse runs before the widget's own inline <script>
// executes, so OPERFI_IMP/OPERFI_DEMO/OPERFI_DEMO_LEDGER are ready in time).
function makeAgingDom(onWindowOpen) {
  const html = fs.readFileSync(new URL('../aging.html', import.meta.url), 'utf8');
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/aging.html',
    beforeParse(window) {
      window.scrollTo = () => {};
      // jsdom has no fetch/Blob-URL implementation by default; stub the bits
      // operfi-impersonate.js's own admin-bar check (a plain window.fetch
      // call) and downloadCSV (URL.createObjectURL) need to run without error.
      window.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
      window.URL.createObjectURL = () => 'blob:mock';
      window.URL.revokeObjectURL = () => {};
      window.eval(impJs);
      window.eval(ledgerJs);
      window.eval(dataJs);
      window.localStorage.setItem('operfiImpersonate', 'demo@operfi.com');
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => Promise.resolve({ loginUser: 'admin@operfi.com' }) } } };
      window.open = () => { onWindowOpen(); };
    }
  });
}

test('aging.html demo-mode CSV export (summary + detail scopes) calls downloadCSV instead of window.open', async () => {
  let windowOpenCalled = false;
  const dom = makeAgingDom(() => { windowOpenCalled = true; });
  const w = dom.window;
  try {
    w.dispatchEvent(new w.Event('load'));
    await waitFor(() => w.document.getElementById('summaryExportBtn'));

    let downloadCalled = 0;
    const origDownload = w.OPERFI_DEMO.downloadCSV;
    w.OPERFI_DEMO.downloadCSV = (...args) => { downloadCalled++; return origDownload(...args); };

    // Open the export menu, then click Summary CSV.
    w.document.getElementById('summaryExportBtn').click();
    let btn = w.document.querySelector('[data-export-format="csv"][data-export-scope="summary"]');
    assert.ok(btn, 'summary CSV export button with data-export-format/scope must exist');
    btn.click();
    assert.equal(downloadCalled, 1);
    assert.equal(windowOpenCalled, false);

    // Re-open the menu (it closes itself after each click) and exercise the
    // "detail" scope too, since it dispatches through the same demo branch.
    w.document.getElementById('summaryExportBtn').click();
    btn = w.document.querySelector('[data-export-format="csv"][data-export-scope="detail"]');
    assert.ok(btn, 'detail CSV export button with data-export-format/scope must exist');
    btn.click();
    assert.equal(downloadCalled, 2);
    assert.equal(windowOpenCalled, false);
  } finally { w.close(); }
});

test('aging.html demo-mode CSV export (receipts scope) calls downloadCSV instead of window.open', async () => {
  let windowOpenCalled = false;
  const dom = makeAgingDom(() => { windowOpenCalled = true; });
  const w = dom.window;
  try {
    w.dispatchEvent(new w.Event('load'));
    await waitFor(() => w.document.querySelector('.tab-strip button[data-tab="receipts"]'));

    let downloadCalled = 0;
    const origDownload = w.OPERFI_DEMO.downloadCSV;
    w.OPERFI_DEMO.downloadCSV = (...args) => { downloadCalled++; return origDownload(...args); };

    w.document.querySelector('.tab-strip button[data-tab="receipts"]').click();
    await waitFor(() => w.document.getElementById('receiptsExportBtn'));
    w.document.getElementById('receiptsExportBtn').click();
    const btn = w.document.querySelector('[data-export-format="csv"][data-export-scope="receipts"]');
    assert.ok(btn, 'receipts CSV export button with data-export-format/scope must exist');
    btn.click();
    assert.equal(downloadCalled, 1);
    assert.equal(windowOpenCalled, false);
  } finally { w.close(); }
});

// ── loads-margins.html widget wiring ────────────────────────────────────────
// loads-margins.html's bootstrap() runs synchronously at parse time (not gated
// behind a window "load" event) and calls ZOHO.CREATOR.UTIL.getInitParams()
// directly, so the stub just needs to resolve promptly.
function makeLoadsMarginsDom(onWindowOpen) {
  const html = fs.readFileSync(new URL('../loads-margins.html', import.meta.url), 'utf8');
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/loads-margins.html',
    beforeParse(window) {
      window.scrollTo = () => {};
      // jsdom has no fetch/Blob-URL implementation by default; stub the bits
      // operfi-impersonate.js's own admin-bar check (a plain window.fetch
      // call) and downloadCSV (URL.createObjectURL) need to run without error.
      window.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
      window.URL.createObjectURL = () => 'blob:mock';
      window.URL.revokeObjectURL = () => {};
      window.eval(impJs);
      window.eval(ledgerJs);
      window.eval(dataJs);
      window.localStorage.setItem('operfiImpersonate', 'demo@operfi.com');
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => Promise.resolve({ loginUser: 'admin@operfi.com' }) } } };
      window.open = () => { onWindowOpen(); };
    }
  });
}

test('loads-margins.html demo-mode CSV export (loads tab) calls downloadCSV instead of window.open', async () => {
  let windowOpenCalled = false;
  const dom = makeLoadsMarginsDom(() => { windowOpenCalled = true; });
  const w = dom.window;
  try {
    await waitFor(() => w.document.getElementById('loadsExportBtn'));

    let downloadCalled = 0;
    const origDownload = w.OPERFI_DEMO.downloadCSV;
    w.OPERFI_DEMO.downloadCSV = (...args) => { downloadCalled++; return origDownload(...args); };

    w.document.getElementById('loadsExportBtn').click();
    const btn = w.document.querySelector('[data-export-format="csv"][data-export-scope="loads"]');
    assert.ok(btn, 'loads CSV export button with data-export-format/scope must exist');
    btn.click();
    assert.equal(downloadCalled, 1);
    assert.equal(windowOpenCalled, false);
  } finally { w.close(); }
});

test('loads-margins.html demo-mode CSV export (margins tab) calls downloadCSV instead of window.open', async () => {
  let windowOpenCalled = false;
  const dom = makeLoadsMarginsDom(() => { windowOpenCalled = true; });
  const w = dom.window;
  try {
    await waitFor(() => w.document.querySelector('button[data-tab="margins"]'));
    w.document.querySelector('button[data-tab="margins"]').click();
    await waitFor(() => w.document.getElementById('marginsExportBtn'));

    let downloadCalled = 0;
    const origDownload = w.OPERFI_DEMO.downloadCSV;
    w.OPERFI_DEMO.downloadCSV = (...args) => { downloadCalled++; return origDownload(...args); };

    w.document.getElementById('marginsExportBtn').click();
    const btn = w.document.querySelector('[data-export-format="csv"][data-export-scope="margins"]');
    assert.ok(btn, 'margins CSV export button with data-export-format/scope must exist');
    btn.click();
    assert.equal(downloadCalled, 1);
    assert.equal(windowOpenCalled, false);
  } finally { w.close(); }
});

test('loads-margins.html demo-mode CSV export (fees tab) calls downloadCSV instead of window.open', async () => {
  let windowOpenCalled = false;
  const dom = makeLoadsMarginsDom(() => { windowOpenCalled = true; });
  const w = dom.window;
  try {
    await waitFor(() => w.document.querySelector('button[data-tab="fees"]'));
    w.document.querySelector('button[data-tab="fees"]').click();
    await waitFor(() => w.document.getElementById('feesExportBtn'));

    let downloadCalled = 0;
    const origDownload = w.OPERFI_DEMO.downloadCSV;
    w.OPERFI_DEMO.downloadCSV = (...args) => { downloadCalled++; return origDownload(...args); };

    w.document.getElementById('feesExportBtn').click();
    const btn = w.document.querySelector('[data-export-format="csv"][data-export-scope="fees"]');
    assert.ok(btn, 'fees CSV export button with data-export-format/scope must exist');
    btn.click();
    assert.equal(downloadCalled, 1);
    assert.equal(windowOpenCalled, false);
  } finally { w.close(); }
});
