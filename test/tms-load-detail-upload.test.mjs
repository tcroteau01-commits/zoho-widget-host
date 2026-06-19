import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../tms-load-detail.html', import.meta.url), 'utf8');

function makeWidget() {
  const calls = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/tms-load-detail.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = function(url, init){
        calls.push({ url: url, init: init || {} });
        if (String(url).indexOf('/tms-doc/upload-link') !== -1)
          return Promise.resolve({ json: () => Promise.resolve({ url: 'https://x.github.io/tms-carrier-upload.html?token=1001.abc', token: '1001.abc', emailed: true }) });
        if (String(url).indexOf('/tms-doc/upload') !== -1)
          return Promise.resolve({ json: () => Promise.resolve({ ok: true, document_id: 'doc_9', status: 'POD Received' }) });
        if (String(url).indexOf('/tms-docs') !== -1)
          return Promise.resolve({ json: () => Promise.resolve({ documents: [] }) });
        return Promise.resolve({ json: () => Promise.resolve({ carriers: [], customers: [], templates: [] }) });
      };
    }
  });
  return { window: dom.window, calls };
}

test('uploadBrokerDoc posts multipart to /tms-doc/upload', async () => {
  const { window, calls } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.loadId = '1001';
  const file = new window.File([new Uint8Array([1, 2, 3])], 'pod.pdf', { type: 'application/pdf' });
  await window.uploadBrokerDoc('POD', file);
  const up = calls.find(c => String(c.url).indexOf('/tms-doc/upload') !== -1 && c.init.method === 'POST');
  assert.ok(up);
  assert.ok(up.init.body instanceof window.FormData);
});

test('uploadBrokerDoc without a file shows an error and does not post', async () => {
  const { window, calls } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.loadId = '1001';
  await window.uploadBrokerDoc('POD', null);
  assert.equal(calls.filter(c => String(c.url).indexOf('/tms-doc/upload') !== -1 && c.init.method === 'POST').length, 0);
  assert.match(window.document.getElementById('doc-status').textContent, /file/i);
});

test('fetchCarrierLink shows the tokenized URL', async () => {
  const { window } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.loadId = '1001';
  await window.fetchCarrierLink();
  const box = window.document.getElementById('carrier-link-box');
  assert.match(box.textContent, /token=1001\.abc/);
});

test('dropping a file stages it and shows a confirmation', () => {
  const { window } = makeWidget();
  const f = new window.File([new Uint8Array([1,2,3])], 'pod.pdf', { type: 'application/pdf' });
  window.setStagedFile(f);
  assert.equal(window._stagedFile.name, 'pod.pdf');
  const dz = window.document.getElementById('upload-dropzone');
  assert.match(dz.textContent, /pod\.pdf/);
  assert.match(dz.textContent, /attached/i);
});

test('upload button uploads the staged file', async () => {
  const { window, calls } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.loadId = '1001';
  const f = new window.File([new Uint8Array([1,2,3])], 'pod.pdf', { type: 'application/pdf' });
  window.setStagedFile(f);
  window.document.getElementById('upload-doc-type').value = 'POD';
  await window.uploadBrokerDoc('POD', window._stagedFile);
  assert.ok(calls.some(c => /\/tms-doc\/upload$/.test(c.url)));
});

test('emailCarrierLink requests send=1 and reports emailed', async () => {
  const { window, calls } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.loadId = '1001';
  await window.emailCarrierLink();
  const hit = calls.find(c => /\/tms-doc\/upload-link/.test(c.url));
  assert.ok(hit, 'called the upload-link route');
  assert.match(hit.url, /send=1/);
});

test('upload reflects an auto-advanced status in the stepper and load', async () => {
  const { window } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.loadId = '1001';
  window._currentLoad = { id: '1001', status: 'Delivered' };
  // mock fetch for /tms-doc/upload returns the advanced status
  const f = new window.File([new Uint8Array([1])], 'pod.pdf', { type: 'application/pdf' });
  await window.uploadBrokerDoc('POD', f);
  assert.equal(window._currentLoad.status, 'POD Received');
});
