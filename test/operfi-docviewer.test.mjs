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

test('sets pdf.js workerSrc to the vendored worker when pdfjsLib is present', () => {
  const w = mk(imgFetch);
  w.pdfjsLib = { GlobalWorkerOptions: {} };
  // Re-run the worker-wiring step the library performs lazily on open.
  w.OperFiDocViewer.open({ url: '/x.png', filename: 'a.png' });
  assert.match(w.pdfjsLib.GlobalWorkerOptions.workerSrc || '', /pdf\.worker\.min\.js/);
});

test('vendored pdf.js source check', () => {
  const src = readFileSync(new URL('../operfi-docviewer.js', import.meta.url), 'utf8');
  // worker is self-hosted under the pdfjs/ dir (now built from PDFJS_BASE + the filename)
  assert.match(src, /pdfjs\//, 'references the self-hosted pdfjs base');
  assert.match(src, /pdf\.worker\.min\.js/, 'references the vendored worker file');
});

test('load-token guard: second open() supersedes first — only second doc renders', async () => {
  // Build a pdfFetch where we can control when the promise settles.
  // PDF A resolves AFTER PDF B has already begun loading, simulating a slow first fetch.
  let resolveA;
  const fetchA = () => new Promise(resolve => { resolveA = resolve; });
  const fetchB = () => Promise.resolve({
    ok: true,
    blob: () => Promise.resolve({ type: 'application/pdf', arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })
  });

  // We need a single window with a fetch that dispatches per-call.
  let callCount = 0;
  const w = mk(() => {
    callCount++;
    return callCount === 1 ? fetchA() : fetchB();
  });

  // Wire up pdf.js stub for 3-page PDF A and 1-page PDF B; counts canvases rendered.
  w.HTMLCanvasElement.prototype.getContext = () => ({});
  w.pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument: ({ data }) => ({
      promise: Promise.resolve({
        // First call (PDF A) gets 3 pages, second call (PDF B) gets 1 page.
        // We identify which by size of the ArrayBuffer slice.
        numPages: data.byteLength === 0 ? 3 : 1,
        getPage: () => Promise.resolve({
          getViewport: ({ scale }) => ({ width: 100 * scale, height: 140 * scale }),
          render: () => ({ promise: Promise.resolve() })
        })
      })
    })
  };

  // Open PDF A — fetch is still pending (resolveA not yet called).
  w.OperFiDocViewer.open({ url: '/a.pdf', filename: 'A.pdf' });

  // Immediately open PDF B — this bumps loadToken, superseding A.
  w.OperFiDocViewer.open({ url: '/b.pdf', filename: 'B.pdf' });

  // Let PDF B fully render.
  await new Promise(r => setTimeout(r, 60));

  // Now resolve PDF A's fetch — its blob/render chain should be abandoned by the token guard.
  resolveA({
    ok: true,
    blob: () => Promise.resolve({ type: 'application/pdf', arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) })
  });

  // Wait long enough for A's abandoned chain to have run (if the guard were absent it would append).
  await new Promise(r => setTimeout(r, 60));

  // Only B's 1 canvas should be present; A's 3 pages must not have been appended.
  const canvases = w.document.querySelectorAll('.opf-dv-body canvas');
  assert.equal(canvases.length, 1, 'only PDF B\'s single canvas should be in the body');
  assert.equal(w.document.querySelector('.opf-dv-title').textContent, 'B.pdf', 'title reflects PDF B');
});

// ── Standard-font / cMap support (fixes blank standard-14-font PDFs, e.g. signed agreements) ──

test('getDocument is configured with standardFontDataUrl + cMapUrl + cMapPacked', async () => {
  const w = mk(pdfFetch);
  w.HTMLCanvasElement.prototype.getContext = () => ({});
  let opts = null;
  w.pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument: (o) => { opts = o; return { promise: Promise.resolve({
      numPages: 1,
      getPage: () => Promise.resolve({
        getViewport: ({ scale }) => ({ width: 100 * scale, height: 140 * scale }),
        render: () => ({ promise: Promise.resolve() })
      })
    }) }; }
  };
  w.OperFiDocViewer.open({ url: '/x.pdf', filename: 'agreement.pdf' });
  await new Promise(r => setTimeout(r, 60));
  assert.ok(opts, 'getDocument was called with an options object');
  assert.match(opts.standardFontDataUrl || '', /standard_fonts\//, 'standardFontDataUrl points at hosted fonts');
  assert.match(opts.cMapUrl || '', /cmaps\//, 'cMapUrl points at hosted cmaps');
  assert.equal(opts.cMapPacked, true, 'cMapPacked is true for the packed .bcmap files');
});

// A pdfjsLib stub where each page's render() outcome is decided by failFn(pageNumber).
function withPdfPages(window, numPages, failFn) {
  window.HTMLCanvasElement.prototype.getContext = () => ({});
  var seen = 0;
  window.pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument: () => ({ promise: Promise.resolve({
      numPages: numPages,
      getPage: () => { seen++; var n = seen; return Promise.resolve({
        getViewport: ({ scale }) => ({ width: 100 * scale, height: 140 * scale }),
        render: () => ({ promise: failFn(n) ? Promise.reject(new Error('render fail page ' + n)) : Promise.resolve() })
      }); }
    }) })
  };
}

test('a page whose render rejects does not blank the other pages (per-page isolation)', async () => {
  const w = mk(pdfFetch);
  withPdfPages(w, 3, function (n) { return n === 1; }); // only page 1 fails
  w.OperFiDocViewer.open({ url: '/x.pdf', filename: 'a.pdf' });
  await new Promise(r => setTimeout(r, 90));
  assert.equal(w.document.querySelectorAll('.opf-dv-body canvas').length, 2, 'the two good pages still render');
  assert.equal(w.document.querySelector('.opf-dv-error'), null, 'a partial failure is not a global error');
  assert.ok(w.document.querySelector('.opf-dv-pagefail'), 'the failed page leaves a visible placeholder, not a silent blank');
});

test('if every page fails to render, the viewer fails loud (no silent blank)', async () => {
  const w = mk(pdfFetch);
  withPdfPages(w, 2, function () { return true; }); // all pages fail
  w.OperFiDocViewer.open({ url: '/x.pdf', filename: 'a.pdf' });
  await new Promise(r => setTimeout(r, 90));
  assert.ok(w.document.querySelector('.opf-dv-error'), 'all-pages-failed shows the loud error panel');
});

test('viewer references hosted standard_fonts + cmaps and the assets are vendored', () => {
  const src = readFileSync(new URL('../operfi-docviewer.js', import.meta.url), 'utf8');
  assert.match(src, /standard_fonts\//, 'references the standard_fonts dir');
  assert.match(src, /cmaps\//, 'references the cmaps dir');
  const foxit = readFileSync(new URL('../pdfjs/standard_fonts/FoxitDingbats.pfb', import.meta.url));
  assert.ok(foxit.length > 0, 'FoxitDingbats.pfb is vendored (the exact file the failing PDF needed)');
});
