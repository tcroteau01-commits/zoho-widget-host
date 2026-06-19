import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../tms-load-board.html', import.meta.url), 'utf8');
function board() {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', url: 'https://x.github.io/tms-load-board.html',
    beforeParse(w){ w.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(()=>{}) } } }; w.fetch = () => Promise.resolve({ json: () => Promise.resolve({ loads: [] }) }); } });
  return dom.window;
}

test('board filter + stepper status lists are on the new model', () => {
  const w = board();
  assert.ok(w.STATUSES.includes('Available'));
  assert.ok(w.STATUSES.includes('Ready to Submit'));
  assert.ok(!w.STATUSES.includes('Booked'));
  assert.ok(w.TMS_STATUSES.includes('Available'));
  assert.ok(w.TMS_STATUSES.includes('Ready to Submit'));
  assert.ok(!w.TMS_STATUSES.includes('Booked'));
});

test('bulk-status select offers the settable statuses and not Booked', () => {
  const w = board();
  const opts = [...w.document.getElementById('bulk-status').options].map(o => o.textContent);
  assert.ok(opts.includes('Available'));
  assert.ok(!opts.includes('Booked'));
});

test('chipClass maps the new statuses to css-safe classes', () => {
  const w = board();
  assert.equal(w.chipClass('Available'), 'chip available');
  assert.equal(w.chipClass('Ready to Submit'), 'chip readytosubmit');
});

test('stylesheet defines the new chip classes and drops the blue/purple rainbow', () => {
  const w = board();
  const css = [...w.document.querySelectorAll('style')].map(s => s.textContent).join('\n');
  assert.match(css, /\.chip\.available/);
  assert.match(css, /\.chip\.readytosubmit/);
  assert.match(css, /\.chip\.issue/);
  // covered should now be amber, not blue #1565c0
  assert.doesNotMatch(css, /#1565c0/);
  assert.doesNotMatch(css, /#5e35b1/);
});
