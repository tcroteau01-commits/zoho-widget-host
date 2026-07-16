// Admin see-all rows must collapse on narrow screens like every other row.
//
// The bug: see-all rows carried their wider grid as an INLINE style attribute. An inline style
// beats every stylesheet rule that lacks !important, so the responsive @media rules could not
// touch them and see-all rows stayed at full width on tablets. (Phones escaped only because the
// <=640px block already worked around this with !important.)
//
// The fix removes the cause rather than adding more !important: the see-all grid moves to a
// `.row.all-clients` class, and the media blocks name that same class so their override wins on
// source order. These tests pin both halves — no inline style, and media rules that can reach it.
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

const ROW = { ID: '1', Purchase_Status: 'Purchased', Added_Time: '14-Jul-2026 10:34:16',
  Load_Rate_Confirmation_Number: '4471902', Customer_Rate: '1000', Carrier_Rate: '900' };

// Walk the widget's inline <style> for every rule that sets grid-template-columns on .row,
// tagged with the media condition it sits under ('' = top level).
function gridRules(w) {
  const out = [];
  for (const sheet of w.document.styleSheets) {
    const walk = (rules, condition) => {
      for (const rule of rules) {
        if (rule.cssRules) { walk(rule.cssRules, rule.conditionText || rule.media?.mediaText || ''); continue; }
        if (!rule.selectorText || !rule.style) continue;
        if (!rule.selectorText.includes('.row')) continue;
        const tracks = rule.style.getPropertyValue('grid-template-columns');
        if (tracks) out.push({ selector: rule.selectorText, condition, tracks });
      }
    };
    walk(sheet.cssRules, '');
  }
  return out;
}

test('the see-all grid is a class, not an inline style', () => {
  const w = makeDom();
  w.__setAllClients(true);
  const html = w.rowHtml(ROW, 0);
  // The root cause. An inline grid here is unreachable by any @media rule without !important.
  assert.doesNotMatch(html, /style="/);
  assert.match(html, /class="row [^"]*all-clients[^"]*"/);
});

test('a normal broker row gets neither the class nor an inline style', () => {
  const w = makeDom();
  w.__setAllClients(false);
  const html = w.rowHtml(ROW, 0);
  assert.doesNotMatch(html, /all-clients/);
  assert.doesNotMatch(html, /style="/);
});

test('the see-all class carries the 9-track grid (8 broker tracks + Client)', () => {
  const w = makeDom();
  const base = gridRules(w).find(r => r.condition === '' && r.selector.includes('.all-clients'));
  assert.ok(base, 'expected a top-level .row.all-clients grid rule');
  assert.equal(base.tracks.trim().split(/\s+/).length, 9);
});

// The actual regression guard: each responsive block must name .row.all-clients, or its (0,1,0)
// `.row` selector loses to the (0,2,0) class rule and see-all rows never collapse.
for (const px of ['900px', '600px']) {
  test(`the <=${px} block can override the see-all grid`, () => {
    const w = makeDom();
    const rule = gridRules(w).find(r => r.condition.includes(px));
    assert.ok(rule, `expected a .row grid rule under max-width: ${px}`);
    assert.ok(
      rule.selector.includes('.row.all-clients') || rule.tracks.includes('!important'),
      `<=${px} rule "${rule.selector}" cannot beat .row.all-clients — see-all rows will not collapse`
    );
  });
}
