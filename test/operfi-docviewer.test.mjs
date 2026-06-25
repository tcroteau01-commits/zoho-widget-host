import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const JS = readFileSync(new URL('../operfi-docviewer.js', import.meta.url), 'utf8');
const HTML = '<!doctype html><html><body></body><script>' + JS + '</script></html>';

function mk(fetchImpl) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = fetchImpl;
      w.URL.createObjectURL = () => 'blob:fake';
      w.URL.revokeObjectURL = () => {};
    }
  });
  return dom.window;
}

// A fetch that returns a PNG blob.
const imgFetch = () => Promise.resolve({
  ok: true,
  blob: () => Promise.resolve({ type: 'image/png', arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) })
});

test('exposes OperFiDocViewer.open and .close', () => {
  const w = mk(imgFetch);
  assert.equal(typeof w.OperFiDocViewer.open, 'function');
  assert.equal(typeof w.OperFiDocViewer.close, 'function');
});

test('backdrop is hidden until open() is called', () => {
  const w = mk(imgFetch);
  w.OperFiDocViewer.open({ url: '/x', filename: 'COI-1.png' });
  const bd = w.document.querySelector('.opf-dv-backdrop');
  assert.ok(bd, 'backdrop must exist');
  assert.ok(!bd.classList.contains('hidden'), 'backdrop visible after open');
});

test('image doc renders an <img>, not an iframe', async () => {
  const w = mk(imgFetch);
  w.OperFiDocViewer.open({ url: '/x', filename: 'COI-1.png' });
  await new Promise(r => setTimeout(r, 20));
  assert.ok(w.document.querySelector('.opf-dv-body img'), 'img rendered');
  assert.equal(w.document.querySelector('.opf-dv-body iframe'), null, 'no iframe');
});

test('filename is set as text (not HTML)', () => {
  const w = mk(imgFetch);
  w.OperFiDocViewer.open({ url: '/x', filename: '<b>NOA</b>.png' });
  const t = w.document.querySelector('.opf-dv-title');
  assert.equal(t.textContent, '<b>NOA</b>.png');
  assert.equal(t.querySelector('b'), null, 'filename must not be parsed as HTML');
});

test('download anchor points at the object URL with the filename', async () => {
  const w = mk(imgFetch);
  w.OperFiDocViewer.open({ url: '/x', filename: 'Banking-1.png' });
  await new Promise(r => setTimeout(r, 20));
  const a = w.document.querySelector('.opf-dv-download');
  assert.equal(a.getAttribute('download'), 'Banking-1.png');
  assert.equal(a.getAttribute('href'), 'blob:fake');
});

test('fetch failure shows a loud error, no iframe, no auto-download', async () => {
  const w = mk(() => Promise.resolve({ ok: false, status: 404 }));
  w.OperFiDocViewer.open({ url: '/x', filename: 'NOA-1.pdf' });
  await new Promise(r => setTimeout(r, 20));
  assert.ok(w.document.querySelector('.opf-dv-error'), 'error panel shown');
  assert.equal(w.document.querySelector('.opf-dv-body iframe'), null);
});

test('close hides the backdrop', () => {
  const w = mk(imgFetch);
  w.OperFiDocViewer.open({ url: '/x', filename: 'COI-1.png' });
  w.OperFiDocViewer.close();
  assert.ok(w.document.querySelector('.opf-dv-backdrop').classList.contains('hidden'));
});
