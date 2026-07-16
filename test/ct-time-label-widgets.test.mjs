// The CT label, on the two other widgets that render Added_Time.
//
// Both read /broker-report, which hardcodes the `funding-portal` Creator app (app.py:2883), and
// that app is US/Central — so Added_Time is Central wall clock and a CT label is correct. The
// Phoenix app (operfi-client-onboarding, reached only via CLIENT_BASE) renders no times anywhere,
// so there is no mixed-zone surface to get wrong.
//
// These build Dates directly rather than going through each widget's parseDate: a local-naive Date
// round-trips its digits through toLocale* in any timezone, so the assertions are zone-independent
// and would hold on a CI box anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

function boot(file) {
  const html = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://tcroteau01-commits.github.io/' + file,
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ records: [] }) });
    }
  });
  return dom.window;
}

const AT_10_34 = () => new Date(2026, 6, 14, 10, 34, 16);
const AT_MIDNIGHT = () => new Date(2026, 6, 14, 0, 0, 0);

for (const file of ['customer-approvals.html', 'carrier-onboarding.html']) {
  test(`${file}: fmtDateTime labels the time CT`, () => {
    const w = boot(file);
    assert.match(w.fmtDateTime(AT_10_34()), /10:34 AM CT/);
  });

  // The load-bearing guard: we LABEL Central digits, never convert them. If someone reworks the
  // widget's parseDate into a real timezone conversion, the digits shift and this fails.
  // 3:34 PM is the most likely such regression (10:34 CDT parsed as an absolute instant = 15:34 UTC).
  test(`${file}: the time digits are labeled, never shifted`, () => {
    const w = boot(file);
    assert.doesNotMatch(w.fmtDateTime(AT_10_34()), /3:34 PM/);
  });

  // Midnight means a date-only value (bulk import, or a date-only write like Credit_Decision_Date).
  // A calendar date has no zone to label, and must not gain a fabricated "12:00 AM CT".
  test(`${file}: a midnight value renders date-only, with no CT label`, () => {
    const w = boot(file);
    const out = w.fmtDateTime(AT_MIDNIGHT());
    assert.match(out, /Jul 14, 2026/);
    assert.doesNotMatch(out, /CT|AM|PM/);
  });

  test(`${file}: the label is the DST-safe "CT", not "CST" or "CDT"`, () => {
    const w = boot(file);
    assert.doesNotMatch(w.fmtDateTime(AT_10_34()), /CST|CDT/);
  });
}
