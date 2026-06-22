// test/carrier-profile-docs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('carrier-profile.html'), 'utf8');

function boot(fetchImpl) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  dom.window.fetch = fetchImpl;
  return dom;
}

test('renders grouped docs with preview + download links', async () => {
  const dom = boot(async () => ({
    ok: true,
    json: async () => ({ count: 2, documents: [
      { type: 'noa', label: 'NOA / LOR', filename: 'NOA-1.pdf', preview_token: 'TOKA' },
      { type: 'coi', label: 'Insurance (COI)', filename: 'COI-1.jpeg', preview_token: 'TOKB' },
    ] }),
  }));
  const w = dom.window;
  w.brokerEmail = 'b@o.com'; w.vendorId = '1001';
  await w.loadCarrierDocs();
  const card = w.document.getElementById('cp-docs-card');
  assert.match(card.textContent, /NOA \/ LOR/);
  assert.match(card.textContent, /Insurance \(COI\)/);
  // a download/preview link carries the token
  assert.match(card.innerHTML, /carrier-doc-file\?t=TOKA/);
});

test('empty state when no documents', async () => {
  const dom = boot(async () => ({ ok: true, json: async () => ({ count: 0, documents: [], reason: 'no_folder' }) }));
  const w = dom.window;
  w.brokerEmail = 'b@o.com'; w.vendorId = '1001';
  await w.loadCarrierDocs();
  assert.match(w.document.getElementById('cp-docs-card').textContent, /No documents on file/i);
});

test('error state on workdrive error', async () => {
  const dom = boot(async () => ({ ok: false, status: 502, json: async () => ({ error: 'workdrive_error' }) }));
  const w = dom.window;
  w.brokerEmail = 'b@o.com'; w.vendorId = '1001';
  await w.loadCarrierDocs();
  assert.match(w.document.getElementById('cp-docs-card').textContent, /could not load|error/i);
});

test('preview opens inline viewer', async () => {
  const dom = boot(async () => ({ ok: true, json: async () => ({ count: 1, documents: [
    { type: 'noa', label: 'NOA / LOR', filename: 'NOA-1.pdf', preview_token: 'TOKA' }] }) }));
  const w = dom.window;
  w.brokerEmail = 'b@o.com'; w.vendorId = '1001';
  await w.loadCarrierDocs();
  w.openCarrierDoc('TOKA', 'NOA-1.pdf');
  const viewer = w.document.getElementById('cp-doc-viewer');
  assert.ok(viewer && viewer.style.display !== 'none');
  assert.match(viewer.innerHTML, /carrier-doc-file\?t=TOKA/);
});

test('closeCarrierDoc hides viewer', async () => {
  const dom = boot(async () => ({ ok: true, json: async () => ({ count: 1, documents: [
    { type: 'noa', label: 'NOA / LOR', filename: 'NOA-1.pdf', preview_token: 'TOKA' }] }) }));
  const w = dom.window;
  w.brokerEmail = 'b@o.com'; w.vendorId = '1001';
  await w.loadCarrierDocs();
  w.openCarrierDoc('TOKA', 'NOA-1.pdf');
  w.closeCarrierDoc();
  const viewer = w.document.getElementById('cp-doc-viewer');
  assert.ok(viewer && viewer.style.display === 'none');
  assert.strictEqual(viewer.innerHTML, '');
});

test('preview uses img for image files', async () => {
  const dom = boot(async () => ({ ok: true, json: async () => ({ count: 1, documents: [
    { type: 'coi', label: 'Insurance (COI)', filename: 'COI.png', preview_token: 'TOKB' }] }) }));
  const w = dom.window;
  w.brokerEmail = 'b@o.com'; w.vendorId = '1001';
  await w.loadCarrierDocs();
  w.openCarrierDoc('TOKB', 'COI.png');
  const viewer = w.document.getElementById('cp-doc-viewer');
  assert.ok(viewer && viewer.style.display !== 'none');
  assert.match(viewer.innerHTML, /<img/i);
  assert.match(viewer.innerHTML, /carrier-doc-file\?t=TOKB/);
});

test('preview uses iframe for PDF files', async () => {
  const dom = boot(async () => ({ ok: true, json: async () => ({ count: 1, documents: [
    { type: 'noa', label: 'NOA / LOR', filename: 'NOA.pdf', preview_token: 'TOKC' }] }) }));
  const w = dom.window;
  w.brokerEmail = 'b@o.com'; w.vendorId = '1001';
  await w.loadCarrierDocs();
  w.openCarrierDoc('TOKC', 'NOA.pdf');
  const viewer = w.document.getElementById('cp-doc-viewer');
  assert.ok(viewer && viewer.style.display !== 'none');
  assert.match(viewer.innerHTML, /<iframe/i);
  assert.match(viewer.innerHTML, /carrier-doc-file\?t=TOKC/);
});

test('preview button in rendered doc row calls openCarrierDoc', async () => {
  const dom = boot(async () => ({ ok: true, json: async () => ({ count: 1, documents: [
    { type: 'noa', label: 'NOA / LOR', filename: 'NOA-1.pdf', preview_token: 'TOKD' }] }) }));
  const w = dom.window;
  w.brokerEmail = 'b@o.com'; w.vendorId = '1001';
  await w.loadCarrierDocs();
  const card = w.document.getElementById('cp-docs-card');
  const previewBtn = card.querySelector('button.cp-doc-link');
  assert.ok(previewBtn, 'Preview button should exist');
  previewBtn.click();
  const viewer = w.document.getElementById('cp-doc-viewer');
  assert.ok(viewer && viewer.style.display !== 'none');
  assert.match(viewer.innerHTML, /carrier-doc-file\?t=TOKD/);
});