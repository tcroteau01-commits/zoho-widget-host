import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../tms-load-detail.html', import.meta.url), 'utf8');

function boot(loadId) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.loadId = loadId || '';
  return w;
}

test('setMode toggles view/edit containers', () => {
  const w = boot('77');
  w.setMode('view');
  assert.ok(!w.document.getElementById('view-mode').classList.contains('hidden'));
  assert.ok(w.document.getElementById('edit-mode').classList.contains('hidden'));
  w.setMode('edit');
  assert.ok(w.document.getElementById('view-mode').classList.contains('hidden'));
  assert.ok(!w.document.getElementById('edit-mode').classList.contains('hidden'));
});
