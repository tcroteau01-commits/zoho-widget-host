import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../tms-load-detail.html', import.meta.url), 'utf8');

function makeWidget() {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/tms-load-detail.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = function(url) {
        if (String(url).indexOf('/tms-carriers') !== -1) return Promise.resolve({ json: () => Promise.resolve({ carriers: [] }) });
        if (String(url).indexOf('/tms-customers') !== -1) return Promise.resolve({ json: () => Promise.resolve({ customers: [] }) });
        if (String(url).indexOf('/tms-templates') !== -1) return Promise.resolve({ json: () => Promise.resolve({ templates: [] }) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      };
    }
  });
  return { window: dom.window, document: dom.window.document };
}

test('openDocViewer delegates to OperFiDocViewer.open with the url and title as filename', () => {
  const { window } = makeWidget();
  assert.equal(typeof window.openDocViewer, 'function', 'openDocViewer must be defined');
  let arg = null;
  window.OperFiDocViewer = { open: (o) => { arg = o; } };
  window.openDocViewer('/tms-doc-file?t=abc', 'POD');
  assert.ok(arg, 'OperFiDocViewer.open was called');
  assert.equal(arg.url, '/tms-doc-file?t=abc', 'url passed through unchanged');
  assert.equal(arg.filename, 'POD', 'title passed as filename');
});

test('openDocViewer no-ops safely when the shared viewer has not loaded', () => {
  const { window } = makeWidget();
  delete window.OperFiDocViewer;
  assert.doesNotThrow(() => window.openDocViewer('/x', 'POD'));
});

test('the page loads the shared pdf.js + OperFiDocViewer scripts', () => {
  assert.match(HTML, /app\.operfi\.com\/pdfjs\/pdf\.min\.js/);
  assert.match(HTML, /app\.operfi\.com\/operfi-docviewer\.js/);
});
