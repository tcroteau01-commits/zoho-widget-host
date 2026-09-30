// RELTIME1 (Tom, 2026-09-30): "It says Just Now but my slack notification says
// 12:36 and it's currently 2:12PM." Creator times are CENTRAL wall clock and
// event times are UTC without a zone; both were compared to Date.now() as if
// they were the viewer's own clock.
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');

// Tom is in Arizona: no DST, UTC-7, two hours behind Central in the summer.
process.env.TZ = 'America/Phoenix';

function boot(nowIso) {
  const w = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.github.io/' }).window;
  const fixed = Date.parse(nowIso);
  w.Date.now = () => fixed;
  return w;
}

test('a 12:36 PM Arizona submission reads 1h ago at 2:12 PM, not "just now"', () => {
  const w = boot('2026-09-30T21:12:00Z');              // 2:12 PM MST
  // Creator stamps Added_Time in Central: 12:36 PM MST is 2:36 PM CDT.
  const d = w.parseDate('30-Sep-2026 14:36:00');
  assert.strictEqual(w.fmtRelative(d), '1h ago');
});

test('a Central time in winter (CST) converts too', () => {
  const w = boot('2026-01-15T16:30:00Z');
  assert.strictEqual(w.fmtRelative(w.parseDate('15-Jan-2026 10:00:00')), '30m ago');
});

test('an event time with no zone is UTC, not the viewer\'s clock', () => {
  const w = boot('2026-09-30T21:12:00Z');
  const d = w.parseUtcAsCentral('2026-09-30T19:36:00.123000');
  assert.strictEqual(w.fmtRelative(d), '1h ago');
  // and the panel shows it in Central, which is what its "CT" label says
  assert.strictEqual(w.fmtDateTime(d), 'Sep 30, 2026 · 2:36 PM CT');
});

test('an event time that already carries a zone is read as given', () => {
  const w = boot('2026-09-30T21:12:00Z');
  assert.strictEqual(w.fmtRelative(w.parseUtcAsCentral('2026-09-30T21:10:00+00:00')), '2m ago');
});

test('something submitted seconds ago is still "just now"', () => {
  const w = boot('2026-09-30T19:36:30Z');
  assert.strictEqual(w.fmtRelative(w.parseDate('30-Sep-2026 14:36:00')), 'just now');
});
