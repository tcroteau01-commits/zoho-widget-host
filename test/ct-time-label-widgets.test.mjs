// The CT label, on the two other widgets that render Added_Time.
//
// Both read /broker-report, which hardcodes the `funding-portal` Creator app (app.py:2883), and
// that app is US/Central — so Added_Time is Central wall clock and a CT label is correct. The
// Phoenix app (operfi-client-onboarding, reached only via CLIENT_BASE) renders no times anywhere,
// so there is no mixed-zone surface to get wrong.
//
// These feed the raw Creator string through each widget's own parseDate, exactly as production
// does, so a rework of parseDate into a real timezone conversion shifts the digits and fails here.
// Still zone-independent: parseDate's regex branch is local-naive, so the digits round-trip through
// toLocale* identically on a CI box in any timezone.
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

// Raw Creator wire values, exactly as /broker-report returns them.
const AT_10_34 = '14-Jul-2026 10:34:16';
const AT_MIDNIGHT = '14-Jul-2026 00:00:00';

const render = (w, raw) => w.fmtDateTime(w.parseDate(raw));

for (const file of ['customer-approvals.html', 'carrier-onboarding.html']) {
  // The load-bearing guard. Central digits in, the same digits out, labeled. This goes through the
  // widget's real parseDate, so reworking parseDate into a timezone conversion fails this test —
  // 3:34 PM being the likely shape of that regression (10:34 CDT as an absolute instant = 15:34 UTC).
  test(`${file}: fmtDateTime labels the time CT without shifting the digits`, () => {
    const w = boot(file);
    assert.match(render(w, AT_10_34), /10:34 AM CT/);
  });

  test(`${file}: a late-evening time does not roll to another hour or day`, () => {
    const w = boot(file);
    assert.match(render(w, '14-Jul-2026 23:15:00'), /Jul 14, 2026.*11:15 PM CT/);
  });

  // Midnight means a date-only value: a bulk import, or a date-only write like
  // Credit_Decision_Date. A calendar date has no zone, so it must not gain a "12:00 AM CT".
  test(`${file}: a midnight value renders date-only, with no CT label`, () => {
    const w = boot(file);
    const out = render(w, AT_MIDNIGHT);
    assert.match(out, /Jul 14, 2026/);
    assert.doesNotMatch(out, /CT|AM|PM/);
  });

  test(`${file}: the label is the DST-safe "CT", not "CST" or "CDT"`, () => {
    const w = boot(file);
    assert.doesNotMatch(render(w, AT_10_34), /CST|CDT/);
  });
}
