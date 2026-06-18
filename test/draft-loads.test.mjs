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
        { customer_id: '1', customer_name: 'DINE SOUTH LLC', credit_decision: 'Approved' },
        { customer_id: '2', customer_name: 'PEPSICO INC', credit_decision: 'Approved' },
        { customer_id: '9', customer_name: 'ABC SHIPPING', credit_decision: 'Credit Boost Requested' }
      ], count: 3 };
    } else if (u.indexOf('/tms-carriers') !== -1) {
      body = { carriers: [
        { vendor_id: 'v1', carrier_name: 'SWIFT HAUL LLC', mc: '982341', dnu: false },
        { vendor_id: 'v2', carrier_name: 'RELIANT', mc: '771204', dnu: false }
      ], count: 2 };
    } else {
      body = {};
    }
      if (u.indexOf('/draft-loads/import-preview') !== -1) {
      body = PREVIEW;
    }
    if (/\/draft-loads$/.test(u.split('?')[0]) && opts && opts.method === 'POST') {
      body = { record_id: 'rec-' + (records.length) };
    }
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve(body); } });
  };
}

const PREVIEW = {
  summary: { total: 3, clean: 1, errors: 1, duplicates: 1 },
  rows: [
    { raw: {}, mapped: { customer_name_raw: 'WALMART INC', customer_reference_number: 'WMT-90021',
        customer_rate: '2850', carrier_mc: '982341', carrier_dot: '', carrier_rate: '2400',
        carrier_factoring_invoice: 'INV-7741', load_rate_confirmation_number: 'RC-1', payment_terms: '', load_comments: '' },
      customer_match: { exact: false, best: { customer_id: '1', name: 'WALMART INC', score: 0.97 }, candidates: [] },
      carrier_match: { vendor_id: 'v1', matched_on: 'mc', conflict: false },
      errors: [], duplicate: false },
    { raw: {}, mapped: { customer_name_raw: '', customer_reference_number: '',
        customer_rate: '', carrier_mc: '', carrier_dot: '', carrier_rate: '',
        carrier_factoring_invoice: '', load_rate_confirmation_number: '', payment_terms: '', load_comments: '' },
      customer_match: { exact: false, best: null, candidates: [] },
      carrier_match: { vendor_id: '', matched_on: '', conflict: false },
      errors: ['customer_reference_number', 'customer_rate', 'carrier_id'], duplicate: false },
    { raw: {}, mapped: { customer_name_raw: 'WALMART INC', customer_reference_number: 'WMT-90021',
        customer_rate: '2850', carrier_mc: '982341', carrier_dot: '', carrier_rate: '2400',
        carrier_factoring_invoice: 'INV-7742', load_rate_confirmation_number: 'RC-2', payment_terms: '', load_comments: '' },
      customer_match: { exact: false, best: { customer_id: '1', name: 'WALMART INC', score: 0.97 }, candidates: [] },
      carrier_match: { vendor_id: 'v1', matched_on: 'mc', conflict: false },
      errors: [], duplicate: true }
  ]
};

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

test('reasonText: customer_not_approved maps to a readable label', () => {
  const { window } = makeWidget();
  assert.equal(window.reasonText('customer_not_approved'), 'customer not credit-approved');
  // unknown codes still fall back to spaced words
  assert.equal(window.reasonText('some_new_code'), 'some new code');
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

test('promptPick self-heals an empty customer list (the "nothing happens" fix)', async () => {
  const { window } = makeWidget();
  window.brokerEmail = 'b@x.com';
  window.renderQueue(DRAFTS);
  window.__state.selected = ['900'];
  window.__state.customers = [];           // simulate pick lists that never loaded
  await window.promptPick('customer');
  const sel = window.document.getElementById('bulk-sel');
  assert.ok(sel, 'picker modal opened');
  // options beyond the placeholder = the lists were fetched on demand
  assert.ok(sel.querySelectorAll('option').length > 1, 'customer options populated');
  assert.ok(window.__state.customers.length > 0, 'customers loaded into state');
});

test('customer picker offers only credit-approved customers (funding rule)', async () => {
  const { window } = makeWidget();
  window.brokerEmail = 'b@x.com';
  window.renderQueue(DRAFTS);
  window.__state.selected = ['900'];
  window.__state.customers = [];
  await window.promptPick('customer');
  // /tms-customers returns DINE SOUTH + PEPSICO (Approved) and ABC SHIPPING (Boost).
  const names = window.__state.customers.map(c => c.customer_name);
  assert.ok(names.includes('DINE SOUTH LLC'));
  assert.ok(!names.includes('ABC SHIPPING'), 'non-approved customer is filtered out');
  const text = window.document.getElementById('bulk-sel').textContent;
  assert.ok(text.indexOf('ABC SHIPPING') === -1, 'non-approved not offered in dropdown');
});

test('promptPick carrier self-heals an empty carrier list', async () => {
  const { window } = makeWidget();
  window.brokerEmail = 'b@x.com';
  window.renderQueue(DRAFTS);
  window.__state.selected = ['900'];
  window.__state.carriers = [];
  await window.promptPick('carrier');
  const sel = window.document.getElementById('bulk-sel');
  assert.ok(sel.querySelectorAll('option').length > 1, 'carrier options populated');
});

// ---- New Draft + bulk Attach docs (were stubs) ----
test('New Draft clears any stale draftId before opening the Load Details form', () => {
  const { window } = makeWidget();
  window.sessionStorage.setItem('draftId', '999');
  window.newDraft();
  assert.equal(window.sessionStorage.getItem('draftId'), null);
});

test('bulk Attach docs opens the paperwork view for the selected drafts', () => {
  const { window } = makeWidget();
  window.__state.drafts = [
    { id: '900', customer_reference_number: 'R1', carrier_factoring_invoice: 'INV1', customer_name: 'ACME', carrier_name: 'SWIFT', carrier_mc: '1' },
    { id: '901', customer_reference_number: 'R2', carrier_factoring_invoice: 'INV2', customer_name: 'BETA', carrier_name: 'RELIANT' }
  ];
  window.__state.selected = ['900', '901'];
  window.bulkAttachDocs();
  assert.equal(window.__pw.loads.length, 2);
  assert.equal(window.__pw.loads[0].ref, 'R1');
  assert.equal(window.__pw.loads[0].invoice, 'INV1');
  assert.ok(!window.document.getElementById('paperwork-wrap').classList.contains('pw-hidden'), 'paperwork view shown');
});

// ---- Edit a draft → Load Details form (sessionStorage handoff) ----
test('editDraft stashes the draft id in sessionStorage for the Load Details form', () => {
  const { window } = makeWidget();
  try { window.sessionStorage.removeItem('draftId'); } catch (e) {}
  window.editDraft('901');
  assert.equal(window.sessionStorage.getItem('draftId'), '901');
});

test('portalPageUrl targets the Load Details page on the portal origin', () => {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/draft-loads.html?serviceOrigin=https://portal.example.com/app',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
  });
  const url = dom.window.portalPageUrl('Load_Details_NEW');
  assert.equal(url, 'https://portal.example.com/app/#Page:Load_Details_NEW');
});

test('each queue row exposes an Edit action', () => {
  const { window } = makeWidget();
  window.renderQueue(DRAFTS);
  const rows = window.document.querySelectorAll('#queue-body tr');
  assert.ok(rows[0].querySelector('[data-edit-row]'), 'row has an edit control');
});

// ---- Delete drafts (single + bulk) ----
test('deleteDrafts issues a DELETE and removes the draft from state', async () => {
  const { window, records } = makeWidget();
  window.brokerEmail = 'b@x.com';
  window.confirm = () => true;
  window.__state.drafts = DRAFTS.slice();
  await window.deleteDrafts(['901']);
  const dels = records.filter(r => /\/draft-loads\/901/.test(r.url) && r.opts.method === 'DELETE');
  assert.equal(dels.length, 1);
  assert.ok(!window.__state.drafts.some(d => d.id === '901'), '901 removed from state');
  assert.ok(window.__state.drafts.some(d => d.id === '900'), '900 untouched');
});

test('deleteDrafts cancelled at the confirm does nothing', async () => {
  const { window, records } = makeWidget();
  window.brokerEmail = 'b@x.com';
  window.confirm = () => false;
  window.__state.drafts = DRAFTS.slice();
  await window.deleteDrafts(['901']);
  const dels = records.filter(r => r.opts && r.opts.method === 'DELETE');
  assert.equal(dels.length, 0);
  assert.equal(window.__state.drafts.length, 2);
});

test('bulk Delete button removes all selected drafts', async () => {
  const { window, records } = makeWidget();
  window.brokerEmail = 'b@x.com';
  window.confirm = () => true;
  window.__state.drafts = DRAFTS.slice();
  window.__state.selected = ['900', '901'];
  await window.deleteDrafts(window.__state.selected.slice());
  const dels = records.filter(r => r.opts && r.opts.method === 'DELETE');
  assert.equal(dels.length, 2);
  assert.equal(window.__state.drafts.length, 0);
});

test('each queue row exposes a Delete action', () => {
  const { window } = makeWidget();
  window.renderQueue(DRAFTS);
  const rows = window.document.querySelectorAll('#queue-body tr');
  assert.ok(rows[0].querySelector('[data-del]'), 'row has a delete control');
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

test('submit selected posts only the checked ids', async () => {
  const { window, records } = makeWidget();
  window.__state.selected = ['900', '901'];
  await window.submitSelected();
  const sub = records.find(r => r.url.indexOf('/draft-loads/submit') !== -1);
  assert.ok(sub, 'posted to submit');
  assert.deepEqual([...JSON.parse(sub.opts.body).ids], ['900', '901']);
});

test('submit selected with nothing checked is a no-op with a nudge', async () => {
  const { window, records } = makeWidget();
  window.__state.selected = [];
  await window.submitSelected();
  assert.ok(!records.find(r => r.url.indexOf('/draft-loads/submit') !== -1), 'no submit posted');
  assert.match(window.document.getElementById('toast').textContent, /select/i);
});

test('selection bar shows a Submit (N) count', () => {
  const { window } = makeWidget();
  window.renderQueue(DRAFTS);
  const cbs = window.document.querySelectorAll('#queue-body input[type="checkbox"]');
  cbs[0].checked = true; cbs[0].dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.match(window.document.getElementById('bulk-submit').textContent, /Submit \(1\)/);
});

test('skipped ids surface their reasons', () => {
  const { window } = makeWidget();
  window.handleSubmitResult({ submitted: ['900'], skipped: [{ id: '901', reasons: ['customer'] }], count: 1 });
  const toast = window.document.getElementById('toast').textContent;
  assert.match(toast, /1/);
  assert.match(toast, /customer/);
  assert.ok(window.__state.lastSkipped && window.__state.lastSkipped.length === 1);
});

test('skip reason codes are shown as readable text, not raw codes', () => {
  const { window } = makeWidget();
  window.handleSubmitResult({ submitted: [], skipped: [{ id: '901', reasons: ['carrier_not_on_account'] }], count: 0 });
  const toast = window.document.getElementById('toast').textContent;
  assert.doesNotMatch(toast, /carrier_not_on_account/, 'raw code must not leak');
  assert.match(toast, /carrier not on your account/i);
});

// ---- Code-quality fixes ----
test('margin tolerates formatted money strings like "$2,850"', () => {
  const { window } = makeWidget();
  window.renderQueue([
    { id: 'f1', status: 'ready', reasons: [], source: 'CSV',
      customer_name: 'PEPSICO INC', customer_raw: '',
      carrier_name: 'SWIFT HAUL LLC', carrier_mc: '982341', carrier_raw: '',
      customer_rate: '$2,850', carrier_rate: '$2,400',
      has_customer_docs: true, has_carrier_docs: true }
  ]);
  const marg = window.document.querySelector('#queue-body td.marg').textContent;
  assert.equal(marg, '$450');
});

test('write-path failure surfaces a toast', async () => {
  const { window } = makeWidget();
  // Force PATCH to reject
  window.fetch = function (url, opts) {
    if (String(url).indexOf('/draft-loads/') !== -1 && opts && opts.method === 'PATCH') {
      return Promise.reject(new Error('network'));
    }
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ drafts: [], count: 0, summary: {} }); } });
  };
  window.__state.selected = ['900'];
  await window.bulkSetCustomer('1');
  assert.match(window.document.getElementById('toast').textContent, /failed/i);
});

test('renderQueue escapes external raw strings (XSS guard)', () => {
  const { window } = makeWidget();
  window.renderQueue([
    { id: 'x1', status: 'attention', reasons: ['customer'], source: 'TMS',
      customer_name: '', customer_raw: '<img src=x onerror=alert(1)>',
      carrier_name: 'A "QUOTE" CARRIER', carrier_mc: '1', carrier_raw: '',
      customer_rate: '0', carrier_rate: '0' }
  ]);
  const html = window.document.querySelector('#queue-body').innerHTML;
  assert.ok(html.indexOf('<img') === -1, 'raw <img must not appear unescaped');
  assert.match(html, /&lt;img/);
});

// ---- Task 19: CSV import modal + preview ----
function mk19() { return makeWidget().window; }

test('openImportModal shows a template link to /draft-loads/template', () => {
  const w = mk19();
  w.openImportModal();
  const a = w.document.querySelector('#scrim a[download], #scrim a.tmpl');
  assert.ok(a, 'template link present');
  assert.ok(/\/draft-loads\/template$/.test(a.getAttribute('href')), a.getAttribute('href'));
});

test('renderPreview renders one row per preview row and flags error + duplicate', () => {
  const w = mk19();
  w.openImportModal();
  w.renderPreview(PREVIEW.rows);
  const rows = w.document.querySelectorAll('.prevrow');
  assert.equal(rows.length, 3);
  assert.equal(w.document.querySelectorAll('.prevrow .badge-error').length, 1);
  assert.equal(w.document.querySelectorAll('.prevrow .badge-dup').length, 1);
});

test('createDraftsFromPreview creates every non-duplicate row (unresolved = exceptions) and opens paperwork', async () => {
  const { window, records } = makeWidget();
  window.openImportModal();
  window.renderPreview(PREVIEW.rows);
  await window.createDraftsFromPreview();
  const posts = records.filter(r => /\/draft-loads$/.test(r.url.split('?')[0]) && r.opts.method === 'POST');
  // PREVIEW = [matched, unresolved/missing-fields, duplicate]; the duplicate is skipped,
  // both the matched AND the unresolved row come in as drafts.
  assert.equal(posts.length, 2);
  const matched = JSON.parse(posts[0].opts.body);
  assert.equal(matched.source, 'CSV');
  assert.equal(matched.customer_reference_number, 'WMT-90021');
  assert.equal(matched.customer_id, '1');
  const unresolved = JSON.parse(posts[1].opts.body);
  assert.ok(!unresolved.customer_id, 'unresolved row has no customer_id but is still created');
  assert.ok(!unresolved.carrier_id, 'unresolved row has no carrier_id but is still created');
  assert.ok(window.document.getElementById('paperwork'), 'paperwork view opened');
});

test('createDraftsFromPreview never posts pay terms (derived server-side from carrier)', async () => {
  const { window, records } = makeWidget();
  window.openImportModal();
  window.renderPreview(PREVIEW.rows);
  await window.createDraftsFromPreview();
  const posts = records.filter(r => /\/draft-loads$/.test(r.url.split('?')[0]) && r.opts.method === 'POST');
  posts.forEach(p => assert.ok(!('payment_terms' in JSON.parse(p.opts.body)), 'no payment_terms sent'));
});

// ---- Customer auto-assign confidence gate ----
test('autoAssignCustomerId: exact match assigns regardless of score', () => {
  const { window } = makeWidget();
  assert.equal(window.autoAssignCustomerId(
    { exact: true, best: { customer_id: '7', name: 'ABC SHIPPING', score: 1.0 } }), '7');
});

test('autoAssignCustomerId: high score (>=0.90) assigns; 0.90 is inclusive', () => {
  const { window } = makeWidget();
  assert.equal(window.autoAssignCustomerId(
    { exact: false, best: { customer_id: '3', name: 'X', score: 0.97 } }), '3');
  assert.equal(window.autoAssignCustomerId(
    { exact: false, best: { customer_id: '4', name: 'Y', score: 0.90 } }), '4');
});

test('autoAssignCustomerId: low/zero/null matches do NOT assign', () => {
  const { window } = makeWidget();
  assert.equal(window.autoAssignCustomerId(
    { exact: false, best: { customer_id: '5', name: 'Z', score: 0.89 } }), '');
  assert.equal(window.autoAssignCustomerId(
    { exact: false, best: { customer_id: '6', name: 'Wrong Co', score: 0.0 } }), '');
  assert.equal(window.autoAssignCustomerId({ exact: false, best: null }), '');
  assert.equal(window.autoAssignCustomerId(undefined), '');
});

test('createDraftsFromPreview omits customer_id for a zero-score match (forces a pick)', async () => {
  const { window, records } = makeWidget();
  window.openImportModal();
  window.renderPreview([
    { raw: {}, mapped: { customer_name_raw: 'ABC Shipping', customer_reference_number: 'REF-1',
        customer_rate: '1000', carrier_mc: '', carrier_dot: '', carrier_rate: '900',
        carrier_factoring_invoice: 'INV-1', load_rate_confirmation_number: 'RC-1', load_comments: '' },
      customer_match: { exact: false, best: { customer_id: '99', name: 'Cumberland Diversified', score: 0.0 }, candidates: [] },
      carrier_match: { vendor_id: '', matched_on: '', conflict: false },
      errors: [], duplicate: false }
  ]);
  await window.createDraftsFromPreview();
  const posts = records.filter(r => /\/draft-loads$/.test(r.url.split('?')[0]) && r.opts.method === 'POST');
  assert.equal(posts.length, 1);
  const body = JSON.parse(posts[0].opts.body);
  assert.ok(!('customer_id' in body) || !body.customer_id,
    'zero-score match must NOT auto-assign a customer');
});

test('createDraftsFromPreview keeps auto-assign for an exact/high-confidence match', async () => {
  const { window, records } = makeWidget();
  window.openImportModal();
  window.renderPreview([PREVIEW.rows[0]]); // best.score 0.97 -> still auto-assigns
  await window.createDraftsFromPreview();
  const posts = records.filter(r => /\/draft-loads$/.test(r.url.split('?')[0]) && r.opts.method === 'POST');
  assert.equal(JSON.parse(posts[0].opts.body).customer_id, '1');
});

// ---- Preview honesty for sub-threshold matches ----
test('renderPreview shows "pick after import" for a sub-threshold match', () => {
  const { window } = makeWidget();
  window.openImportModal();
  window.renderPreview([
    { raw: {}, mapped: { customer_name_raw: 'ABC Shipping', customer_reference_number: 'REF-1',
        customer_rate: '1000', carrier_mc: '', carrier_dot: '', carrier_rate: '900',
        carrier_factoring_invoice: 'INV-1', load_rate_confirmation_number: 'RC-1', load_comments: '' },
      customer_match: { exact: false, best: { customer_id: '99', name: 'Cumberland Diversified', score: 0.0 }, candidates: [] },
      carrier_match: { vendor_id: '', matched_on: '', conflict: false },
      errors: [], duplicate: false }
  ]);
  const cell = window.document.querySelector('.prevrow td');
  assert.match(cell.textContent, /pick after import/i);
  assert.match(cell.textContent, /ABC Shipping/); // shows the raw name the broker sent
});

test('renderPreview shows the customer name for an exact/high-confidence match', () => {
  const { window } = makeWidget();
  window.openImportModal();
  window.renderPreview([PREVIEW.rows[0]]); // WALMART INC, score 0.97
  const cell = window.document.querySelector('.prevrow td');
  assert.match(cell.textContent, /WALMART INC/);
  assert.ok(!/pick after import/i.test(cell.textContent), 'confident match does not say pick after import');
});

// ---- Task 20: paperwork assembly + auto-route ----
function mk() {
  const w = makeWidget().window;
  // Rehydrate cross-realm return values into host-realm plain objects so deepEqual
  // (which compares [[Prototype]] identity) works against host-realm literals.
  const orig = w.routeFileToSlot;
  w.routeFileToSlot = function () {
    const r = orig.apply(w, arguments);
    return r == null ? r : { loadId: r.loadId, slot: r.slot };
  };
  return w;
}

test('routeFileToSlot: ref# -> customer, invoice# -> carrier', () => {const w=mk();
  const loads=[{id:'900',ref:'WMT-90021',invoice:'INV-7741'}];
  assert.deepEqual(w.routeFileToSlot('WMT-90021.pdf',loads),{loadId:'900',slot:'customer'});
  assert.deepEqual(w.routeFileToSlot('INV-7741.pdf',loads),{loadId:'900',slot:'carrier'});
  assert.equal(w.routeFileToSlot('random.pdf',loads),null);});

test('paperwork: load ready only when both slots uploaded', ()=>{const w=mk();
  assert.equal(w.paperworkStatus({customer:'uploaded',carrier:false}),'attention');
  assert.equal(w.paperworkStatus({customer:'uploaded',carrier:'uploaded'}),'ready');});

test('renderPaperwork renders one row per load with two required slots', () => {
  const w = mk();
  w.renderPaperwork([
    { id: '900', ref: 'WMT-90021', invoice: 'INV-7741', customer_name: 'WALMART INC', carrier_name: 'SWIFT' },
    { id: '901', ref: 'WMT-90022', invoice: 'INV-7742', customer_name: 'WALMART INC', carrier_name: 'RELIANT' }
  ]);
  const rows = w.document.querySelectorAll('#paperwork .lrow');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelectorAll('.slot').length, 2);
});

test('renderPaperwork row surfaces carrier name, customer ref AND carrier invoice for drag-drop direction', () => {
  const w = mk();
  w.renderPaperwork([
    { id: '900', ref: 'EXAMPLE-10042', invoice: 'INV-7741', customer_name: 'ABC Shipping',
      carrier_name: 'BRENNAN TRUCKING', carrier_mc: '982341' }
  ]);
  const txt = w.document.querySelector('#paperwork .lrow').textContent;
  assert.match(txt, /ABC Shipping/);
  assert.match(txt, /BRENNAN TRUCKING/);
  assert.match(txt, /EXAMPLE-10042/);
  assert.match(txt, /INV-7741/);
});

test('empty paperwork slots hint which number routes the file', () => {
  const w = mk();
  w.renderPaperwork([{ id: '900', ref: 'EXAMPLE-10042', invoice: 'INV-7741',
    customer_name: 'ABC Shipping', carrier_name: 'BRENNAN TRUCKING' }]);
  const slots = w.document.querySelectorAll('#paperwork .slot');
  assert.match(slots[0].textContent, /EXAMPLE-10042/, 'customer slot hints the ref #');
  assert.match(slots[1].textContent, /INV-7741/, 'carrier slot hints the invoice #');
});

test('createDraftsFromPreview passes the resolved carrier NAME (not MC) into paperwork', async () => {
  const { window } = makeWidget();
  window.__state.carriers = [{ vendor_id: 'v1', carrier_name: 'BRENNAN TRUCKING', mc: '982341' }];
  window.openImportModal();
  window.renderPreview([PREVIEW.rows[0]]);
  await window.createDraftsFromPreview();
  const load = window.__pw.loads[0];
  assert.equal(load.carrier_name, 'BRENNAN TRUCKING');
  assert.equal(load.invoice, 'INV-7741');
  assert.equal(load.carrier_mc, '982341');
});

test('routeFileToSlot: token-boundary match avoids ref substring collision', () => {
  const w = mk();
  const loads = [
    { id: '1', ref: 'WMT-9002', invoice: 'A' },
    { id: '2', ref: 'WMT-90021', invoice: 'B' }
  ];
  assert.deepEqual(w.routeFileToSlot('WMT-90021.pdf', loads), { loadId: '2', slot: 'customer' });
});

function fakeFile(name) {
  return { name, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };
}

test('attaching a file stages it as pending (deferred model — no upload yet)', () => {
  const w = mk();
  w.openPaperwork([{ id: '900', ref: 'WMT-90021', invoice: 'INV-7741', customer_name: 'WALMART INC', carrier_name: 'SWIFT' }]);
  w.attachToSlot('900', 'customer', fakeFile('WMT-90021.pdf'));
  assert.equal(w.__pw.slots['900'].customer, 'pending');
  assert.equal(w.paperworkStatus(w.__pw.slots['900']), 'attention');
  assert.match(w.document.getElementById('pw-prog-lbl').textContent, /0 of 1/);
});

test('attaching a file does not upload immediately (slot stays pending not uploaded)', () => {
  const w = mk();
  w.openPaperwork([{ id: '900', ref: 'WMT-90021', invoice: 'INV-7741', customer_name: 'WALMART INC', carrier_name: 'SWIFT' }]);
  w.attachToSlot('900', 'customer', fakeFile('WMT-90021.pdf'));
  assert.equal(w.__pw.slots['900'].customer, 'pending', 'slot is pending, not uploaded');
  assert.equal(w.__pw.files['900'].customer.length, 1, 'file is staged');
});

function pwReady(w) {
  let merged = 0, uploads = 0;
  w.mergeFilesToPDF = (files) => { merged = files.length; return Promise.resolve(new w.Blob(['x'])); };
  w._uploadDoc = () => { uploads++; return Promise.resolve(true); };
  w.openPaperwork([{ id: '900', ref: 'R1', invoice: 'I1', customer_name: 'C', carrier_name: 'X' }]);
  return { uploads: () => uploads, merged: () => merged };
}

test('per-slot: multiple files all stage into the slot (deferred — no upload, no merge yet)', () => {
  const w = mk();
  const m = pwReady(w);
  w.attachFilesToSlot('900', 'customer', [fakeFile('a.pdf'), fakeFile('b.pdf'), fakeFile('c.pdf')]);
  assert.equal(m.uploads(), 0, 'no upload fired yet');
  assert.equal(m.merged(), 0, 'no merge fired yet');
  assert.equal(w.__pw.slots['900'].customer, 'pending');
  assert.equal(w.__pw.files['900'].customer.length, 3, 'all three files staged');
});

test('per-slot: dropping desktop files on a slot attaches to that slot', async () => {
  const w = mk();
  const m = pwReady(w);
  const cell = w.document.querySelector('#paperwork .slot[data-slot-wrap="carrier"][data-load="900"]');
  assert.ok(cell, 'carrier slot cell exists');
  const ev = new w.Event('drop', { bubbles: true });
  ev.dataTransfer = { files: [fakeFile('x.pdf')], getData: () => '' };
  cell.dispatchEvent(ev);
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(w.__pw.slots['900'].carrier, 'pending', 'carrier slot staged from desktop drop');
});

test('per-slot: clicking a slot opens the file picker scoped to it', () => {
  const w = mk();
  pwReady(w);
  const cell = w.document.querySelector('#paperwork .slot[data-slot-wrap="customer"][data-load="900"]');
  cell.dispatchEvent(new w.Event('click', { bubbles: true }));
  assert.equal(w.__pw.pickTarget.loadId, '900');
  assert.equal(w.__pw.pickTarget.slot, 'customer');
  assert.ok(w.document.getElementById('pw-file-input'), 'hidden file input created');
});

test('per-slot: removeSlot clears an attached slot', () => {
  const w = mk();
  pwReady(w);
  w.attachFilesToSlot('900', 'customer', [fakeFile('a.pdf')]);
  assert.equal(w.__pw.slots['900'].customer, 'pending');
  w.removeSlot('900', 'customer');
  assert.equal(w.__pw.slots['900'].customer, false);
  assert.equal(w.__pw.files['900'].customer.length, 0);
});

test('createDraftsFromPreview survives a partial create failure and opens paperwork with successes only', async () => {
  const { window, records } = makeWidget();
  window.openImportModal();
  window.renderPreview(PREVIEW.rows);
  const cleanRows = [PREVIEW.rows[0], { ...PREVIEW.rows[0], mapped: { ...PREVIEW.rows[0].mapped, customer_reference_number: 'WMT-90099', carrier_factoring_invoice: 'INV-9999' } }];
  window.__import.rows = cleanRows;
  let postCount = 0;
  window.fetch = function (url, opts) {
    records.push({ url: String(url), opts: opts || {} });
    if (/\/draft-loads$/.test(String(url).split('?')[0]) && opts && opts.method === 'POST') {
      postCount++;
      if (postCount === 1) return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ record_id: 'rec-ok' }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
  await window.createDraftsFromPreview();
  assert.equal(window.__pw.loads.length, 1);
  assert.equal(window.__pw.loads[0].id, 'rec-ok');
  assert.ok(window.__pw.loads.every(l => l.id && l.id !== ''), 'no blank-id load');
  assert.match(window.document.getElementById('toast').textContent, /1 of 2/);
});

test('createDraftsFromPreview with zero successes shows error and does not open paperwork', async () => {
  const { window, records } = makeWidget();
  window.openImportModal();
  window.renderPreview(PREVIEW.rows);
  window.__import.rows = [PREVIEW.rows[0]];
  window.__pw.loads = ['SENTINEL'];
  window.fetch = function (url, opts) {
    records.push({ url: String(url), opts: opts || {} });
    if (/\/draft-loads$/.test(String(url).split('?')[0]) && opts && opts.method === 'POST') {
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
  await window.createDraftsFromPreview();
  assert.deepEqual(window.__pw.loads, ['SENTINEL']);
  assert.match(window.document.getElementById('toast').textContent, /fail/i);
});

test('toolbar Template link is a working download link to /draft-loads/template', () => {
  const dom = new JSDOM(HTML);
  const a = dom.window.document.getElementById('tmpl');
  assert.ok(a, '#tmpl exists');
  assert.ok(a.hasAttribute('download'), 'has download attribute');
  assert.ok(/\/draft-loads\/template$/.test(a.getAttribute('href') || ''), 'href ends with /draft-loads/template');
});

// ---- Task 3: remove returns to tray + tray delete ----
test('removeSlot returns the slot files to the tray, not the void', () => {
  const { window } = makeWidget();
  window.openPaperwork([{ id: 'A', ref: 'INV-1', invoice: 'INV-2' }]);
  const f = new window.File(['x'], 'INV-2.pdf', { type: 'application/pdf' });
  window.attachFilesToSlot('A', 'carrier', [f]);
  window.removeSlot('A', 'carrier');
  assert.equal(window.__pw.slots['A'].carrier, false);
  assert.equal(window.__pw.files['A'].carrier.length, 0);
  assert.equal(window.__pw.tray.length, 1);
  assert.equal(window.__pw.tray[0].file.name, 'INV-2.pdf');
});

test('deleteTrayFile removes a tray entry outright', () => {
  const { window } = makeWidget();
  window.openPaperwork([{ id: 'A', ref: 'INV-1', invoice: 'INV-2' }]);
  window.__pw.tray = [{ file: new window.File(['x'], 'junk.pdf'), candidates: [] }];
  window.deleteTrayFile(0);
  assert.equal(window.__pw.tray.length, 0);
});

// ---- Task 4 (AV1): OperFiAV carrier badge + customer credit wiring ----

test('AV containers #draft-carrier-av and #draft-credit-av exist in DOM', () => {
  const { window } = makeWidget();
  assert.ok(window.document.getElementById('draft-carrier-av'), '#draft-carrier-av present');
  assert.ok(window.document.getElementById('draft-credit-av'), '#draft-credit-av present');
});

test('onDraftCarrierChange calls OperFiAV.carrierBadge with the vendor id', () => {
  const { window } = makeWidget();
  const calls = [];
  window.OperFiAV = {
    carrierBadge: (el, opts) => calls.push({ el, opts }),
    customerCredit: () => {}
  };
  window.brokerEmail = 'b@x.com';
  window.onDraftCarrierChange('v1');
  assert.equal(calls.length, 1, 'carrierBadge called once');
  assert.equal(calls[0].opts.vendorId, 'v1');
  assert.equal(calls[0].opts.email, 'b@x.com');
  assert.equal(calls[0].el, window.document.getElementById('draft-carrier-av'));
});

test('onDraftCustomerChange calls OperFiAV.customerCredit with the customer id', () => {
  const { window } = makeWidget();
  const calls = [];
  window.OperFiAV = {
    carrierBadge: () => {},
    customerCredit: (el, opts) => calls.push({ el, opts })
  };
  window.brokerEmail = 'b@x.com';
  window.onDraftCustomerChange('cust-7');
  assert.equal(calls.length, 1, 'customerCredit called once');
  assert.equal(calls[0].opts.customerId, 'cust-7');
  assert.equal(calls[0].opts.email, 'b@x.com');
  assert.equal(calls[0].el, window.document.getElementById('draft-credit-av'));
});

test('onDraftCarrierChange is a no-op when OperFiAV is absent (guard)', () => {
  const { window } = makeWidget();
  delete window.OperFiAV;
  // must not throw
  assert.doesNotThrow(() => window.onDraftCarrierChange('v1'));
});

test('onDraftCustomerChange is a no-op when OperFiAV is absent (guard)', () => {
  const { window } = makeWidget();
  delete window.OperFiAV;
  assert.doesNotThrow(() => window.onDraftCustomerChange('cust-7'));
});

test('inline carrier cell change fires carrierBadge with the selected vendor id', () => {
  const { window } = makeWidget();
  const calls = [];
  window.OperFiAV = {
    carrierBadge: (el, opts) => calls.push({ el, opts }),
    customerCredit: () => {}
  };
  window.brokerEmail = 'b@x.com';
  window.renderQueue(DRAFTS);
  // Click the carrier cell on a row that has a carrier already (row 0, SWIFT HAUL)
  // The inline edit opens for any cell with [data-edit]
  const rows = window.document.querySelectorAll('#queue-body tr');
  const carrierCell = rows[0].querySelector('[data-edit="carrier"]');
  assert.ok(carrierCell, 'carrier edit cell exists');
  carrierCell.click();
  const sel = rows[0].querySelector('select.cell');
  assert.ok(sel, 'inline select rendered');
  // Inject an option so the select value sticks
  const opt = window.document.createElement('option');
  opt.value = 'v1'; opt.textContent = 'SWIFT HAUL LLC';
  sel.appendChild(opt);
  sel.value = 'v1';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.ok(calls.length >= 1, 'carrierBadge called after carrier inline-edit change');
  assert.equal(calls[0].opts.vendorId, 'v1');
});

test('inline customer cell change fires customerCredit with the selected customer id', () => {
  const { window } = makeWidget();
  const calls = [];
  window.OperFiAV = {
    carrierBadge: () => {},
    customerCredit: (el, opts) => calls.push({ el, opts })
  };
  window.brokerEmail = 'b@x.com';
  // Use the draft that has no customer (row 1 = '901', customer needs attention)
  window.renderQueue(DRAFTS);
  const rows = window.document.querySelectorAll('#queue-body tr');
  const custCell = rows[1].querySelector('[data-edit="customer"]');
  assert.ok(custCell, 'customer edit cell exists');
  custCell.click();
  const sel = rows[1].querySelector('select.cell');
  assert.ok(sel, 'inline select rendered');
  const opt = window.document.createElement('option');
  opt.value = 'cust-1'; opt.textContent = 'DINE SOUTH LLC';
  sel.appendChild(opt);
  sel.value = 'cust-1';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.ok(calls.length >= 1, 'customerCredit called after customer inline-edit change');
  assert.equal(calls[0].opts.customerId, 'cust-1');
});

// ---- Task 1: matching engine ----
test('normToken strips separators and lowercases', () => {
  const { window } = makeWidget();
  assert.equal(window.normToken('INV-1234'), 'inv1234');
  assert.equal(window.normToken('INV 1234'), 'inv1234');
  assert.equal(window.normToken('INV_1234.pdf'), 'inv1234pdf');
});

test('boundedMatch rejects digit-run over/under-extension', () => {
  const { window } = makeWidget();
  assert.equal(window.boundedMatch('1234', '1234'), true);
  assert.equal(window.boundedMatch('12345', '1234'), false); // trailing digit
  assert.equal(window.boundedMatch('51234', '1234'), false); // leading digit
  assert.equal(window.boundedMatch('inv1234rc', '1234'), true); // letters ok
  assert.equal(window.boundedMatch('123', '1234'), false);
});

test('matchFileToLoads: bare number auto-routes to the single matching slot', () => {
  const { window } = makeWidget();
  const loads = [{ id: 'A', ref: 'INV-1234', invoice: 'XJ-9981' }];
  const r = window.matchFileToLoads('1234.pdf', loads);
  assert.equal(r.auto.loadId, 'A'); assert.equal(r.auto.slot, 'customer'); assert.equal(r.auto.confidence, 'medium');
  assert.equal(r.candidates.length, 1);
});

test('matchFileToLoads: full alphanumeric key is high confidence', () => {
  const { window } = makeWidget();
  const loads = [{ id: 'A', ref: 'INV-1234', invoice: 'XJ-9981' }];
  const r = window.matchFileToLoads('INV 1234 ratecon.pdf', loads);
  assert.equal(r.auto.slot, 'customer');
  assert.equal(r.auto.confidence, 'high');
});

test('matchFileToLoads: strict numbers do not cross-match', () => {
  const { window } = makeWidget();
  const loads = [{ id: 'A', ref: '1234', invoice: '' }];
  assert.equal(window.matchFileToLoads('12345.pdf', loads).candidates.length, 0);
  assert.equal(window.matchFileToLoads('1233.pdf', loads).candidates.length, 0);
});

test('matchFileToLoads: ref==invoice is ambiguous (no auto, two candidates)', () => {
  const { window } = makeWidget();
  const loads = [{ id: 'A', ref: '1234', invoice: '1234' }];
  const r = window.matchFileToLoads('1234.pdf', loads);
  assert.equal(r.auto, null);
  assert.equal(r.candidates.length, 2);
});

test('matchFileToLoads: same number on two loads is ambiguous', () => {
  const { window } = makeWidget();
  const loads = [{ id: 'A', ref: 'INV-1234', invoice: '' },
                 { id: 'B', ref: '', invoice: 'PO-1234' }];
  const r = window.matchFileToLoads('1234.pdf', loads);
  assert.equal(r.auto, null);
  assert.equal(r.candidates.length, 2);
});

// ---- Task 2: deferred upload ----
test('attachFilesToSlot stages files as pending and uploads nothing', () => {
  const { window, records } = makeWidget();
  window.openPaperwork([{ id: 'A', ref: 'INV-1', invoice: 'INV-2' }]);
  const f = new window.File(['x'], 'a.pdf', { type: 'application/pdf' });
  window.attachFilesToSlot('A', 'customer', [f]);
  assert.equal(window.__pw.slots['A'].customer, 'pending');
  assert.equal(window.__pw.files['A'].customer.length, 1);
  assert.ok(!records.some(r => r.url.indexOf('/upload-doc') !== -1));
});

test('paperworkStatus is ready only when both slots uploaded', () => {
  const { window } = makeWidget();
  assert.equal(window.paperworkStatus({ customer: 'pending', carrier: 'uploaded' }), 'attention');
  assert.equal(window.paperworkStatus({ customer: 'uploaded', carrier: 'uploaded' }), 'ready');
});

// ---- Task 4: assign + move ----
test('assignTrayFile stages the file and removes it from the tray', () => {
  const { window } = makeWidget();
  window.openPaperwork([{ id: 'A', ref: 'INV-1', invoice: 'INV-2' }]);
  window.__pw.tray = [{ file: new window.File(['x'], '1.pdf'),
    candidates: [{ loadId: 'A', slot: 'customer', confidence: 'high' }] }];
  window.assignTrayFile(0, 'A', 'customer');
  assert.equal(window.__pw.tray.length, 0);
  assert.equal(window.__pw.slots['A'].customer, 'pending');
  assert.equal(window.__pw.files['A'].customer.length, 1);
});

test('moveSlotFile relocates files between slots', () => {
  const { window } = makeWidget();
  window.openPaperwork([{ id: 'A', ref: 'INV-1', invoice: 'INV-2' },
                        { id: 'B', ref: 'INV-3', invoice: 'INV-4' }]);
  window.attachFilesToSlot('A', 'customer', [new window.File(['x'], '1.pdf')]);
  window.moveSlotFile('A', 'customer', 'B', 'carrier');
  assert.equal(window.__pw.files['A'].customer.length, 0);
  assert.equal(window.__pw.slots['A'].customer, false);
  assert.equal(window.__pw.files['B'].carrier.length, 1);
  assert.equal(window.__pw.slots['B'].carrier, 'pending');
});

// ---- Task 5: smart drop + tray UI ----
test('dropAllFiles auto-routes an unambiguous file and trays an ambiguous one', () => {
  const { window } = makeWidget();
  window.openPaperwork([{ id: 'A', ref: 'INV-1234', invoice: 'XJ-9981' },
                        { id: 'B', ref: '1234', invoice: '1234' }]);
  // 'xj9981' matches only load A carrier -> auto
  window.dropAllFiles([new window.File(['x'], 'XJ-9981.pdf')]);
  assert.equal(window.__pw.slots['A'].carrier, 'pending');
  // '1234' matches A.customer, B.customer, B.carrier -> ambiguous -> tray
  window.dropAllFiles([new window.File(['x'], '1234.pdf')]);
  assert.equal(window.__pw.tray.length, 1);
  assert.ok(window.__pw.tray[0].candidates.length >= 2);
});

test('renderTray groups same-load files and warns when more than one', () => {
  const { window } = makeWidget();
  window.openPaperwork([{ id: 'A', ref: '1234', invoice: '1234' }]);
  window.__pw.tray = [
    { file: new window.File(['x'], 'cust.pdf'), candidates: [{ loadId: 'A', slot: 'customer', confidence: 'medium' }] },
    { file: new window.File(['x'], 'inv.pdf'),  candidates: [{ loadId: 'A', slot: 'carrier',  confidence: 'medium' }] }
  ];
  window.renderTray();
  const trayText = window.document.getElementById('pw-tray').textContent;
  assert.match(trayText, /2 files match/i);
});

test('renderTray renders a delete control per tray file', () => {
  const { window } = makeWidget();
  window.openPaperwork([{ id: 'A', ref: 'INV-1', invoice: 'INV-2' }]);
  window.__pw.tray = [{ file: new window.File(['x'], 'junk.pdf'), candidates: [] }];
  window.renderTray();
  assert.ok(window.document.querySelector('#pw-tray .tray-del'));
});

// ---- Task 6: preview ----
test('previewFile shows an iframe for a PDF and revokes URL on close', () => {
  const { window } = makeWidget();
  let created = 0, revoked = 0;
  window.URL.createObjectURL = () => { created++; return 'blob:fake'; };
  window.URL.revokeObjectURL = () => { revoked++; };
  window.previewFile(new window.File(['x'], 'a.pdf', { type: 'application/pdf' }));
  const modal = window.document.getElementById('pw-preview');
  assert.ok(!modal.classList.contains('hidden'));
  assert.ok(modal.querySelector('iframe'));
  assert.equal(created, 1);
  window.closePreview();
  assert.ok(modal.classList.contains('hidden'));
  assert.equal(revoked, 1);
});

test('previewFile shows an img for an image', () => {
  const { window } = makeWidget();
  window.URL.createObjectURL = () => 'blob:fake';
  window.previewFile(new window.File(['x'], 'a.png', { type: 'image/png' }));
  assert.ok(window.document.querySelector('#pw-preview img'));
});

// ---- Task 7: commit ----
test('commitPaperwork merges+uploads once per pending slot and marks uploaded', async () => {
  const { window } = makeWidget();
  window.openPaperwork([{ id: 'A', ref: 'INV-1', invoice: 'INV-2' }]);
  window.attachFilesToSlot('A', 'customer', [new window.File(['x'], 'c.pdf')]);
  window.attachFilesToSlot('A', 'carrier', [new window.File(['x'], 'v.pdf')]);
  let merges = 0, uploads = 0;
  window.mergeFilesToPDF = () => { merges++; return Promise.resolve(new window.Blob(['p'])); };
  window._uploadDoc = () => { uploads++; return Promise.resolve(true); };
  await window.commitPaperwork();
  assert.equal(merges, 2);
  assert.equal(uploads, 2);
  assert.equal(window.__pw.slots['A'].customer, 'uploaded');
  assert.equal(window.__pw.slots['A'].carrier, 'uploaded');
});

test('commitPaperwork keeps a slot pending when its upload fails', async () => {
  const { window } = makeWidget();
  window.openPaperwork([{ id: 'A', ref: 'INV-1', invoice: 'INV-2' }]);
  window.attachFilesToSlot('A', 'customer', [new window.File(['x'], 'c.pdf')]);
  window.mergeFilesToPDF = () => Promise.resolve(new window.Blob(['p']));
  window._uploadDoc = () => Promise.resolve(false);
  await window.commitPaperwork();
  assert.equal(window.__pw.slots['A'].customer, 'pending');
});

test('hasPendingUploads reflects pending slots', () => {
  const { window } = makeWidget();
  window.openPaperwork([{ id: 'A', ref: 'INV-1', invoice: 'INV-2' }]);
  assert.equal(window.hasPendingUploads(), false);
  window.attachFilesToSlot('A', 'customer', [new window.File(['x'], 'c.pdf')]);
  assert.equal(window.hasPendingUploads(), true);
});

test('commitPaperwork double-call fires merge+upload only once per slot', async () => {
  const { window } = makeWidget();
  window.openPaperwork([{ id: 'A', ref: 'INV-1', invoice: 'INV-2' }]);
  window.attachFilesToSlot('A', 'customer', [new window.File(['x'], 'c.pdf')]);
  window.attachFilesToSlot('A', 'carrier',  [new window.File(['x'], 'v.pdf')]);
  var merges = 0, uploads = 0;
  // Upload resolves on a setTimeout-0 tick so second call lands while first is in-flight
  window.mergeFilesToPDF = function() { merges++; return Promise.resolve(new window.Blob(['p'])); };
  window._uploadDoc = function() {
    uploads++;
    return new Promise(function(resolve) { setTimeout(function() { resolve(true); }, 0); });
  };
  // Fire both calls without awaiting the first — second should be a no-op
  var p1 = window.commitPaperwork();
  var p2 = window.commitPaperwork();
  await Promise.all([p1, p2]);
  assert.equal(merges, 2,  'mergeFilesToPDF must be called exactly once per slot (2 slots)');
  assert.equal(uploads, 2, '_uploadDoc must be called exactly once per slot (2 slots)');
});
