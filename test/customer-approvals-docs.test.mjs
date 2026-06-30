import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');

function boot() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  const calls = [];
  w.OperFiDocViewer = {
    open(opts) { calls.push({ method: 'open', opts }); },
    close() { calls.push({ method: 'close' }); },
    _calls: calls,
  };
  w.brokerEmail = 'b@o.com';
  return w;
}

// ── Static-source: the shared viewer + pdf.js are loaded ──────────────────────
test('customer-approvals includes the shared doc viewer + pdf.js', () => {
  assert.match(html, /operfi-docviewer\.js/);
  assert.match(html, /pdfjs\/pdf\.min\.js/);
});

// ── docsListHtml renders clickable cards ──────────────────────────────────────
test('docsListHtml renders a clickable doc-open button per file with recid/idx/filename', () => {
  const w = boot();
  const files = w.collectFiles([
    '/api/.../download?filepath=111_w9.pdf',
    '/api/.../download?filepath=222_setup.png',
  ]);
  const container = w.document.createElement('div');
  container.innerHTML = w.docsListHtml(files, 'sub_1');
  const btns = container.querySelectorAll('button.doc-open');
  assert.strictEqual(btns.length, 2, 'one clickable card per file');
  assert.strictEqual(btns[0].dataset.recid, 'sub_1');
  assert.strictEqual(btns[0].dataset.idx, '0');
  assert.strictEqual(btns[1].dataset.idx, '1');
  // filename is carried so the viewer titlebar/download is meaningful
  assert.match(btns[0].dataset.filename, /111_w9\.pdf/);
});

test('docsListHtml empty state unchanged', () => {
  const w = boot();
  assert.match(w.docsListHtml([], 'sub_1'), /No supporting documents uploaded/);
});

// ── creditDocUrl + openCreditDoc ──────────────────────────────────────────────
test('creditDocUrl points at /credit-doc with email, record_id, idx', () => {
  const w = boot();
  const url = w.creditDocUrl('sub_1', 2);
  assert.match(url, /\/credit-doc\?/);
  assert.match(url, /email=b%40o\.com/);
  assert.match(url, /record_id=sub_1/);
  assert.match(url, /idx=2/);
});

test('openCreditDoc delegates to OperFiDocViewer.open with the stream url + filename', () => {
  const w = boot();
  w.openCreditDoc('sub_1', 0, 'W9.pdf');
  const opened = w.OperFiDocViewer._calls.find(c => c.method === 'open');
  assert.ok(opened, 'OperFiDocViewer.open should be called');
  assert.match(opened.opts.url, /\/credit-doc\?.*record_id=sub_1.*idx=0/);
  assert.strictEqual(opened.opts.filename, 'W9.pdf');
  assert.strictEqual(opened.opts.mime, 'application/pdf');
});

test('openCreditDoc passes an image mime for image files', () => {
  const w = boot();
  w.openCreditDoc('sub_1', 1, 'setup.png');
  const opened = w.OperFiDocViewer._calls.find(c => c.method === 'open');
  assert.strictEqual(opened.opts.mime, 'image/png');
});

// ── Real click path through the delegated handler ─────────────────────────────
test('clicking a rendered doc card opens the viewer (delegated handler)', () => {
  const w = boot();
  const files = w.collectFiles(['/api/.../download?filepath=111_w9.pdf']);
  const root = w.document.createElement('div');
  root.innerHTML = w.docsListHtml(files, 'sub_1');
  w.document.body.appendChild(root);
  w.wireDocOpen(root);
  root.querySelector('button.doc-open').click();
  const opened = w.OperFiDocViewer._calls.find(c => c.method === 'open');
  assert.ok(opened, 'click should open the viewer');
  assert.match(opened.opts.url, /record_id=sub_1.*idx=0/);
});

test('XSS: a filename with quotes renders safely and still opens', () => {
  const w = boot();
  const files = w.collectFiles(['/api/.../download?filepath=' + encodeURIComponent('he "said" o\'clock.pdf')]);
  const root = w.document.createElement('div');
  root.innerHTML = w.docsListHtml(files, 'sub_1');
  w.document.body.appendChild(root);
  w.wireDocOpen(root);
  const btn = root.querySelector('button.doc-open');
  assert.ok(!root.innerHTML.includes(' onerror='), 'no injected handler');
  btn.click();
  const opened = w.OperFiDocViewer._calls.find(c => c.method === 'open');
  assert.ok(opened, 'opens despite special chars in filename');
});
