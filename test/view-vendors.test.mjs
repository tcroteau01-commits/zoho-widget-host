import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../view-vendors.html', import.meta.url), 'utf8');

// ── Static source checks ──────────────────────────────────────────────────────

test('loads operfi-av.js script', () => {
  assert.match(HTML, /operfi-av\.js/);
});

test('detail pane markup template contains vv-carrier-av container', () => {
  assert.match(HTML, /vv-carrier-av/);
});

test('does not show carrier-wide Payment Terms field() call in panel', () => {
  // The generic field('Payment Terms', r.Payment_Terms) call should be gone.
  assert.doesNotMatch(HTML, /field\('Payment Terms'/);
});

test('targets the Render backend', () => {
  assert.match(HTML, /operfi-broker-api\.onrender\.com/);
});

// ── Runtime: carrierBadge is called when a vendor detail is opened ──────────
//
// The widget IIFE does not expose internals on window, so we drive it via the
// DOM: load records through the /broker-report fetch stub, let the list render,
// then click the first row to open the panel.

function makeDom(avStubs) {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;

  // Stub ZOHO SDK so bootApp resolves synchronously.
  w.ZOHO = {
    CREATOR: {
      UTIL: { getInitParams: () => ({ loginUser: 'broker@test.com' }) },
      init: () => Promise.resolve()
    }
  };

  // Stub OperFiAV before scripts run so the guard check works.
  w.OperFiAV = Object.assign({ carrierBadge: () => {}, customerCredit: () => {} }, avStubs || {});

  return dom;
}

// Return a fetch stub that answers /broker-report with the given records.
function makeFetch(records) {
  return (url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ records })
  });
}

// Wait for the row list to render (fetch is async even in stubs).
async function waitForRows(w, timeout = 200) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (w.document.querySelector('.row')) return;
    await new Promise(r => setTimeout(r, 10));
  }
}

const VENDOR = { ID: 'VND001', Vendor_Name: 'Test Carrier', Vendor_Status: 'Approved',
                 Email: 'tc@ex.com', MC: '12345' };

test('panel opens with #vv-carrier-av after clicking a vendor row', async () => {
  const dom = makeDom();
  const w = dom.window;
  w.fetch = makeFetch([VENDOR]);

  // Fire load event to boot the app.
  w.dispatchEvent(new w.Event('load'));
  await waitForRows(w);

  const row = w.document.querySelector('.row');
  assert.ok(row, 'at least one vendor row must render');
  row.click();

  const avEl = w.document.getElementById('vv-carrier-av');
  assert.ok(avEl, '#vv-carrier-av must exist in the DOM after panel opens');
});

test('carrierBadge is called with r.ID, brokerEmail, and BROKER_API_BASE', async () => {
  const calls = [];
  const dom = makeDom({ carrierBadge: (el, opts) => calls.push({ el, opts }) });
  const w = dom.window;
  w.fetch = makeFetch([VENDOR]);

  w.dispatchEvent(new w.Event('load'));
  await waitForRows(w);

  w.document.querySelector('.row').click();

  assert.equal(calls.length, 1, 'carrierBadge should be called exactly once');
  const { el, opts } = calls[0];
  assert.equal(opts.vendorId, 'VND001', 'vendorId must be r.ID');
  assert.equal(opts.email, 'broker@test.com', 'email must be brokerEmail');
  assert.match(opts.apiBase, /onrender\.com/, 'apiBase must be the Render URL');
  assert.ok(el instanceof w.HTMLElement, 'first arg must be a DOM element');
});

test('carrierBadge fires again on panel navigation to a second vendor', async () => {
  const calls = [];
  const dom = makeDom({ carrierBadge: (el, opts) => calls.push(opts.vendorId) });
  const w = dom.window;

  const v2 = { ID: 'VND002', Vendor_Name: 'Second Carrier', Vendor_Status: 'Approved' };
  // Second record sorts after first (Approved, alpha) so rows[0]=Test Carrier, rows[1]=Second Carrier
  // But sorted alphabetically: "Second" < "Test" so v2 is index 0, VENDOR is index 1.
  w.fetch = makeFetch([VENDOR, v2]);

  w.dispatchEvent(new w.Event('load'));
  await waitForRows(w);

  // Click the first row to open panel at index 0.
  const rows = w.document.querySelectorAll('.row');
  rows[0].click();

  // Navigate to next vendor via the panel nav button.
  const nextBtn = w.document.getElementById('p-next');
  assert.ok(nextBtn && !nextBtn.classList.contains('disabled'), 'next nav btn must exist and be enabled');
  nextBtn.click();

  assert.equal(calls.length, 2, 'carrierBadge should fire once per panel render');
});

test('carrierBadge is skipped (no throw) when OperFiAV is not loaded', async () => {
  const dom = makeDom();
  const w = dom.window;
  delete w.OperFiAV; // simulate script not yet loaded
  w.fetch = makeFetch([VENDOR]);

  w.dispatchEvent(new w.Event('load'));
  await waitForRows(w);

  // Should not throw even with OperFiAV absent.
  let threw = false;
  try { w.document.querySelector('.row').click(); } catch (e) { threw = true; }
  assert.ok(!threw, 'clicking a row without OperFiAV must not throw');

  // Container still rendered in the panel.
  assert.ok(w.document.getElementById('vv-carrier-av'), '#vv-carrier-av still in DOM');
});

// ── Relationship date: row "Since" column ──────────────────────────────────
const DATED = [
  { ID: 'A', Vendor_Name: 'Alpha Freight', Vendor_Status: 'Approved', Added_Time: '14-Mar-2025 10:00:00' },
  { ID: 'B', Vendor_Name: 'Bravo Lines',  Vendor_Status: 'Approved' /* no Added_Time */ },
];

test('row renders a Since cell with compact Mon YYYY', async () => {
  const dom = makeDom();
  const w = dom.window;
  w.fetch = makeFetch(DATED);
  w.dispatchEvent(new w.Event('load'));
  await waitForRows(w);
  const labels = [...w.document.querySelectorAll('.row .cell-label')].map(e => e.textContent);
  assert.ok(labels.includes('Since'), 'a Since column label is rendered');
  assert.match(w.document.body.textContent, /Mar 2025/);
});

test('row Since cell shows em-dash when Added_Time is absent', async () => {
  const dom = makeDom();
  const w = dom.window;
  w.fetch = makeFetch([DATED[1]]);
  w.dispatchEvent(new w.Event('load'));
  await waitForRows(w);
  // The Bravo row has no date; its Since cell must render the em-dash sentinel.
  const row = w.document.querySelector('.row');
  assert.match(row.textContent, /—/);
});

test('detail panel shows Carrier since with full date', async () => {
  const dom = makeDom();
  const w = dom.window;
  w.fetch = makeFetch([{ ID: 'A', Vendor_Name: 'Alpha Freight', Vendor_Status: 'Approved',
                         Added_Time: '14-Mar-2025 10:00:00' }]);
  w.dispatchEvent(new w.Event('load'));
  await waitForRows(w);
  w.document.querySelector('.row').click();
  const panel = w.document.getElementById('panel');
  assert.match(panel.textContent, /Carrier since/);
  assert.match(panel.textContent, /Mar 14, 2025/);
});

test('addressFieldHtml wraps the address in a Maps link; plain when empty', () => {
  const dom = makeDom();
  const w = dom.window;
  w.dispatchEvent(new w.Event('load'));

  const linked = w.addressFieldHtml('500 W Adams St, Phoenix, AZ 85003');
  assert.match(linked, /class="field-label">Address</);
  assert.match(linked, /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=/);
  assert.match(linked, /target="_blank"/);

  const empty = w.addressFieldHtml('');
  assert.ok(!/href=/.test(empty), 'no link when empty');
});

test('default sort state is rel_new (most recent first)', () => {
  assert.match(HTML, /var currentSort = 'rel_new'/);
});

test('sort dropdown marks Relationship: Newest as selected', () => {
  assert.match(HTML, /<option value="rel_new"[^>]*selected/);
});

// ── Sorting ────────────────────────────────────────────────────────────────
const SORT_SET = [
  { ID: '1', Vendor_Name: 'Charlie Co',  Vendor_Status: 'Approved', Added_Time: '01-Jan-2024 00:00:00' },
  { ID: '2', Vendor_Name: 'alpha co',    Vendor_Status: 'Approved', Added_Time: '15-Jun-2026 00:00:00' },
  { ID: '3', Vendor_Name: 'Bravo Co',    Vendor_Status: 'Approved' /* no date */ },
];

function rowNames(w) {
  return [...w.document.querySelectorAll('.row .cell-val.lg')].map(e => e.textContent.trim());
}
async function bootSorted(records) {
  const dom = makeDom();
  const w = dom.window;
  w.fetch = makeFetch(records);
  w.dispatchEvent(new w.Event('load'));
  await waitForRows(w);
  return w;
}
function setSort(w, value) {
  const sel = w.document.getElementById('sort-select');
  sel.value = value;
  sel.dispatchEvent(new w.Event('change'));
}

test('sort dropdown exists with the five options', async () => {
  const w = await bootSorted(SORT_SET);
  const sel = w.document.getElementById('sort-select');
  assert.ok(sel, '#sort-select present');
  const vals = [...sel.options].map(o => o.value);
  assert.deepEqual(vals, ['status', 'name_asc', 'name_desc', 'rel_new', 'rel_old']);
});

test('Name A-Z sorts case-insensitively', async () => {
  const w = await bootSorted(SORT_SET);
  setSort(w, 'name_asc');
  assert.deepEqual(rowNames(w), ['alpha co', 'Bravo Co', 'Charlie Co']);
});

test('Name Z-A reverses', async () => {
  const w = await bootSorted(SORT_SET);
  setSort(w, 'name_desc');
  assert.deepEqual(rowNames(w), ['Charlie Co', 'Bravo Co', 'alpha co']);
});

test('Relationship Newest first, missing date last', async () => {
  const w = await bootSorted(SORT_SET);
  setSort(w, 'rel_new');
  assert.deepEqual(rowNames(w), ['alpha co', 'Charlie Co', 'Bravo Co']);
});

test('Relationship Oldest first, missing date last', async () => {
  const w = await bootSorted(SORT_SET);
  setSort(w, 'rel_old');
  assert.deepEqual(rowNames(w), ['Charlie Co', 'alpha co', 'Bravo Co']);
});

test('status sort keeps name A-Z within one status group', async () => {
  const w = await bootSorted(SORT_SET); // all Approved -> tiebreak is name asc
  setSort(w, 'status');
  assert.deepEqual(rowNames(w), ['alpha co', 'Bravo Co', 'Charlie Co']);
});

test('CSV export includes a Relationship Since column', () => {
  assert.match(HTML, /Relationship Since/);
});

test('changing sort preserves the active search filter', async () => {
  const recs = [
    { ID:'1', Vendor_Name:'Apple Logistics', Vendor_Status:'Approved', Added_Time:'01-Jan-2024 00:00:00' },
    { ID:'2', Vendor_Name:'Apricot Lines',   Vendor_Status:'Approved', Added_Time:'02-Feb-2025 00:00:00' },
    { ID:'3', Vendor_Name:'Zebra Freight',   Vendor_Status:'Approved', Added_Time:'03-Mar-2026 00:00:00' },
  ];
  const w = await bootSorted(recs);
  const search = w.document.getElementById('search-input');
  search.value = 'ap';            // matches Apple + Apricot, not Zebra
  search.dispatchEvent(new w.Event('input'));
  await new Promise(r => setTimeout(r, 20));
  const before = rowNames(w).slice().sort();
  setSort(w, 'rel_new');
  const after = rowNames(w).slice().sort();
  assert.deepEqual(before, ['Apple Logistics', 'Apricot Lines']);
  assert.deepEqual(after, before, 'same records pass the filter regardless of sort');
});

// ── Carrier Vetting zone: script includes + docs ──────────────────────────────

test('includes the shared doc viewer + pdf.js scripts', () => {
  assert.match(HTML, /operfi-docviewer\.js/);
  assert.match(HTML, /pdfjs\/pdf\.min\.js/);
});

test('panel template has a Carrier Vetting zone with a docs container', () => {
  assert.match(HTML, /Carrier Vetting/);
  assert.match(HTML, /vv-docs/);
  assert.match(HTML, /Review this carrier's documents and flags before you submit/);
});

test('opening a vendor lazy-loads carrier docs sorted recent-first', async () => {
  const records = [{ ID: '900', Vendor_Name: 'ACME', Vendor_Status: 'Approved', Email: 'a@b.com' }];
  const docs = [
    { type: 'noa', label: 'NOA / LOR', filename: 'NOA-1.pdf', created_time: 100, preview_token: 'tNoa' },
    { type: 'coi', label: 'Insurance (COI)', filename: 'COI-1.pdf', created_time: 300, preview_token: 'tCoi' }
  ];
  const dom = makeDom();
  const w = dom.window;
  // Set fetch before the load event fires — ZOHO.init resolves a tick later,
  // so assigning w.fetch here (same as all other tests) ensures the boot picks it up.
  w.fetch = (url) => {
    if (String(url).indexOf('/broker-report') !== -1)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ records }) });
    if (String(url).indexOf('/carrier-docs') !== -1)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ documents: docs, count: 2 }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
  let opened = null;
  w.OperFiDocViewer = { open: (o) => { opened = o; }, close: () => {} };
  // Boot the app (mirrors the existing harness pattern — dispatchEvent then waitForRows).
  w.dispatchEvent(new w.Event('load'));
  await waitForRows(w);
  w.document.querySelector('.row').click();
  await new Promise(r => setTimeout(r, 40));
  const items = [...w.document.querySelectorAll('#vv-docs .vv-doc')];
  assert.equal(items.length, 2, 'two doc rows');
  // recent-first: COI (300) before NOA (100)
  assert.match(items[0].textContent, /COI/);
  assert.match(items[1].textContent, /NOA/);
  // clicking opens the shared viewer with the streamed URL
  items[0].click();
  assert.ok(opened && /carrier-doc-file\?t=tCoi/.test(opened.url), 'viewer opened with doc url');
});

function makeVetFetch(records, profile, docs) {
  return (url) => {
    if (url.indexOf('/carrier-profile') !== -1)
      return Promise.resolve({ ok: true, json: () => Promise.resolve(profile) });
    if (url.indexOf('/carrier-docs') !== -1)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ documents: docs || [] }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ records }) });
  };
}

test('panel paints clean summary and no flag rows for a clean carrier', async () => {
  const dom = makeDom();
  const w = dom.window;
  const rec = { ID: '1001', Vendor_Name: 'CLEAN LLC', Vendor_Status: 'Approved', MC: '1', USDOT: '2', Factoring_Company: '' };
  w.fetch = makeVetFetch([rec], { risk: { flags: [] }, ipqs: {} }, []);
  w.dispatchEvent(new w.Event('load'));
  await waitForRows(w);
  w.document.querySelector('.row').click();
  await new Promise((r) => setTimeout(r, 50));
  const strip = w.document.getElementById('vv-redflags');
  assert.match(strip.textContent, /Looks clean/);
  assert.equal(strip.querySelectorAll('.vv-flag').length, 0);
});

test('panel paints a stop row with its reason for a routing-invalid carrier', async () => {
  const dom = makeDom();
  const w = dom.window;
  const rec = { ID: '1002', Vendor_Name: 'RISKY LLC', Vendor_Status: 'Approved', MC: '3', USDOT: '4', Factoring_Company: '' };
  w.fetch = makeVetFetch([rec], { risk: { flags: [{ id: 'bank_routing_invalid' }] }, ipqs: {} }, []);
  w.dispatchEvent(new w.Event('load'));
  await waitForRows(w);
  w.document.querySelector('.row').click();
  await new Promise((r) => setTimeout(r, 50));
  const strip = w.document.getElementById('vv-redflags');
  assert.equal(strip.querySelectorAll('.vv-flag.stop').length, 1);
  assert.match(strip.textContent, /not a valid FedACH/);
});

test('vetting pane derives present-only flags from carrier-profile', async () => {
  const records = [{ ID: '901', Vendor_Name: 'RISKY', Vendor_Status: 'Approved', Email: 'r@b.com', Factoring_Company: 'ACME' }];
  const profile = {
    vendor: {},
    ipqs: { vpn_detected: true, voip_number: false },
    bank: {},
    risk: { flags: [
      { id: 'vpn_signup', category: 'Identity and Signup Fraud', severity: 'High' },
      { id: 'factor_not_approved', category: 'Payment and Internal', severity: 'Critical' }
    ] }
  };
  const dom = makeDom();
  const w = dom.window;
  w.fetch = (url) => {
    if (String(url).indexOf('/broker-report') !== -1)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ records }) });
    if (String(url).indexOf('/carrier-docs') !== -1)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ documents: [], count: 0 }) });
    if (String(url).indexOf('/carrier-profile') !== -1)
      return Promise.resolve({ ok: true, json: () => Promise.resolve(profile) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
  w.OperFiDocViewer = { open: () => {}, close: () => {} };
  w.dispatchEvent(new w.Event('load'));
  await waitForRows(w);
  w.document.querySelector('.row').click();
  // Instant paint: carrier is Approved + not DNU, so before the profile loads there
  // are no derivable flags — the summary reads clean and no flag row is fabricated.
  const stripInstant = w.document.getElementById('vv-redflags');
  assert.match(stripInstant.textContent, /Looks clean/, 'clean summary before profile loads');
  assert.doesNotMatch(stripInstant.textContent, /Factor/, 'Factor not fabricated before profile loads');
  await new Promise(r => setTimeout(r, 50));
  const strip = w.document.getElementById('vv-redflags');
  assert.match(strip.textContent, /VPN/, 'VPN-only footprint -> a check row');
  assert.match(strip.textContent, /Factor denied/, 'factor_not_approved -> Factor denied row');
  assert.doesNotMatch(strip.textContent, /Documents/, 'document completeness is no longer a flag');
  assert.equal(strip.querySelectorAll('.vv-flag.stop').length, 1, 'factor-denied is the lone stop');
  assert.equal(strip.querySelectorAll('.vv-flag.check').length, 1, 'VPN is the lone check');
});

// ── Pure vetting-flag derivation ───────────────────────────────────────────
function vvApi() {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.ZOHO = { CREATOR: { UTIL: { getInitParams: () => ({ loginUser: 'b@t.com' }) }, init: () => Promise.resolve() } };
  w.OperFiAV = { carrierBadge: () => {}, customerCredit: () => {} };
  // Benign fetch so bootApp's deferred report pull doesn't raise an unhandled rejection.
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ records: [] }) });
  return w.__vvtest;
}

function riskProfile(ids, ipqs) {
  return { risk: { flags: (ids || []).map((id) => ({ id })) }, ipqs: ipqs || {} };
}

test('deriveVettingFlags: clean carrier yields no flags', () => {
  const flags = vvApi().deriveVettingFlags(riskProfile([]), { isDnu: false, statusKey: 'approved', isFactored: false });
  assert.equal(flags.length, 0);
});

test('deriveVettingFlags: DNU is a stop', () => {
  const flags = vvApi().deriveVettingFlags(riskProfile([]), { isDnu: true, statusKey: 'dnu', isFactored: false });
  assert.equal(flags.length, 1);
  assert.equal(flags[0].key, 'dnu');
  assert.equal(flags[0].level, 'stop');
});

test('deriveVettingFlags: denied status is a stop', () => {
  const flags = vvApi().deriveVettingFlags(riskProfile([]), { isDnu: false, statusKey: 'denied', isFactored: false });
  assert.ok(flags.some((f) => f.key === 'denied' && f.level === 'stop'));
});

test('deriveVettingFlags: bank ids map to correct severities', () => {
  const api = vvApi();
  const ctx = { isDnu: false, statusKey: 'approved', isFactored: false };
  assert.equal(api.deriveVettingFlags(riskProfile(['bank_bad_actor']), ctx)[0].level, 'stop');
  assert.equal(api.deriveVettingFlags(riskProfile(['bank_account_shared']), ctx)[0].level, 'stop');
  assert.equal(api.deriveVettingFlags(riskProfile(['bank_routing_invalid']), ctx)[0].level, 'stop');
  assert.equal(api.deriveVettingFlags(riskProfile(['bank_name_mismatch']), ctx)[0].level, 'check');
});

test('deriveVettingFlags: bank_state_mismatch is suppressed in Phase 1', () => {
  const flags = vvApi().deriveVettingFlags(riskProfile(['bank_state_mismatch']), { isDnu: false, statusKey: 'approved', isFactored: false });
  assert.equal(flags.length, 0);
});

test('deriveVettingFlags: footprint VOIP-only is one check', () => {
  const flags = vvApi().deriveVettingFlags(riskProfile([], { voip_number: true }), { isDnu: false, statusKey: 'approved', isFactored: false });
  assert.equal(flags.length, 1);
  assert.equal(flags[0].level, 'check');
});

test('deriveVettingFlags: footprint VPN-only is one check', () => {
  const flags = vvApi().deriveVettingFlags(riskProfile([], { vpn_detected: true }), { isDnu: false, statusKey: 'approved', isFactored: false });
  assert.equal(flags.length, 1);
  assert.equal(flags[0].level, 'check');
});

test('deriveVettingFlags: footprint VOIP+VPN is one stop labeled "VOIP + VPN"', () => {
  const flags = vvApi().deriveVettingFlags(riskProfile([], { voip_number: true, vpn_detected: true }), { isDnu: false, statusKey: 'approved', isFactored: false });
  assert.equal(flags.length, 1);
  assert.equal(flags[0].level, 'stop');
  assert.equal(flags[0].label, 'VOIP + VPN');
});

test('deriveVettingFlags: factor denied=stop, pending=check', () => {
  const api = vvApi();
  const ctx = { isDnu: false, statusKey: 'approved', isFactored: true };
  assert.equal(api.deriveVettingFlags(riskProfile(['factor_not_approved']), ctx)[0].level, 'stop');
  assert.equal(api.deriveVettingFlags(riskProfile(['factor_pending']), ctx)[0].level, 'check');
});

test('deriveVettingFlags: payment-change is a check', () => {
  const flags = vvApi().deriveVettingFlags(riskProfile([]), { isDnu: false, statusKey: 'payment-change', isFactored: false });
  assert.ok(flags.some((f) => f.key === 'pay_change' && f.level === 'check'));
});

test('deriveVettingFlags: stops sort above checks', () => {
  const flags = vvApi().deriveVettingFlags(
    riskProfile(['factor_pending', 'bank_routing_invalid']),
    { isDnu: false, statusKey: 'approved', isFactored: true });
  assert.equal(flags[0].level, 'stop');
  assert.equal(flags[flags.length - 1].level, 'check');
});

// ── Required docs and vetting summary ──────────────────────────────────────

test('requiredDocs: non-factored requires COI + Banking only', () => {
  const req = vvApi().requiredDocs({ isFactored: false });
  const keys = req.map((r) => r.key);
  // Array.from brings the JSDOM-realm array into the Node realm so strict
  // deepEqual's prototype check passes (contents are plain strings).
  assert.deepEqual(Array.from(keys).sort(), ['banking', 'coi']);
});

test('requiredDocs: factored also requires NOA/LOR (satisfied by noa OR lor)', () => {
  const req = vvApi().requiredDocs({ isFactored: true });
  const noa = req.find((r) => r.key === 'noa_lor');
  assert.ok(noa, 'NOA/LOR requirement present');
  assert.deepEqual(Array.from(noa.match).sort(), ['lor', 'noa']);
});

test('vettingSummary: no flags = clean', () => {
  const s = vvApi().vettingSummary([]);
  assert.equal(s.level, 'clean');
  assert.match(s.text, /Looks clean/);
});

test('vettingSummary: any stop = stop level', () => {
  const s = vvApi().vettingSummary([{ level: 'stop' }, { level: 'check' }]);
  assert.equal(s.level, 'stop');
  assert.match(s.text, /hard stop/);
});

test('vettingSummary: only checks = check level', () => {
  const s = vvApi().vettingSummary([{ level: 'check' }, { level: 'check' }]);
  assert.equal(s.level, 'check');
  assert.match(s.text, /to check/);
});

test('docs section shows "Needed" rows for missing required docs (factored)', async () => {
  const dom = makeDom();
  const w = dom.window;
  const rec = { ID: '1003', Vendor_Name: 'FACTORED LLC', Vendor_Status: 'Approved', MC: '5', USDOT: '6', Factoring_Company: 'ACME FACTORS' };
  // Only a COI on file; banking + NOA/LOR missing.
  w.fetch = makeVetFetch([rec], { risk: { flags: [] }, ipqs: {} }, [{ type: 'coi', label: 'Insurance (COI)', filename: 'coi.pdf', preview_token: 't1' }]);
  w.dispatchEvent(new w.Event('load'));
  await waitForRows(w);
  w.document.querySelector('.row').click();
  await new Promise((r) => setTimeout(r, 50));
  const docs = w.document.getElementById('vv-docs');
  const needed = Array.from(docs.querySelectorAll('.vv-doc-needed')).map((e) => e.textContent);
  assert.ok(needed.some((t) => /Banking/.test(t)), 'banking needed');
  assert.ok(needed.some((t) => /NOA or LOR/.test(t)), 'NOA/LOR needed');
  assert.ok(!needed.some((t) => /COI/.test(t)), 'COI present, not needed');
});

test('docs section: non-factored carrier never shows NOA/LOR as needed', async () => {
  const dom = makeDom();
  const w = dom.window;
  const rec = { ID: '1004', Vendor_Name: 'QUICKPAY LLC', Vendor_Status: 'Approved', MC: '7', USDOT: '8', Factoring_Company: '' };
  // COI only — Banking is missing so there IS one Needed row, but NOA/LOR must never appear.
  w.fetch = makeVetFetch([rec], { risk: { flags: [] }, ipqs: {} }, [
    { type: 'coi', label: 'Insurance (COI)', filename: 'coi.pdf', preview_token: 't1' }
  ]);
  w.dispatchEvent(new w.Event('load'));
  await waitForRows(w);
  w.document.querySelector('.row').click();
  await new Promise((r) => setTimeout(r, 50));
  const docs = w.document.getElementById('vv-docs');
  const needed = Array.from(docs.querySelectorAll('.vv-doc-needed')).map((e) => e.textContent);
  // (a) exactly one Needed row (Banking is missing)
  assert.equal(needed.length, 1, 'exactly one Needed row');
  // (b) it is the Banking row
  assert.ok(/Banking/.test(needed[0]), 'the Needed row is Banking');
  // (c) NOA/LOR is never demanded for a non-factored carrier
  assert.ok(!needed.some((t) => /NOA/.test(t)), 'NOA/LOR never needed for non-factored carrier');
});

test('Refresh button re-fetches profile and docs with refresh=1', async () => {
  const dom = makeDom();
  const w = dom.window;
  const seen = [];
  const rec = { ID: '1005', Vendor_Name: 'REFRESH LLC', Vendor_Status: 'Approved', MC: '9', USDOT: '10', Factoring_Company: '' };
  w.fetch = (url) => {
    seen.push(url);
    if (url.indexOf('/carrier-profile') !== -1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ risk: { flags: [] }, ipqs: {} }) });
    if (url.indexOf('/carrier-docs') !== -1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ documents: [] }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ records: [rec] }) });
  };
  w.dispatchEvent(new w.Event('load'));
  await waitForRows(w);
  w.document.querySelector('.row').click();
  await new Promise((r) => setTimeout(r, 50));
  w.document.getElementById('vv-refresh').click();
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(seen.some((u) => u.indexOf('/carrier-profile') !== -1 && u.indexOf('refresh=1') !== -1), 'profile refreshed');
  assert.ok(seen.some((u) => u.indexOf('/carrier-docs') !== -1 && u.indexOf('refresh=1') !== -1), 'docs refreshed');
});

test('static: Refresh control markup present', () => {
  assert.match(HTML, /id="vv-refresh"/);
});
