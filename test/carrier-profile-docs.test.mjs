// test/carrier-profile-docs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('carrier-profile.html'), 'utf8');
const HTML = html; // alias used by the static-source tests

function boot(fetchImpl) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  dom.window.fetch = fetchImpl;
  // Provide a stub OperFiDocViewer so openCarrierDoc can delegate to it.
  const calls = [];
  dom.window.OperFiDocViewer = {
    open(opts) { calls.push({ method: 'open', opts }); },
    close() { calls.push({ method: 'close' }); },
    _calls: calls,
  };
  return dom;
}

test('renders doc cards with View + Download and a count chip', async () => {
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
  // labels present on cards
  assert.match(card.textContent, /NOA \/ LOR/);
  assert.match(card.textContent, /Insurance \(COI\)/);
  // card container + View button + Download link present
  assert.ok(card.querySelector('.cp-doccard'), 'renders cp-doccard');
  const view = card.querySelector('button.cp-dbtn.cp-doc-preview[data-token="TOKA"]');
  assert.ok(view, 'View button carries token');
  assert.strictEqual(view.textContent, 'View');
  assert.match(card.innerHTML, /carrier-doc-file\?t=TOKA/);
  assert.match(card.innerHTML, /name=NOA-1\.pdf/);
  // count chip
  assert.strictEqual(w.document.getElementById('cp-docs-count').textContent, '2 on file');
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

test('preview delegates to OperFiDocViewer.open', async () => {
  const dom = boot(async () => ({ ok: true, json: async () => ({ count: 1, documents: [
    { type: 'noa', label: 'NOA / LOR', filename: 'NOA-1.pdf', preview_token: 'TOKA' }] }) }));
  const w = dom.window;
  w.brokerEmail = 'b@o.com'; w.vendorId = '1001';
  await w.loadCarrierDocs();
  w.openCarrierDoc('TOKA', 'NOA-1.pdf');
  const opened = w.OperFiDocViewer._calls.find(c => c.method === 'open');
  assert.ok(opened, 'OperFiDocViewer.open should be called');
  assert.match(opened.opts.url, /carrier-doc-file\?t=TOKA/);
  assert.strictEqual(opened.opts.filename, 'NOA-1.pdf');
});

test('closeCarrierDoc delegates to OperFiDocViewer.close', async () => {
  const dom = boot(async () => ({ ok: true, json: async () => ({ count: 1, documents: [
    { type: 'noa', label: 'NOA / LOR', filename: 'NOA-1.pdf', preview_token: 'TOKA' }] }) }));
  const w = dom.window;
  w.brokerEmail = 'b@o.com'; w.vendorId = '1001';
  await w.loadCarrierDocs();
  w.openCarrierDoc('TOKA', 'NOA-1.pdf');
  w.closeCarrierDoc();
  const closed = w.OperFiDocViewer._calls.find(c => c.method === 'close');
  assert.ok(closed, 'OperFiDocViewer.close should be called');
});

test('openCarrierDoc passes filename for image files', async () => {
  const dom = boot(async () => ({ ok: true, json: async () => ({ count: 1, documents: [
    { type: 'coi', label: 'Insurance (COI)', filename: 'COI.png', preview_token: 'TOKB' }] }) }));
  const w = dom.window;
  w.brokerEmail = 'b@o.com'; w.vendorId = '1001';
  await w.loadCarrierDocs();
  w.openCarrierDoc('TOKB', 'COI.png');
  const opened = w.OperFiDocViewer._calls.find(c => c.method === 'open');
  assert.ok(opened, 'OperFiDocViewer.open should be called');
  assert.match(opened.opts.url, /carrier-doc-file\?t=TOKB/);
  assert.strictEqual(opened.opts.filename, 'COI.png');
});

test('openCarrierDoc passes filename for PDF files', async () => {
  const dom = boot(async () => ({ ok: true, json: async () => ({ count: 1, documents: [
    { type: 'noa', label: 'NOA / LOR', filename: 'NOA.pdf', preview_token: 'TOKC' }] }) }));
  const w = dom.window;
  w.brokerEmail = 'b@o.com'; w.vendorId = '1001';
  await w.loadCarrierDocs();
  w.openCarrierDoc('TOKC', 'NOA.pdf');
  const opened = w.OperFiDocViewer._calls.find(c => c.method === 'open');
  assert.ok(opened, 'OperFiDocViewer.open should be called');
  assert.match(opened.opts.url, /carrier-doc-file\?t=TOKC/);
  assert.strictEqual(opened.opts.filename, 'NOA.pdf');
});

test('preview button in rendered doc row calls openCarrierDoc', async () => {
  const dom = boot(async () => ({ ok: true, json: async () => ({ count: 1, documents: [
    { type: 'noa', label: 'NOA / LOR', filename: 'NOA-1.pdf', preview_token: 'TOKD' }] }) }));
  const w = dom.window;
  w.brokerEmail = 'b@o.com'; w.vendorId = '1001';
  await w.loadCarrierDocs();
  const card = w.document.getElementById('cp-docs-card');
  // button carries both cp-doc-link and cp-doc-preview; click bubbles to delegated listener on cp-docs-body
  const previewBtn = card.querySelector('button.cp-doc-preview');
  assert.ok(previewBtn, 'Preview button should exist with cp-doc-preview class');
  previewBtn.click();
  const opened = w.OperFiDocViewer._calls.find(c => c.method === 'open');
  assert.ok(opened, 'OperFiDocViewer.open should be called after preview button click');
  assert.match(opened.opts.url, /carrier-doc-file\?t=TOKD/);
});

test('XSS neutralized: filename with double-quote and single-quote renders safely', async () => {
  const maliciousFilename = 'he said "hi" o\'clock.pdf';
  const dom = boot(async () => ({ ok: true, json: async () => ({ count: 1, documents: [
    { type: 'noa', label: 'NOA / LOR', filename: maliciousFilename, preview_token: 'TOKE' }] }) }));
  const w = dom.window;
  w.brokerEmail = 'b@o.com'; w.vendorId = '1001';
  await w.loadCarrierDocs();
  const card = w.document.getElementById('cp-docs-card');
  const rawHtml = card.innerHTML;

  // The raw double-quote from the filename must NOT appear unescaped as an
  // attribute boundary break — it must appear only as &quot; in the data-filename attribute
  assert.ok(!rawHtml.includes(' onmouseover='), 'no injected handler in markup');
  assert.match(rawHtml, /data-filename="[^"]*&quot;[^"]*"/, 'double-quote is HTML-escaped in data-filename');

  // Clicking preview still works and calls openCarrierDoc with the correct filename
  const previewBtn = card.querySelector('button.cp-doc-preview');
  assert.ok(previewBtn, 'Preview button should exist');
  assert.strictEqual(previewBtn.dataset.filename, maliciousFilename,
    'dataset.filename returns the real decoded filename');
  previewBtn.click();
  const opened = w.OperFiDocViewer._calls.find(c => c.method === 'open');
  assert.ok(opened, 'OperFiDocViewer.open should be called despite special chars in filename');
  assert.match(opened.opts.url, /carrier-doc-file\?t=TOKE/);
});

test('null filename renders without throwing and does not flip to error state', async () => {
  const dom = boot(async () => ({ ok: true, json: async () => ({ count: 2, documents: [
    { type: 'noa', label: 'NOA / LOR', filename: null, preview_token: 'TOKF' },
    { type: 'coi', label: 'Insurance (COI)', filename: 'COI.pdf', preview_token: 'TOKG' },
  ] }) }));
  const w = dom.window;
  w.brokerEmail = 'b@o.com'; w.vendorId = '1001';
  // Must not throw; entire card must NOT be in error state
  await w.loadCarrierDocs();
  const card = w.document.getElementById('cp-docs-card');
  assert.ok(!card.textContent.includes('Could not load'), 'card is NOT in error state');
  assert.match(card.textContent, /Insurance \(COI\)/, 'valid doc still renders');
});

test('upload control shows when a relationship folder exists', async () => {
  const dom = boot(async () => ({ ok: true, json: async () => ({ count: 1, documents: [
    { type: 'coi', label: 'Insurance (COI)', filename: 'COI-1.pdf', preview_token: 'T' }] }) }));
  const w = dom.window;
  w.brokerEmail = 'b@o.com'; w.vendorId = '1001';
  await w.loadCarrierDocs();
  assert.ok(w.document.getElementById('cp-up-file'), 'file input present');
  assert.ok(w.document.getElementById('cp-up-type'), 'type select present');
});

test('upload control hidden for no-folder carriers', async () => {
  const dom = boot(async () => ({ ok: true, json: async () => ({ count: 0, documents: [], reason: 'no_documents' }) }));
  const w = dom.window;
  w.brokerEmail = 'b@o.com'; w.vendorId = '1001';
  await w.loadCarrierDocs();
  assert.strictEqual(w.document.getElementById('cp-up-file'), null);
  assert.match(w.document.getElementById('cp-docs-card').textContent, /set up with you/i);
});

test('uploadCarrierDoc posts FormData and refreshes on success', async () => {
  const calls = [];
  const dom = boot(async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('/carrier-doc-upload')) return { ok: true, json: async () => ({ ok: true, filename: 'NOA-x.pdf' }) };
    return { ok: true, json: async () => ({ count: 0, documents: [] }) };
  });
  const w = dom.window;
  w.brokerEmail = 'b@o.com'; w.vendorId = '1001';
  await w.loadCarrierDocs();
  // simulate a chosen file + type
  const fileInput = w.document.getElementById('cp-up-file');
  Object.defineProperty(fileInput, 'files', { value: [new w.File(['x'], 'x.pdf', { type: 'application/pdf' })] });
  w.document.getElementById('cp-up-type').value = 'noa';
  await w.uploadCarrierDoc();
  const up = calls.find(c => c.url.includes('/carrier-doc-upload'));
  assert.ok(up, 'posted to /carrier-doc-upload');
  assert.strictEqual(up.opts.method, 'POST');
  assert.ok(up.opts.body instanceof w.FormData);
  assert.strictEqual(up.opts.body.get('doc_type'), 'noa');
  // a refresh fetch to /carrier-docs happened after upload
  assert.ok(calls.filter(c => c.url.includes('/carrier-docs')).length >= 2);
});

// Static-source tests (no JSDOM runtime needed)
test('carrier-profile includes the shared doc viewer + pdf.js', () => {
  assert.match(HTML, /operfi-docviewer\.js/);
  assert.match(HTML, /pdfjs\/pdf\.min\.js/);
});

test('openCarrierDoc delegates to OperFiDocViewer.open (no inline iframe build)', () => {
  assert.match(HTML, /OperFiDocViewer\.open\(/);
  // the old inline iframe construction is gone from openCarrierDoc
  assert.doesNotMatch(HTML, /<iframe src="' \+ url/);
});

test('carrier-profile footer carries the v2026-07-22.1 version stamp', () => {
  assert.match(HTML, /v2026-07-22\.1/);
});

test('recommended section: non-factored carrier recommends COI + Banking', async () => {
  const dom = boot(async () => ({ ok: true, json: async () => ({ count: 0, documents: [] }) }));
  const w = dom.window;
  w.brokerEmail = 'b@o.com'; w.vendorId = '1001';
  w.cpFactored = false;
  await w.loadCarrierDocs();
  const card = w.document.getElementById('cp-docs-card');
  assert.match(card.textContent, /Recommended \(not on file\)/);
  const recLabels = [...card.querySelectorAll('.cp-doccard.cp-rec .cp-dlabel')].map(e => e.textContent).sort();
  assert.deepStrictEqual(recLabels, ['Banking (Voided Check / Bank Info)', 'Insurance (COI)']);
  // folder-exists-empty still shows the upload control
  assert.ok(w.document.getElementById('cp-up-file'), 'upload control present');
});

test('recommended section: factored carrier recommends COI + NOA/LOR', async () => {
  const dom = boot(async () => ({ ok: true, json: async () => ({ count: 0, documents: [] }) }));
  const w = dom.window;
  w.brokerEmail = 'b@o.com'; w.vendorId = '1001';
  w.cpFactored = true;
  await w.loadCarrierDocs();
  const card = w.document.getElementById('cp-docs-card');
  const recLabels = [...card.querySelectorAll('.cp-doccard.cp-rec .cp-dlabel')].map(e => e.textContent).sort();
  assert.deepStrictEqual(recLabels, ['Insurance (COI)', 'NOA or LOR']);
});

test('recommended item is suppressed when a matching type is already on file', async () => {
  const dom = boot(async () => ({ ok: true, json: async () => ({ count: 1, documents: [
    { type: 'coi', label: 'Insurance (COI)', filename: 'COI-1.pdf', preview_token: 'T' }] }) }));
  const w = dom.window;
  w.brokerEmail = 'b@o.com'; w.vendorId = '1001';
  w.cpFactored = false;
  await w.loadCarrierDocs();
  const card = w.document.getElementById('cp-docs-card');
  const recLabels = [...card.querySelectorAll('.cp-doccard.cp-rec .cp-dlabel')].map(e => e.textContent);
  // COI is on file, so it must NOT be re-recommended; Banking still is.
  assert.ok(recLabels.includes('Banking (Voided Check / Bank Info)'), 'Banking recommended');
  assert.ok(!recLabels.includes('Insurance (COI)'), 'COI not re-recommended (already on file)');
});
