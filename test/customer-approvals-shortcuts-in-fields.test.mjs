// Tom, 2026-09-29: "I'm typing in the notes section and my 'k' button is not
// working." The panel's j/k/arrow/Esc shortcuts must never fire from a field.
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');
function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

async function openPanel() {
  const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
                              url: 'https://x.github.io/' }).window;
  await wait(50);
  w.fetch = function() { return Promise.resolve({ ok: false, status: 404, json: function() { return Promise.resolve({}); } }); };
  w.brokerEmail = 'pat@operfi.com';
  w.allClients = true;
  w.onRecordsLoaded([
    { ID: '1', Customer_Company_Name: 'FIRST CO', Credit_Decision: 'Awaiting Credit Decision' },
    { ID: '2', Customer_Company_Name: 'SECOND CO', Credit_Decision: 'Awaiting Credit Decision' }
  ]);
  await wait(20);
  const d = w.document;
  [...d.querySelectorAll('.row')].find(function(r) { return /FIRST CO/.test(r.textContent); }).click();
  await wait(10);
  return { w: w, d: d };
}

function press(w, target, key) {
  const ev = new w.KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true });
  target.dispatchEvent(ev);
  return ev;
}

function panelName(d) { return d.getElementById('panel').textContent; }

for (const key of ['k', 'j', 'ArrowUp', 'ArrowDown']) {
  test(`"${key}" typed in the notes box stays in the box`, async () => {
    const { w, d } = await openPanel();
    const notes = d.getElementById('dec-notes');
    assert.ok(notes, 'decision notes box renders for staff');
    const before = panelName(d);
    const ev = press(w, notes, key);
    assert.strictEqual(ev.defaultPrevented, false, 'the key reaches the text box');
    assert.strictEqual(panelName(d), before, 'the panel did not jump to another customer');
  });
}

test('Esc in a field does not close the panel on the typed note', async () => {
  const { w, d } = await openPanel();
  press(w, d.getElementById('dec-notes'), 'Escape');
  assert.ok(d.getElementById('panel').classList.contains('show'));
});

test('the shortcuts still work outside a field', async () => {
  const { w, d } = await openPanel();
  const before = panelName(d);
  const ev = press(w, d.body, 'j');
  assert.strictEqual(ev.defaultPrevented, true);
  assert.notStrictEqual(panelName(d), before, 'j moved to the next customer');
  press(w, d.body, 'Escape');
  assert.ok(!d.getElementById('panel').classList.contains('show'), 'Esc closes from the list');
});
