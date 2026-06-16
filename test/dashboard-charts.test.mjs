import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');

function mount() {
  let chartCount = 0;
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://x/dashboard.html?mock=1',          // triggers isLocalTest() -> MOCK_DASHBOARD
    beforeParse(w) {
      w.Chart = function () { chartCount++; };         // stub Chart.js (CDN won't load in jsdom)
    },
  });
  return { w: dom.window, charts: () => chartCount };
}

test('mounts aging + concentration donut charts and combo chart', async () => {
  const { w, charts } = mount();
  await new Promise(r => setTimeout(r, 50));           // let load + render run
  assert.ok(w.document.getElementById('chart-aging'), 'aging canvas');
  assert.ok(w.document.getElementById('chart-concentration'), 'concentration canvas');
  assert.ok(w.document.getElementById('chart-combo'), 'combo canvas');
  assert.equal(charts(), 3, 'three Chart instances created');
});
