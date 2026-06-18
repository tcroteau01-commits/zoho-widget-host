import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../tms-load-detail.html', import.meta.url), 'utf8');

function makeWidget() {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://x.github.io/tms-load-detail.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ carriers: [], customers: [], templates: [] }) });
    }
  });
  return dom.window;
}

test('sections appear in the new workflow order', () => {
  const w = makeWidget();
  const headings = [...w.document.querySelectorAll('.card h3')].map(h => h.textContent.trim().toLowerCase());
  const customer = headings.findIndex(t => t.startsWith('customer'));
  const details = headings.findIndex(t => t.startsWith('load details'));
  const stops = headings.findIndex(t => t === 'stops');
  const carrier = headings.findIndex(t => t.startsWith('carrier'));
  assert.ok(customer < details && details < stops && stops < carrier,
    `order was ${headings}`);
});

test('status stepper container exists in the header and f-status is hidden', () => {
  const w = makeWidget();
  assert.ok(w.document.getElementById('status-stepper'));
  const fs = w.document.getElementById('f-status');
  assert.ok(fs);
  assert.equal(fs.type, 'hidden');
});

test('renderStepper marks current, makes auto steps locked, settable steps clickable', () => {
  const w = makeWidget();
  w.renderStepper('Covered');
  const stepper = w.document.getElementById('status-stepper');
  const cur = stepper.querySelector('.step.current');
  assert.equal(cur.dataset.status, 'Covered');
  // Ready to Submit + Submitted are locked (no data-set handler / .locked class)
  const ready = [...stepper.querySelectorAll('.step')].find(s => s.dataset.status === 'Ready to Submit');
  assert.ok(ready.classList.contains('locked'));
  // Draft is settable (clickable)
  const draft = [...stepper.querySelectorAll('.step')].find(s => s.dataset.status === 'Draft');
  assert.ok(draft.classList.contains('settable'));
});

test('clicking a settable step updates f-status', () => {
  const w = makeWidget();
  w.renderStepper('Draft');
  const stepper = w.document.getElementById('status-stepper');
  const dispatched = [...stepper.querySelectorAll('.step.settable')].find(s => s.dataset.status === 'Dispatched');
  dispatched.click();
  assert.equal(w.document.getElementById('f-status').value, 'Dispatched');
});
