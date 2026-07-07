import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('carrier-profile.html'), 'utf8');
function boot() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  return dom.window;
}

test('decision boxes no longer render a description line', () => {
  const w = boot();
  const descs = w.document.querySelectorAll('#cp-decision-options .decision-option-desc');
  assert.equal(descs.length, 0);
});

test('decision boxes still expose an icon + name for all four decisions, in order', () => {
  const w = boot();
  const opts = w.document.querySelectorAll('#cp-decision-options .decision-option');
  assert.equal(opts.length, 4);
  const names = Array.from(opts).map((o) => o.querySelector('.decision-option-name').textContent);
  assert.deepEqual(names, ['Approve', 'Approve with Caution', 'Hold', 'Decline']);
  opts.forEach((o) => assert.ok(o.querySelector('.decision-option-icon'), 'icon missing'));
});

test('each decision box keeps its data-decision attribute for click wiring', () => {
  const w = boot();
  const opts = w.document.querySelectorAll('#cp-decision-options .decision-option');
  const decisions = Array.from(opts).map((o) => o.getAttribute('data-decision'));
  assert.deepEqual(decisions, ['Approve', 'Approve with Caution', 'Hold', 'Decline']);
});

test('.decision-option-desc CSS rule is removed and remaining boxes get more vertical padding', () => {
  assert.doesNotMatch(html, /\.decision-option-desc\s*\{/);
  assert.match(html, /\.decision-option\s*\{[^}]*padding:\s*20px 10px;/);
  assert.match(html, /\.decision-option-name\s*\{[^}]*font-size:\s*14px;/);
});

test('.decision-option top-aligns its content instead of vertically centering, so a wrapped title (e.g. "Approve with Caution") cannot push its icon out of line with the other boxes', () => {
  assert.match(html, /\.decision-option\s*\{[^}]*align-items:\s*center;/);
  assert.doesNotMatch(html, /\.decision-option\s*\{[^}]*justify-content:\s*center;/);
});

test('.decision-option sets min-width: 0 so its longest label (e.g. "Approve with Caution") cannot force its grid column wider than the other three equal 1fr columns', () => {
  assert.match(html, /\.decision-option\s*\{[^}]*min-width:\s*0;/);
});
