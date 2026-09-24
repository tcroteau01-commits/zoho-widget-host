// CUSTEVENT1 -- the type breakdown on the attention bell. Tom asked whether bells
// belonged on each status chip instead; they don't, because a reference completing
// leaves the customer in the same status, so per-chip badges would mean checking
// several chips to assemble "what needs me". This is what per-chip badges WOULD have
// given -- knowing WHAT kind of news is waiting before clicking -- without splitting
// the one queue into several. Two surfaces: the bell's hover/focus tip (Tom's original
// ask -- "if they hover over it it shows them where it's at"), and a line under the
// chip row while the attention filter is active, which is what's reachable at 390px
// where hover doesn't exist. Counts here are EVENTS by kind; the chip's own number is
// CUSTOMERS -- see customer-approvals-attention-bell.test.mjs for that distinction's
// own tests.
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

function wait(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

async function bootSettled() {
  const w = boot();
  await wait(50);
  return w;
}

function statusBulkOk() {
  return Promise.resolve({ ok: true, json: function() { return Promise.resolve({ applications: {} }); } });
}

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

// 3 references + 1 boost request across 2 customers -- Delta Foods carries two
// references and the boost request, Acme Co carries one reference.
function mixedPayload() {
  return {
    events: [
      { id: 'ev1', subject_id: '1', account_id: 'a1', kind: 'reference_completed',
        summary: 'Trade reference 2 completed — Delta Foods', detail: {}, at: '2026-09-24T12:00:00+00:00' },
      { id: 'ev2', subject_id: '1', account_id: 'a1', kind: 'reference_completed',
        summary: 'Trade reference 1 completed — Delta Foods', detail: {}, at: '2026-09-24T11:00:00+00:00' },
      { id: 'ev3', subject_id: '1', account_id: 'a1', kind: 'credit_boost_requested',
        summary: 'Credit boost requested — Delta Foods', detail: {}, at: '2026-09-24T10:00:00+00:00' },
      { id: 'ev4', subject_id: '2', account_id: 'a2', kind: 'reference_completed',
        summary: 'Trade reference 1 completed — Acme Co', detail: {}, at: '2026-09-24T09:00:00+00:00' }
    ],
    total: 2,
    counts: { '1': 3, '2': 1 }
  };
}

async function loadMixed(w) {
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = fetchStub(function() { return Promise.resolve({ ok: true, json: function() { return Promise.resolve(mixedPayload()); } }); });
  w.onRecordsLoaded([
    rec({ ID: '1', Customer_Company_Name: 'Delta Foods' }),
    rec({ ID: '2', Customer_Company_Name: 'Acme Co' })
  ]);
  await wait(30);
}

// ── grouping + pluralisation ──────────────────────────────────────────────────

test('customerEventsKindCounts groups unread events by kind across every customer', async () => {
  const w = await bootSettled();
  await loadMixed(w);
  // Array.from rebuilds the list in this realm's Array -- customerEventsKindCounts
  // runs inside the jsdom window, so its return value's own Array.prototype differs
  // from this file's, which trips deepStrictEqual's prototype check even when the
  // contents match.
  const parts = Array.from(w.customerEventsKindCounts(), function(p) { return [p.kind, p.count]; });
  assert.deepStrictEqual(
    parts,
    [['reference_completed', 3], ['credit_boost_requested', 1]]
  );
});

test('customerEventsBreakdownText pluralises correctly, including a lone event of a kind', async () => {
  const w = await bootSettled();
  await loadMixed(w);
  const text = w.customerEventsBreakdownText();
  assert.match(text, /3 references/, 'three references, plural, not "3 reference"');
  assert.match(text, /1 boost request\b/, 'one boost request, singular, not "1 boost requests"');
  assert.doesNotMatch(text, /1 boost requests/, '"1 boost requests" reads as a bug');
});

test('a single event total is singular, not "1 references"', async () => {
  const w = await bootSettled();
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = fetchStub(function() {
    return Promise.resolve({ ok: true, json: function() {
      return Promise.resolve({
        events: [{ id: 'ev1', subject_id: '1', account_id: 'a1', kind: 'reference_completed',
                   summary: 'Trade reference 1 completed — Delta Foods', detail: {}, at: '2026-09-24T12:00:00+00:00' }],
        total: 1, counts: { '1': 1 }
      });
    } });
  });
  w.onRecordsLoaded([rec({ ID: '1', Customer_Company_Name: 'Delta Foods' })]);
  await wait(30);
  const text = w.customerEventsBreakdownText();
  assert.match(text, /\b1 reference\b/, 'exactly one reference reads singular');
  assert.doesNotMatch(text, /1 references/);
});

// ── the customers-vs-events distinction ─────────────────────────────────────────

test('the breakdown text spells out customers separately from the event counts by kind', async () => {
  const w = await bootSettled();
  await loadMixed(w);
  const text = w.customerEventsBreakdownText();
  // 2 distinct customers (Delta Foods, Acme Co) carry 4 events between them (3
  // references + 1 boost request) -- the wording must make that gap obvious rather
  // than reading like a mismatch between the chip's "2" and the events listed here.
  assert.match(text, /^2 customers:/, 'leads with the customer count, spelled out as "customers"');
  assert.match(text, /3 references/);
  assert.match(text, /1 boost request\b/);
});

// ── unknown kind: neutral fallback, never dropped or shown raw ──────────────────

test('an unrecognized kind is counted under a neutral fallback, not dropped or shown raw', async () => {
  const w = await bootSettled();
  w.brokerEmail = 'staff@operfi.com';
  w.allClients = true;
  w.fetch = fetchStub(function() {
    return Promise.resolve({ ok: true, json: function() {
      return Promise.resolve({
        events: [
          { id: 'ev1', subject_id: '1', account_id: 'a1', kind: 'reference_completed',
            summary: 'Trade reference completed — Delta Foods', detail: {}, at: '2026-09-24T12:00:00+00:00' },
          { id: 'ev2', subject_id: '2', account_id: 'a2', kind: 'some_future_kind_v2',
            summary: 'Something new — Acme Co', detail: {}, at: '2026-09-24T11:00:00+00:00' }
        ],
        total: 2, counts: { '1': 1, '2': 1 }
      });
    } });
  });
  w.onRecordsLoaded([
    rec({ ID: '1', Customer_Company_Name: 'Delta Foods' }),
    rec({ ID: '2', Customer_Company_Name: 'Acme Co' })
  ]);
  await wait(30);
  const parts = w.customerEventsKindCounts();
  assert.strictEqual(parts.length, 2, 'one bucket for the known kind, one fallback bucket -- not dropped');
  const fallback = parts.find(function(p) { return p.kind !== 'reference_completed'; });
  assert.ok(fallback, 'the unknown kind must still be counted, under some bucket');
  assert.strictEqual(fallback.count, 1);
  const text = w.customerEventsBreakdownText();
  assert.doesNotMatch(text, /some_future_kind_v2/, 'the raw internal kind string must never reach the reviewer');
  assert.match(text, /1 update\b/, 'an unlabeled kind reads as a neutral "update", not raw or blank');
});

// ── the bell's hover/focus content ───────────────────────────────────────────────

test('the bell chip carries the breakdown as a focusable, hoverable tip', async () => {
  const w = await bootSettled();
  const d = w.document;
  await loadMixed(w);
  const bell = d.getElementById('attn-bell');
  assert.ok(bell, 'bell chip should render');
  assert.strictEqual(bell.tabIndex, 0, 'the bell must be keyboard-focusable, not just clickable');
  const tip = bell.querySelector('.ca-attn-tip');
  assert.ok(tip, 'the bell must carry a hover/focus tip element');
  assert.match(tip.textContent, /3 references/);
  assert.match(tip.textContent, /1 boost request\b/);
  assert.match(tip.textContent, /^2 customers:/);
  // Accessible even without CSS :hover, since jsdom does not evaluate it.
  assert.match(bell.getAttribute('aria-label') || '', /3 references/);
});

// ── the active-filter line ───────────────────────────────────────────────────────

test('the active-filter line is hidden until the attention filter is turned on', async () => {
  const w = await bootSettled();
  const d = w.document;
  await loadMixed(w);
  const line = d.getElementById('attn-breakdown-line');
  assert.ok(line, 'the breakdown line element must exist in the DOM');
  assert.strictEqual(line.style.display, 'none', 'quiet until the attention filter is active');
  assert.strictEqual(line.textContent, '');
});

test('activating the attention filter reveals the breakdown line with the same wording as the tip', async () => {
  const w = await bootSettled();
  const d = w.document;
  await loadMixed(w);
  d.getElementById('attn-bell').click();
  const line = d.getElementById('attn-breakdown-line');
  assert.notStrictEqual(line.style.display, 'none', 'the line becomes visible while the filter is active');
  assert.match(line.textContent, /3 references/);
  assert.match(line.textContent, /1 boost request\b/);
  assert.match(line.textContent, /^2 customers:/);
});

test('turning the attention filter back off hides the breakdown line again', async () => {
  const w = await bootSettled();
  const d = w.document;
  await loadMixed(w);
  d.getElementById('attn-bell').click();
  d.getElementById('attn-bell').click();
  const line = d.getElementById('attn-breakdown-line');
  assert.strictEqual(line.style.display, 'none');
  assert.strictEqual(line.textContent, '');
});

// ── CSS exists, reachable at narrow width ────────────────────────────────────────

test('the breakdown tip and line styles exist, and the tip is capped to viewport width at 390px', () => {
  assert.match(html, /\.ca-attn-tip\s*\{/);
  assert.match(html, /\.ca-attn-breakdown-line\s*\{/);
  assert.match(html, /@media \(max-width:\s*640px\)\s*\{[\s\S]*\.ca-attn-tip\s*\{[^}]*max-width:\s*calc\(100vw/,
    'the tip must not run off-screen at a phone width where the breakdown line -- not the tip -- is the reachable surface');
});
