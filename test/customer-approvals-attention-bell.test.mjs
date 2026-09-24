// CUSTEVENT1 -- the attention bell (OperFi staff only). Tom, 2026-09-24: "if a trade
// ref completes a form and the customer is 20 down on the list ... can we make some
// sort of bell icon on the filter bubbles so our credit guy knows there was an
// update ... They should have to mark that flag or change as read so that
// notification goes away." One bulk call per list load (/customer-events?scope=operfi),
// same discipline as fetchCreditAppStatusBulk (customer-approvals-credit-app-row-progress
// .test.mjs): never a fetch per row, and any failure leaves the screen exactly as it is
// today. See docs/superpowers/specs/2026-09-24-custevent1-attention-bell-design.md.
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');

function boot() {
  return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
                           url: 'https://x.github.io/' }).window;
}

function rec(over) {
  return Object.assign({ ID: '1', Customer_Company_Name: 'ACME', Credit_Decision: '' }, over || {});
}

function manyRecords(n) {
  var out = [];
  for (var i = 1; i <= n; i++) out.push(rec({ ID: String(i), Customer_Company_Name: 'Co ' + i }));
  return out;
}

function wait(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

// The row click handler (not a separately-exposed openPanel) is how every other
// panel test in this suite opens the panel -- see view-vendors.test.mjs's own
// `.row`.click() pattern.
function openRow(d, matchText) {
  var rows = [...d.querySelectorAll('.row')];
  var row = matchText ? rows.find(function(el) { return el.textContent.indexOf(matchText) !== -1; }) : rows[0];
  if (!row) throw new Error('no row found matching ' + matchText);
  row.click();
}

// Same pattern customer-approvals-credit-app-row-progress.test.mjs uses: let the
// widget's own window-load boot (no ZOHO SDK present -> showError rewrites #results)
// settle first, so the only thing touching #results after is this test.
async function bootSettled() {
  const w = boot();
  await wait(50);
  return w;
}

// 3 events, 2 distinct customers -- the fixture for "the bell counts customers, not
// events". events[0]/[1] are subject '1' (Delta Foods), newest first; events[2] is
// subject '2' (Acme Co).
function eventsPayload(overrides) {
  return Object.assign({
    events: [
      { id: 'ev1', subject_id: '1', account_id: 'a1', kind: 'reference_completed',
        summary: 'Trade reference 2 completed — Delta Foods', detail: {}, at: '2026-09-24T12:00:00+00:00' },
      { id: 'ev2', subject_id: '1', account_id: 'a1', kind: 'credit_check_submitted',
        summary: 'Credit check submitted — Delta Foods', detail: {}, at: '2026-09-23T09:00:00+00:00' },
      { id: 'ev3', subject_id: '2', account_id: 'a2', kind: 'credit_app_received',
        summary: 'Credit application received — Acme Co', detail: {}, at: '2026-09-24T10:00:00+00:00' }
    ],
    total: 2,
    counts: { '1': 2, '2': 1 }
  }, overrides || {});
}

function statusBulkOk() {
  return Promise.resolve({ ok: true, json: function() { return Promise.resolve({ applications: {} }); } });
}

// A router stub: status-bulk always answers empty, /customer-events answers the given
// payload (or a handler), everything else 404s -- the same "quiet degrade" outcome
// fetchCreditAppRisk/fetchFraudCheck already rely on in their own test files.
function fetchStub(eventsHandler, extra) {
  return function(url, opts) {
    if (/\/credit-app\/status-bulk/.test(url)) return statusBulkOk();
    if (/\/customer-events\/clear/.test(url)) {
      if (extra && extra.clear) return extra.clear(url, opts);
      return Promise.resolve({ status: 200, text: function() { return Promise.resolve(JSON.stringify({ cleared: [], count: 0 })); } });
    }
    if (/\/customer-events\?/.test(url)) return eventsHandler(url, opts);
    return Promise.resolve({ ok: false, status: 404 });
  };
}

// ── one call for the whole list, staff only ─────────────────────────────────

test('fetchCustomerEventsBulk hits /customer-events once for a list of many rows, not per row', async () => {
  const w = await bootSettled();
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  var calls = [];
  w.fetch = function(url, opts) {
    calls.push(url);
    return fetchStub(function() { return Promise.resolve({ ok: true, json: function() { return Promise.resolve(eventsPayload()); } }); })(url, opts);
  };
  w.onRecordsLoaded(manyRecords(75));
  await wait(30);
  const eventCalls = calls.filter(function(u) { return /\/customer-events\?/.test(u); });
  assert.strictEqual(eventCalls.length, 1, 'exactly one bulk call regardless of row count');
  assert.match(eventCalls[0], /scope=operfi/);
  assert.match(eventCalls[0], /email=staff%40operfi\.com/);
});

test('a non-staff viewer never calls /customer-events and gets no bell', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'broker@customer.com';
  w.allClients = false;
  var called = false;
  w.fetch = function(url, opts) {
    if (/\/customer-events/.test(url)) called = true;
    return fetchStub(function() { return Promise.resolve({ ok: true, json: function() { return Promise.resolve(eventsPayload()); } }); })(url, opts);
  };
  w.onRecordsLoaded([rec({ ID: '1' })]);
  await wait(30);
  assert.strictEqual(called, false, '/customer-events must never be requested for a non-staff viewer');
  assert.strictEqual(d.getElementById('attn-bell'), null, 'no bell chip for a non-staff viewer');
});

// ── the bell's count ─────────────────────────────────────────────────────────

test('the bell shows the distinct-customer count, not the event count', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = fetchStub(function() { return Promise.resolve({ ok: true, json: function() { return Promise.resolve(eventsPayload()); } }); });
  w.onRecordsLoaded([
    rec({ ID: '1', Customer_Company_Name: 'Delta Foods' }),
    rec({ ID: '2', Customer_Company_Name: 'Acme Co' })
  ]);
  await wait(30);
  const bell = d.getElementById('attn-bell');
  assert.ok(bell, 'bell chip should render');
  assert.match(bell.innerHTML, /<span class="count">2<\/span>/,
    'the payload carries 3 events across 2 customers -- the bell must read 2');
});

test('no unread events means no bell at all -- quiet, screen looks exactly as today', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = fetchStub(function() { return Promise.resolve({ ok: true, json: function() { return Promise.resolve({ events: [], total: 0, counts: {} }); } }); });
  w.onRecordsLoaded([rec({ ID: '1' })]);
  await wait(30);
  assert.strictEqual(d.getElementById('attn-bell'), null);
});

// ── the bell as a filter ─────────────────────────────────────────────────────

test('activating the bell shows only customers with unread events', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = fetchStub(function() { return Promise.resolve({ ok: true, json: function() { return Promise.resolve(eventsPayload()); } }); });
  w.onRecordsLoaded([
    rec({ ID: '1', Customer_Company_Name: 'Delta Foods' }),
    rec({ ID: '2', Customer_Company_Name: 'Acme Co' }),
    rec({ ID: '3', Customer_Company_Name: 'No Events Co' })
  ]);
  await wait(30);
  assert.match(d.getElementById('results').innerHTML, /No Events Co/, 'unfiltered list shows all three');

  d.getElementById('attn-bell').click();
  const filtered = d.getElementById('results').innerHTML;
  assert.match(filtered, /Delta Foods/);
  assert.match(filtered, /Acme Co/);
  assert.doesNotMatch(filtered, /No Events Co/, 'the bell filter hides the customer with nothing unread');
  assert.match(d.getElementById('attn-bell').className, /\bactive\b/);
});

test('clicking the bell again turns the filter back off, like the other chips', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = fetchStub(function() { return Promise.resolve({ ok: true, json: function() { return Promise.resolve(eventsPayload()); } }); });
  w.onRecordsLoaded([
    rec({ ID: '1', Customer_Company_Name: 'Delta Foods' }),
    rec({ ID: '3', Customer_Company_Name: 'No Events Co' })
  ]);
  await wait(30);
  d.getElementById('attn-bell').click();
  assert.doesNotMatch(d.getElementById('results').innerHTML, /No Events Co/);
  d.getElementById('attn-bell').click();
  assert.match(d.getElementById('results').innerHTML, /No Events Co/, 'clicking again restores the full list');
  assert.doesNotMatch(d.getElementById('attn-bell').className, /\bactive\b/);
});

// ── the row marker ────────────────────────────────────────────────────────────

test('a row with unread events carries the marker with the latest summary', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = fetchStub(function() { return Promise.resolve({ ok: true, json: function() { return Promise.resolve(eventsPayload()); } }); });
  w.onRecordsLoaded([rec({ ID: '1', Customer_Company_Name: 'Delta Foods' })]);
  await wait(30);
  const html = d.getElementById('results').innerHTML;
  assert.match(html, /ca-attn-marker/);
  assert.match(html, /Trade reference 2 completed — Delta Foods/,
    'the newest event (events[0], per the API contract) is what shows on the row');
  assert.doesNotMatch(html, /Credit check submitted — Delta Foods/,
    'only the latest summary shows on the row, not the older one too');
  assert.match(html, /class="ca-attn-time"/, 'a relative time accompanies the summary');
});

test('a row with no unread events gets no marker', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = fetchStub(function() { return Promise.resolve({ ok: true, json: function() { return Promise.resolve(eventsPayload()); } }); });
  w.onRecordsLoaded([
    rec({ ID: '1', Customer_Company_Name: 'Delta Foods' }),
    rec({ ID: '9', Customer_Company_Name: 'Quiet Co' })
  ]);
  await wait(30);
  const rows = [...d.querySelectorAll('.row')];
  const quietRow = rows.find(function(el) { return /Quiet Co/.test(el.innerHTML); });
  assert.ok(quietRow);
  assert.doesNotMatch(quietRow.innerHTML, /ca-attn-marker/);
});

test('customerEventRowMarkerHtml returns empty for a non-staff viewer even with matching state', () => {
  const w = boot();
  w.allClients = false;
  assert.strictEqual(w.customerEventRowMarkerHtml(rec({ ID: '1' })), '');
});

// ── quiet degradation on the bulk fetch: 403 / 404 / network / malformed ────

test('a 403 from /customer-events leaves the list exactly as it is today', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = fetchStub(function() { return Promise.resolve({ ok: false, status: 403 }); });
  w.onRecordsLoaded([rec({ ID: '1' })]);
  await wait(30);
  assert.match(d.getElementById('results').innerHTML, /ACME/);
  assert.strictEqual(d.getElementById('attn-bell'), null);
  assert.doesNotMatch(d.getElementById('results').innerHTML, /ca-attn-marker/);
});

test('a 404 from /customer-events (flag off) leaves the list exactly as it is today', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = fetchStub(function() { return Promise.resolve({ ok: false, status: 404 }); });
  w.onRecordsLoaded([rec({ ID: '1' })]);
  await wait(30);
  assert.match(d.getElementById('results').innerHTML, /ACME/);
  assert.strictEqual(d.getElementById('attn-bell'), null);
});

test('a dropped connection to /customer-events leaves the list exactly as it is today', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = fetchStub(function() { return Promise.reject(new Error('network down')); });
  w.onRecordsLoaded([rec({ ID: '1' })]);
  await wait(30);
  assert.match(d.getElementById('results').innerHTML, /ACME/);
  assert.strictEqual(d.getElementById('attn-bell'), null);
});

test('a malformed body from /customer-events (no events array) leaves the list unchanged', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = fetchStub(function() { return Promise.resolve({ ok: true, json: function() { return Promise.resolve({ nonsense: true }); } }); });
  w.onRecordsLoaded([rec({ ID: '1' })]);
  await wait(30);
  assert.match(d.getElementById('results').innerHTML, /ACME/);
  assert.strictEqual(d.getElementById('attn-bell'), null);
});

test('no fetch available in this environment does not throw for a staff viewer', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  assert.doesNotThrow(function() { w.onRecordsLoaded([rec({ ID: '1' })]); });
  await wait(30);
  assert.match(d.getElementById('results').innerHTML, /ACME/);
});

// ── the detail pane: unread events + Mark reviewed ───────────────────────────

test('the attention section is absent from the DOM entirely for a non-staff viewer', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'broker@customer.com';
  w.allClients = false;
  w.fetch = fetchStub(function() { return Promise.resolve({ ok: false, status: 404 }); });
  w.onRecordsLoaded([rec({ ID: '1' })]);
  await wait(30);
  openRow(d);
  await wait(10);
  assert.strictEqual(d.getElementById('ca-attn-section'), null);
});

test('opening a customer with unread events lists them with times but clears nothing', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  var clearCalled = false;
  w.fetch = fetchStub(
    function() { return Promise.resolve({ ok: true, json: function() { return Promise.resolve(eventsPayload()); } }); },
    { clear: function() { clearCalled = true; return Promise.resolve({ status: 200, text: function() { return Promise.resolve('{}'); } }); } }
  );
  w.onRecordsLoaded([rec({ ID: '1', Customer_Company_Name: 'Delta Foods' })]);
  await wait(30);
  openRow(d);
  await wait(10);
  const section = d.getElementById('ca-attn-section');
  assert.notEqual(section.style.display, 'none', 'the section should be visible for a customer with unread events');
  assert.match(section.innerHTML, /Trade reference 2 completed — Delta Foods/);
  assert.match(section.innerHTML, /Credit check submitted — Delta Foods/, 'both unread events for this customer show, not just the latest');
  assert.match(section.innerHTML, /Mark reviewed/);
  assert.strictEqual(clearCalled, false, 'opening the record must not itself clear anything');
  // bell is unaffected by merely opening the record
  assert.match(d.getElementById('attn-bell').innerHTML, /count">2</);
});

test('Mark reviewed calls clear with {email, subject_id}, then updates the row marker and the bell without a reload', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  var clearBody = null;
  w.fetch = fetchStub(
    function() { return Promise.resolve({ ok: true, json: function() { return Promise.resolve(eventsPayload()); } }); },
    { clear: function(url, opts) {
        clearBody = JSON.parse(opts.body);
        return Promise.resolve({ status: 200, text: function() { return Promise.resolve(JSON.stringify({ cleared: ['ev1', 'ev2'], count: 2 })); } });
      } }
  );
  w.onRecordsLoaded([
    rec({ ID: '1', Customer_Company_Name: 'Delta Foods' }),
    rec({ ID: '2', Customer_Company_Name: 'Acme Co' })
  ]);
  await wait(30);
  assert.match(d.getElementById('attn-bell').innerHTML, /count">2</);

  openRow(d, 'Delta Foods');
  await wait(10);
  d.getElementById('ca-attn-clear').click();
  await wait(30);

  assert.deepStrictEqual(clearBody, { email: 'staff@operfi.com', subject_id: '1' });

  // the bell decrements from 2 to 1 -- Acme Co is still unread
  assert.match(d.getElementById('attn-bell').innerHTML, /count">1</);

  // the row marker is gone for Delta Foods but still present for Acme Co
  const rows = [...d.querySelectorAll('.row')];
  const deltaRow = rows.find(function(el) { return /Delta Foods/.test(el.innerHTML); });
  const acmeRow = rows.find(function(el) { return /Acme Co/.test(el.innerHTML); });
  assert.doesNotMatch(deltaRow.innerHTML, /ca-attn-marker/);
  assert.match(acmeRow.innerHTML, /ca-attn-marker/);

  // the panel, still open on Delta Foods, now shows nothing left to review
  assert.strictEqual(d.getElementById('ca-attn-section').style.display, 'none');
});

test('when the bell is the active filter and the last unread customer is cleared, ' +
     'the bell disappears, the filter turns itself off, and the panel stays open', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = fetchStub(
    function() {
      return Promise.resolve({ ok: true, json: function() {
        return Promise.resolve({
          events: [{ id: 'ev1', subject_id: '1', account_id: 'a1', kind: 'reference_completed',
                     summary: 'Trade reference 2 completed — Delta Foods', detail: {}, at: '2026-09-24T12:00:00+00:00' }],
          total: 1, counts: { '1': 1 }
        });
      } });
    },
    { clear: function() { return Promise.resolve({ status: 200, text: function() { return Promise.resolve(JSON.stringify({ cleared: ['ev1'], count: 1 })); } }); } }
  );
  w.onRecordsLoaded([
    rec({ ID: '1', Customer_Company_Name: 'Delta Foods' }),
    rec({ ID: '2', Customer_Company_Name: 'No Events Co' })
  ]);
  await wait(30);

  d.getElementById('attn-bell').click();   // activate the bell filter
  assert.match(d.getElementById('results').innerHTML, /Delta Foods/);
  assert.doesNotMatch(d.getElementById('results').innerHTML, /No Events Co/);

  openRow(d, 'Delta Foods');
  await wait(10);
  d.getElementById('ca-attn-clear').click();
  await wait(30);

  assert.strictEqual(d.getElementById('attn-bell'), null, 'the bell disappears once nothing is unread anywhere');
  assert.match(d.getElementById('results').innerHTML, /No Events Co/,
    'the attention filter turned itself off, so the rest of the list returns');
  assert.ok(d.getElementById('panel').classList.contains('show'), 'the panel stays open on the same customer');
  assert.match(d.getElementById('panel').innerHTML, /Delta Foods/);
  assert.strictEqual(d.getElementById('ca-attn-section').style.display, 'none');
});

test('a non-200 from clear leaves the marker and bell unchanged and shows an error', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = fetchStub(
    function() { return Promise.resolve({ ok: true, json: function() { return Promise.resolve(eventsPayload()); } }); },
    { clear: function() { return Promise.resolve({ status: 500, text: function() { return Promise.resolve(JSON.stringify({ error: 'db down' })); } }); } }
  );
  w.onRecordsLoaded([rec({ ID: '1', Customer_Company_Name: 'Delta Foods' })]);
  await wait(30);
  openRow(d);
  await wait(10);
  d.getElementById('ca-attn-clear').click();
  await wait(30);
  assert.match(d.getElementById('attn-bell').innerHTML, /count">2</, 'a failed clear must not decrement the bell');
  assert.match(d.getElementById('results').innerHTML, /ca-attn-marker/, 'a failed clear must not drop the row marker');
  assert.match(d.getElementById('ca-attn-msg').textContent, /db down|Could not mark reviewed/);
});

test('a network failure on clear leaves the marker and bell unchanged', async () => {
  const w = await bootSettled();
  const d = w.document;
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = fetchStub(
    function() { return Promise.resolve({ ok: true, json: function() { return Promise.resolve(eventsPayload()); } }); },
    { clear: function() { return Promise.reject(new Error('offline')); } }
  );
  w.onRecordsLoaded([rec({ ID: '1', Customer_Company_Name: 'Delta Foods' })]);
  await wait(30);
  openRow(d);
  await wait(10);
  assert.doesNotThrow(function() { d.getElementById('ca-attn-clear').click(); });
  await wait(30);
  assert.match(d.getElementById('attn-bell').innerHTML, /count">2</);
});

// ── the CSS exists and is scoped under ca-attn / chip-bell ───────────────────

test('the attention bell styles exist, scoped under chip-bell / ca-attn', () => {
  assert.match(html, /\.chip\.chip-bell\s*\{/);
  assert.match(html, /\.ca-attn-marker\s*\{/);
  assert.match(html, /\.ca-attn-event\s*\{/);
});
