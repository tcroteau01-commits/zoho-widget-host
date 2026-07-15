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
