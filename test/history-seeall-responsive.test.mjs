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
        if (!/(^|[\s,])\.row\b/.test(rule.selectorText)) continue;
        const tracks = rule.style.getPropertyValue('grid-template-columns');
        // getPropertyValue() strips priority — !important only shows via getPropertyPriority().
        const important = rule.style.getPropertyPriority('grid-template-columns') === 'important';
        if (tracks) out.push({ selector: rule.selectorText, condition, tracks, important });
      }
    };
    walk(sheet.cssRules, '');
  }
  return out;
}

// Scoped to the row's own opening tag: a legitimate inline style on a child cell is not this
// test's business, and asserting over the whole row would fail it with a misleading message.
const openingTag = (html) => html.slice(0, html.indexOf('>') + 1);

test('the see-all grid is a class, not an inline style', () => {
  const w = makeDom();
  w.__setAllClients(true);
  const tag = openingTag(w.rowHtml(ROW, 0));
  // The root cause. An inline grid here is unreachable by any @media rule without !important.
  assert.doesNotMatch(tag, /style=/);
  assert.match(tag, /class="row [^"]*all-clients[^"]*"/);
});

test('a normal broker row gets neither the class nor an inline style', () => {
  const w = makeDom();
  w.__setAllClients(false);
  const tag = openingTag(w.rowHtml(ROW, 0));
  assert.doesNotMatch(tag, /all-clients/);
  assert.doesNotMatch(tag, /style=/);
});

test('the see-all class carries the 9-track grid (8 broker tracks + Client)', () => {
  const w = makeDom();
  const base = gridRules(w).find(r => r.condition === '' && r.selector.includes('.all-clients'));
  assert.ok(base, 'expected a top-level .row.all-clients grid rule');
  assert.equal(base.tracks.trim().split(/\s+/).length, 9);
});

// The actual regression guard, and the one that catches the original bug: a responsive block only
// overrides the see-all grid if it either names .row.all-clients (matching its (0,2,0) specificity
// and winning on source order) or carries !important. A bare `.row` at (0,1,0) loses, and see-all
// rows keep their 9-track grid.
//
// 900px is the band this fix repaired. 600px is belt-and-braces: the later <=640px block already
// wins there via !important, so the <=600px grid declaration has no observable effect today — it is
// asserted so that removing the 640px !important cannot silently reopen the bug.
for (const px of ['900px', '600px']) {
  test(`the <=${px} block can override the see-all grid`, () => {
    const w = makeDom();
    const rule = gridRules(w).find(r => r.condition.includes(px));
    assert.ok(rule, `expected a .row grid rule under max-width: ${px}`);
    assert.ok(
      rule.selector.includes('.row.all-clients') || rule.important,
      `<=${px} rule "${rule.selector}" cannot beat .row.all-clients — see-all rows will not collapse`
    );
  });
}

// Proves the guard above is not vacuous: the <=640px rule wins on !important alone, without naming
// the class. If getPropertyPriority ever stopped reporting priority, this fails loudly.
test('the <=640px block overrides via !important rather than the class', () => {
  const w = makeDom();
  const rule = gridRules(w).find(r => r.condition.includes('640px'));
  assert.ok(rule, 'expected a .row grid rule under max-width: 640px');
  assert.equal(rule.important, true);
  assert.doesNotMatch(rule.selector, /all-clients/);
});
