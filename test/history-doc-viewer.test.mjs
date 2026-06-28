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

test('history page loads the shared pdf.js + OperFiDocViewer scripts (not cdnjs)', () => {
  assert.match(HTML, /app\.operfi\.com\/pdfjs\/pdf\.min\.js/, 'self-hosted pdf.js');
  assert.match(HTML, /app\.operfi\.com\/operfi-docviewer\.js/, 'shared viewer script');
  assert.doesNotMatch(HTML, /cdnjs\.cloudflare\.com/, 'no cdnjs pdf.js anymore');
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

test('openDocViewer delegates to OperFiDocViewer.open with the /funding-doc URL and a filename', () => {
  const w = makeDom();
  w.brokerEmail = 'b@x.com';
  let arg = null;
  w.OperFiDocViewer = { open: (o) => { arg = o; } };
  w.openDocViewer('rec_5', 'carrier', 'carrier_docs.pdf');
  assert.ok(arg, 'OperFiDocViewer.open was called');
  assert.match(arg.url, /\/funding-doc\?/);
  assert.match(arg.url, /record_id=rec_5/);
  assert.match(arg.url, /slot=carrier/);
  assert.match(arg.url, /email=/);
  assert.ok(arg.filename, 'a filename is passed');
});

test('openDocViewer no-ops safely when the shared viewer has not loaded', () => {
  const w = makeDom();
  delete w.OperFiDocViewer;
  assert.doesNotThrow(() => w.openDocViewer('rec_5', 'carrier', 'x.pdf'));
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
