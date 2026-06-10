import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('includes operfi-impersonate.js', () => {
  assert.match(HTML, /operfi-impersonate\.js/);
});

test('targets the Render backend, not PythonAnywhere or the SDK getRecords', () => {
  assert.match(HTML, /operfi-broker-api\.onrender\.com/);
  assert.doesNotMatch(HTML, /pythonanywhere/i);
  assert.doesNotMatch(HTML, /CREATOR\.DATA\.getRecords/);
});

test('has the three stepper sections and a sticky summary rail', () => {
  const dom = new JSDOM(HTML);
  const d = dom.window.document;
  assert.ok(d.querySelector('[data-step="customer"]'));
  assert.ok(d.querySelector('[data-step="carrier"]'));
  assert.ok(d.querySelector('[data-step="review"]'));
  assert.ok(d.querySelector('#summary-rail'));
  assert.ok(d.querySelector('#submit-btn'));
});

test('preserves the client-side file-merge pipeline includes', () => {
  assert.match(HTML, /pdf-lib/);
  assert.match(HTML, /heic2any/);
  assert.match(HTML, /mammoth/);
  assert.match(HTML, /UTIF/i);
});

test('no test-only UI remains', () => {
  assert.doesNotMatch(HTML, /Fill Test Data/i);
  assert.doesNotMatch(HTML, /JS NOT RUNNING/i);
});

test('exposes the DOM controls later tasks will target', () => {
  const d = new JSDOM(HTML).window.document;
  ['customer-select','customer-reference','customer-rate','customer-error',
   'carrier-select','carrier-rate','carrier-factoring-invoice','rate-con',
   'carrier-error','credit-banner','submit-status'].forEach(function (id) {
    assert.ok(d.getElementById(id), 'missing #' + id);
  });
});
