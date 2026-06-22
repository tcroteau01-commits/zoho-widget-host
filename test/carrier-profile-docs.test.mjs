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
