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

// A fetch that returns a PDF blob.
const pdfFetch = () => Promise.resolve({
  ok: true,
  blob: () => Promise.resolve({ type: 'application/pdf', arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })
});

// Stub canvas 2d context (jsdom has no canvas backend) + a fake pdfjsLib.
function withPdf(window, numPages) {
  window.HTMLCanvasElement.prototype.getContext = () => ({});
  let rendered = 0;
  window.pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument: () => ({
      promise: Promise.resolve({
        numPages,
        getPage: () => Promise.resolve({
          getViewport: ({ scale }) => ({ width: 100 * scale, height: 140 * scale }),
          render: () => { rendered++; return { promise: Promise.resolve() }; }
        })
      })
    })
  };
  return () => rendered;
}

test('PDF doc renders one canvas per page', async () => {
  const w = mk(pdfFetch);
  withPdf(w, 3);
  w.OperFiDocViewer.open({ url: '/x.pdf', filename: 'merged.pdf' });
  await new Promise(r => setTimeout(r, 60));
  assert.equal(w.document.querySelectorAll('.opf-dv-body canvas').length, 3);
  assert.equal(w.document.querySelector('.opf-dv-body iframe'), null, 'never an iframe');
});

test('page indicator shows the page count', async () => {
  const w = mk(pdfFetch);
  withPdf(w, 2);
  w.OperFiDocViewer.open({ url: '/x.pdf', filename: 'merged.pdf' });
  await new Promise(r => setTimeout(r, 60));
  assert.match(w.document.querySelector('.opf-dv-page').textContent, /2/);
});

test('zoom in re-renders the PDF (more render calls)', async () => {
  const w = mk(pdfFetch);
  const count = withPdf(w, 1);
  w.OperFiDocViewer.open({ url: '/x.pdf', filename: 'merged.pdf' });
  await new Promise(r => setTimeout(r, 60));
  const before = count();
  w.document.querySelector('.opf-dv-zoom-in').click();
  await new Promise(r => setTimeout(r, 60));
  assert.ok(count() > before, 'zoom should trigger a re-render');
});

test('PDF parse failure shows a loud error', async () => {
  const w = mk(pdfFetch);
  w.HTMLCanvasElement.prototype.getContext = () => ({});
  w.pdfjsLib = { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.reject(new Error('bad pdf')) }) };
  w.OperFiDocViewer.open({ url: '/x.pdf', filename: 'merged.pdf' });
  await new Promise(r => setTimeout(r, 60));
  assert.ok(w.document.querySelector('.opf-dv-error'), 'error shown on parse failure');
});
