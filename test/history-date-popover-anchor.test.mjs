// The date-range popover must open RIGHTWARD from its button.
//
// The bug: `.date-popover` was `position:absolute; right:0; width:380px`, which
// right-aligns the panel to its trigger. That trigger sits at the LEFT of the
// toolbar, so the panel extended 380px leftward — off the widget and underneath
// the portal's left sidebar. On a wide desktop monitor the overhang still landed
// on canvas and it looked fine; on a laptop the Quick Range presets and half the
// custom-range row were behind the nav and unclickable.
//
// jsdom does no layout, so there is nothing to measure here. What these tests can
// pin is the cause: the base rule must not be right-anchored, and the narrow-screen
// override that already handled this case must survive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../history.html', import.meta.url), 'utf8');

/** The declaration block of the FIRST `.date-popover {` rule (the base rule). */
function baseRule() {
  const start = HTML.indexOf('.date-popover {');
  assert.notEqual(start, -1, '.date-popover base rule not found');
  const open = HTML.indexOf('{', start);
  const close = HTML.indexOf('}', open);
  return HTML.slice(open + 1, close);
}

test('the popover is anchored to the left of its button, not the right', () => {
  const css = baseRule();
  assert.match(css, /(^|\s)left:\s*0;/, 'expected left:0 so the panel opens rightward');
  assert.match(css, /(^|\s)right:\s*auto;/, 'expected right:auto to clear any inherited anchor');
  assert.doesNotMatch(
    css, /(^|\s)right:\s*0;/,
    'right:0 pushes this 380px panel off-widget and under the portal sidebar',
  );
});

test('the popover can never be wider than the frame it lives in', () => {
  assert.match(baseRule(), /max-width:\s*calc\(100vw/,
    'a fixed width with no max-width can overflow a narrow frame');
});

test('the narrow-screen override still spans the full trigger', () => {
  // The responsive block deliberately re-pins both edges once the toolbar stacks
  // and the picker goes full width. It comes later in the file, so it wins on
  // source order — losing it would regress small screens.
  const idx = HTML.indexOf('.date-popover { width: auto; left: 0; right: 0; }');
  assert.notEqual(idx, -1, 'narrow-screen .date-popover override is missing');
  assert.ok(idx > HTML.indexOf('.date-popover {'),
    'the override must come after the base rule to take effect');
});
