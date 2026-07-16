import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../history.html', import.meta.url), 'utf8');

function makeDom() {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/history.html?serviceOrigin=https://brokerhub.operfi.com',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ records: [] }) });
    }
  });
  return dom.window;
}

test('isAppMidnight is true for a bulk-import timestamp at exactly midnight', () => {
  const w = makeDom();
  assert.equal(w.isAppMidnight('13-Jul-2026 00:00:00'), true);
});

test('isAppMidnight is true for a date-only value with no time component', () => {
  const w = makeDom();
  assert.equal(w.isAppMidnight('13-Jul-2026'), true);
});

test('isAppMidnight is false for a real submit time', () => {
  const w = makeDom();
  assert.equal(w.isAppMidnight('13-Jul-2026 06:40:15'), false);
});

test('isAppMidnight is false for junk, null, and non-strings', () => {
  const w = makeDom();
  assert.equal(w.isAppMidnight(null), false);
  assert.equal(w.isAppMidnight(undefined), false);
  assert.equal(w.isAppMidnight(''), false);
  assert.equal(w.isAppMidnight('not a date'), false);
  assert.equal(w.isAppMidnight(new Date()), false);
});

test('the old Date-based isMidnight is gone', () => {
  const w = makeDom();
  assert.equal(typeof w.isMidnight, 'undefined');
});

// These assert on the shape of the output, not the literal date: after Task 2 the rendered day
// depends on the viewer's zone, and a hardcoded "Jul 13" would fail west of Phoenix.
test('fmtDateTime omits the time for a midnight raw value', () => {
  const w = makeDom();
  const out = w.fmtDateTime(w.parseDate('13-Jul-2026 00:00:00'), '13-Jul-2026 00:00:00');
  assert.match(out, /^\w{3} \d{1,2}, 2026$/);
  assert.doesNotMatch(out, /AM|PM|·/);
});

test('fmtDateTime includes the time for a real raw value', () => {
  const w = makeDom();
  const out = w.fmtDateTime(w.parseDate('13-Jul-2026 06:40:15'), '13-Jul-2026 06:40:15');
  assert.match(out, /^\w{3} \d{1,2}, 2026 · \d{1,2}:\d{2} (AM|PM)/);
});

test('rowHtml renders an em dash, not a time, for a midnight bulk-import row', () => {
  const w = makeDom();
  const html = w.rowHtml({ ID: '1', Purchase_Status: 'Purchased', Added_Time: '13-Jul-2026 00:00:00' }, 0);
  assert.doesNotMatch(html, /12:00 AM/);
  assert.match(html, /Submitted<\/div><div class="cell-val">—/);
});

// 06:40:15 Phoenix (UTC-7, no DST) is 13:40:15 UTC.
test('parseDate interprets Added_Time digits as Phoenix, not local', () => {
  const w = makeDom();
  assert.equal(w.parseDate('13-Jul-2026 06:40:15').toISOString(), '2026-07-13T13:40:15.000Z');
});

test('parseDate handles the hour rolling past UTC midnight', () => {
  const w = makeDom();
  // 20:00 Phoenix on Jul 13 is 03:00 UTC on Jul 14. Date.UTC normalizes hour 27.
  assert.equal(w.parseDate('13-Jul-2026 20:00:00').toISOString(), '2026-07-14T03:00:00.000Z');
});

test('parseDate treats a date-only value as Phoenix midnight', () => {
  const w = makeDom();
  assert.equal(w.parseDate('13-Jul-2026').toISOString(), '2026-07-13T07:00:00.000Z');
});

test('parseDate is unchanged in winter — Phoenix does not observe DST', () => {
  const w = makeDom();
  assert.equal(w.parseDate('13-Jan-2026 06:40:15').toISOString(), '2026-01-13T13:40:15.000Z');
});

test('parseDate still returns null for empty and unparseable values', () => {
  const w = makeDom();
  assert.equal(w.parseDate(''), null);
  assert.equal(w.parseDate(null), null);
  assert.equal(w.parseDate('not a date'), null);
});

test('fmtTime appends a timezone abbreviation', () => {
  const w = makeDom();
  assert.match(w.fmtTime(w.parseDate('13-Jul-2026 06:40:15')), /^\d{1,2}:\d{2} (AM|PM) [A-Z]{2,5}$/);
});

// Purchase_Date is a calendar date (schema type = date), not an instant. It must never be offset —
// a shifted calendar date renders a day early for viewers west of Phoenix.
test('parseCalendarDate does not apply the Phoenix offset', () => {
  const w = makeDom();
  const d = w.parseCalendarDate('13-Jan-2026');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 0);
  assert.equal(d.getDate(), 13);
  assert.equal(d.getHours(), 0);
});

test('parseCalendarDate renders the day as written, for any viewer', () => {
  const w = makeDom();
  assert.match(w.fmtDateShort(w.parseCalendarDate('13-Jan-2026')), /^Jan 13, 2026$/);
});

test('parseCalendarDate ignores a 00:00:00 time component if Creator sends one', () => {
  const w = makeDom();
  assert.match(w.fmtDateShort(w.parseCalendarDate('13-Jan-2026 00:00:00')), /^Jan 13, 2026$/);
});

test('parseCalendarDate still returns null for empty and unparseable values', () => {
  const w = makeDom();
  assert.equal(w.parseCalendarDate(''), null);
  assert.equal(w.parseCalendarDate(null), null);
  assert.equal(w.parseCalendarDate('not a date'), null);
});

test('a bulk-import midnight row still renders an em dash after conversion', () => {
  const w = makeDom();
  // Phoenix midnight is 3:00 AM Eastern — the pre-Task-1 Date-based check would have missed this.
  const html = w.rowHtml({ ID: '1', Purchase_Status: 'Purchased', Added_Time: '13-Jul-2026 00:00:00' }, 0);
  assert.match(html, /Submitted<\/div><div class="cell-val">—/);
  assert.doesNotMatch(html, /3:00 AM/);
});
