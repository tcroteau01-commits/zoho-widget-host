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

test('openDocViewer reveals the modal and sets iframe src + title', () => {
  const { window, document } = makeWidget();
  assert.equal(typeof window.openDocViewer, 'function', 'openDocViewer must be defined');

  // modal should be hidden before open
  const backdrop = document.querySelector('.doc-viewer-backdrop');
  assert.ok(backdrop, '.doc-viewer-backdrop element must exist');
  assert.ok(backdrop.classList.contains('hidden'), 'backdrop should be hidden before open');

  window.openDocViewer('/x', 'POD');

  assert.ok(!backdrop.classList.contains('hidden'), 'backdrop should be visible after openDocViewer');

  const iframe = document.querySelector('.doc-viewer iframe');
  assert.ok(iframe, 'iframe must exist inside .doc-viewer');
  assert.equal(iframe.src, 'https://tcroteau01-commits.github.io/x', 'iframe src must be the URL passed in');

  const titleEl = document.querySelector('.doc-viewer-title');
  assert.ok(titleEl, '.doc-viewer-title element must exist');
  assert.match(titleEl.textContent, /POD/, 'title must show the doc name');
});

test('fallback anchor href equals the url passed to openDocViewer', () => {
  const { window, document } = makeWidget();
  window.openDocViewer('/x', 'POD');

  const anchor = document.querySelector('.doc-viewer-newtab');
  assert.ok(anchor, '.doc-viewer-newTab anchor must exist');
  assert.ok(anchor.href.indexOf('/x') !== -1, 'fallback anchor href must contain the url');
  assert.equal(anchor.target, '_blank', 'fallback anchor must open in new tab');
});

test('closeDocViewer hides the modal', () => {
  const { window, document } = makeWidget();
  window.openDocViewer('/x', 'POD');

  const backdrop = document.querySelector('.doc-viewer-backdrop');
  assert.ok(!backdrop.classList.contains('hidden'), 'backdrop visible after open');

  window.closeDocViewer();
  assert.ok(backdrop.classList.contains('hidden'), 'backdrop hidden after closeDocViewer');
});

test('backdrop click closes the viewer', () => {
  const { window, document } = makeWidget();
  window.openDocViewer('/x', 'POD');

  const backdrop = document.querySelector('.doc-viewer-backdrop');
  assert.ok(!backdrop.classList.contains('hidden'));

  backdrop.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.ok(backdrop.classList.contains('hidden'), 'backdrop click must close the viewer');
});

test('ESC key closes the viewer', () => {
  const { window, document } = makeWidget();
  window.openDocViewer('/x', 'POD');

  const backdrop = document.querySelector('.doc-viewer-backdrop');
  assert.ok(!backdrop.classList.contains('hidden'));

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(backdrop.classList.contains('hidden'), 'ESC must close the viewer');
});

test('openDocViewer can be called twice; second call updates src and title', () => {
  const { window, document } = makeWidget();
  window.openDocViewer('/doc1', 'BOL');
  window.openDocViewer('/doc2', 'POD');

  const iframe = document.querySelector('.doc-viewer iframe');
  assert.ok(iframe.src.indexOf('/doc2') !== -1, 'second open must update iframe src');
  const titleEl = document.querySelector('.doc-viewer-title');
  assert.match(titleEl.textContent, /POD/);
});
