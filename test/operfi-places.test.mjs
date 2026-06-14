import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const JS = readFileSync(new URL('../operfi-places.js', import.meta.url), 'utf8');
const HTML = '<!doctype html><html><body><input id="a"></body><script>' + JS + '</script></html>';

function mk(fetchImpl) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) { w.fetch = fetchImpl; },
  });
  return dom.window;
}

test('OperFiPlaces.attach renders predictions and onSelect receives the parsed address', async () => {
  const w = mk(function (url) {
    if (url.indexOf('/places-autocomplete') !== -1)
      return Promise.resolve({ json: () => Promise.resolve({ predictions: [{ description: '123 Main St, Dallas, TX', place_id: 'PID1' }] }) });
    if (url.indexOf('/place-details') !== -1)
      return Promise.resolve({ json: () => Promise.resolve({ street: '123 Main Street', city: 'Dallas', state: 'TX', zip: '75201', formatted: '123 Main St, Dallas, TX 75201, USA' }) });
    return Promise.resolve({ json: () => Promise.resolve({}) });
  });
  const input = w.document.getElementById('a');
  let got = null;
  w.OperFiPlaces.attach(input, { apiBase: 'http://api', email: 'b@op.com', onSelect: function (a) { got = a; } });

  input.value = '123 main';
  input.dispatchEvent(new w.Event('input'));
  await new Promise(r => setTimeout(r, 320));            // past the 250ms debounce

  const box = w.document.querySelector('.opf-places-results');
  assert.ok(box && box.style.display !== 'none', 'results dropdown is shown');
  const item = box.querySelector('.opf-places-item');
  assert.ok(item, 'a prediction item rendered');
  assert.match(item.textContent, /123 Main St, Dallas/);

  item.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 20));
  assert.ok(got, 'onSelect fired');
  assert.equal(got.city, 'Dallas');
  assert.equal(got.state, 'TX');
  assert.equal(got.zip, '75201');
});

test('OperFiPlaces.attach with no onSelect fills the input with the formatted address', async () => {
  const w = mk(function (url) {
    if (url.indexOf('/places-autocomplete') !== -1)
      return Promise.resolve({ json: () => Promise.resolve({ predictions: [{ description: 'Dallas, TX, USA', place_id: 'PID2' }] }) });
    if (url.indexOf('/place-details') !== -1)
      return Promise.resolve({ json: () => Promise.resolve({ city: 'Dallas', state: 'TX', formatted: 'Dallas, TX, USA' }) });
    return Promise.resolve({ json: () => Promise.resolve({}) });
  });
  const input = w.document.getElementById('a');
  w.OperFiPlaces.attach(input, { apiBase: 'http://api', email: 'b@op.com' });
  input.value = 'dallas';
  input.dispatchEvent(new w.Event('input'));
  await new Promise(r => setTimeout(r, 320));
  w.document.querySelector('.opf-places-item').dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 20));
  assert.equal(input.value, 'Dallas, TX, USA');
});

test('short queries (<3 chars) do not call the backend', async () => {
  let called = false;
  const w = mk(function () { called = true; return Promise.resolve({ json: () => Promise.resolve({}) }); });
  const input = w.document.getElementById('a');
  w.OperFiPlaces.attach(input, { apiBase: 'http://api', email: 'b@op.com' });
  input.value = '12';
  input.dispatchEvent(new w.Event('input'));
  await new Promise(r => setTimeout(r, 320));
  assert.equal(called, false);
});
