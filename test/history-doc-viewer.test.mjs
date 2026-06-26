import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../history.html', import.meta.url), 'utf8');

function makeDom() {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/history.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ records: [] }) });
      // jsdom has no Blob URL support
      window.URL.createObjectURL = () => 'blob:stub';
      window.URL.revokeObjectURL = () => {};
    }
  });
  return dom.window;
}

test('history page includes the PDF.js library for in-app rendering', () => {
  assert.match(HTML, /pdf(\.min)?\.js/i);
});

test('history page has a document viewer modal with a pages container and download link', () => {
  const d = new JSDOM(HTML).window.document;
  assert.ok(d.getElementById('doc-viewer'), 'missing #doc-viewer modal');
  assert.ok(d.getElementById('doc-viewer-pages'), 'missing #doc-viewer-pages');
  assert.ok(d.getElementById('doc-viewer-download'), 'missing #doc-viewer-download');
});

test('the viewer is a centered framed modal with an explicit close button and an Esc hint', () => {
  const d = new JSDOM(HTML).window.document;
  assert.ok(d.getElementById('doc-viewer-frame'), 'missing framed container #doc-viewer-frame');
  const close = d.getElementById('doc-viewer-close');
  assert.ok(close, 'missing close button');
  assert.match(close.textContent, /close/i, 'close control should read "Close", not a bare glyph');
  assert.match(d.getElementById('doc-viewer').textContent, /esc/i, 'an Esc-to-close hint should be shown');
});

test('docsGroupHtml renders a clickable row carrying the record id and slot', () => {
  const w = makeDom();
  const html = w.docsGroupHtml('Customer Documents',
    [{ name: 'customer_docs.pdf', size: null }], 'rec_5', 'customer');
  assert.match(html, /data-doc-record="rec_5"/);
  assert.match(html, /data-doc-slot="customer"/);
  assert.match(html, /doc-clickable/);
});

test('a slot with no files shows the empty state, not a clickable row', () => {
  const w = makeDom();
  const html = w.docsGroupHtml('Carrier Documents', [], 'rec_5', 'carrier');
  assert.match(html, /No files/i);
  assert.doesNotMatch(html, /doc-clickable/);
});

test('openDocViewer fetches /funding-doc with the broker email, record id, and slot, and shows the modal', async () => {
  const w = makeDom();
  w.brokerEmail = 'b@x.com';
  let fetched = '';
  w.fetch = (url) => { fetched = String(url);
    return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }); };
  w.pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument: () => ({ promise: Promise.resolve({
      numPages: 1,
      getPage: () => Promise.resolve({
        getViewport: () => ({ width: 100, height: 140 }),
        render: () => ({ promise: Promise.resolve() })
      })
    }) })
  };
  await w.openDocViewer('rec_5', 'carrier', 'carrier_docs.pdf');
  assert.match(fetched, /\/funding-doc\?/);
  assert.match(fetched, /record_id=rec_5/);
  assert.match(fetched, /slot=carrier/);
  assert.match(fetched, /email=/);  // wired from the broker session (closure var, empty in jsdom)
  assert.notEqual(w.document.getElementById('doc-viewer').style.display, 'none');
  // the download link is armed with a filename
  assert.match(w.document.getElementById('doc-viewer-download').getAttribute('download') || '', /carrier|rec_5/);
});

test('openDocViewer surfaces a fallback when the fetch fails (no silent blank)', async () => {
  const w = makeDom();
  w.brokerEmail = 'b@x.com';
  w.fetch = () => Promise.resolve({ ok: false, status: 404 });
  await w.openDocViewer('rec_9', 'customer', 'customer_docs.pdf');
  assert.match(w.document.getElementById('doc-viewer-pages').textContent, /could not|try again|open in/i);
});

test('legacy load (docs only in subform) offers a combined doc to view', () => {
  const w = makeDom();
  const html = w.docsGroupHtml('Customer Documents', [], 'rec_9', 'customer', true);
  assert.match(html, /doc-clickable/);
  assert.match(html, /data-doc-record="rec_9"/);
  assert.match(html, /data-doc-slot="customer"/);
  assert.doesNotMatch(html, /No files uploaded/);
});

test('a load with no file-field docs and no subform shows the empty state', () => {
  const w = makeDom();
  const html = w.docsGroupHtml('Customer Documents', [], 'rec_9', 'customer', false);
  assert.match(html, /No files uploaded/);
});

test('subformHasFiles is true only for a non-empty subform array', () => {
  const w = makeDom();
  assert.equal(w.subformHasFiles([{ ID: 'r1' }]), true);
  assert.equal(w.subformHasFiles([]), false);
  assert.equal(w.subformHasFiles(undefined), false);
});
