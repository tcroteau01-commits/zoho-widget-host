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

// ── BOOSTDOCS2: credit boost files in the pane ────────────────────────────────
function bootPane(own) {
  const w = boot();
  const d = w.document;
  const holder = d.createElement('div');
  holder.innerHTML = '<div id="ca-docs-list">' + w.docsListHtml(own || [], '4455') + '</div>' +
                     '<div id="ca-boost-docs"></div>';
  d.body.appendChild(holder);
  w.wireDocOpen(holder);
  return { w, holder };
}
const BOOST = [{ field: 'boost_agreement', idx: 0, label: 'Credit boost: customer agreement', ext: 'PDF' },
               { field: 'boost_coi', idx: 0, label: 'Credit boost: certificate of insurance', ext: 'PDF' }];

test('boost files replace the empty state and open /credit-doc by slot', () => {
  const { w, holder } = bootPane([]);
  w.renderBoostDocs('4455', BOOST);
  assert.ok(!/No supporting documents uploaded/.test(holder.innerHTML));
  const btns = holder.querySelectorAll('#ca-boost-docs button.doc-open');
  assert.strictEqual(btns.length, 2);
  btns[1].click();
  const opened = w.OperFiDocViewer._calls.find(c => c.method === 'open');
  assert.match(opened.opts.url, /record_id=4455&idx=0&field=boost_coi$/);
  assert.strictEqual(opened.opts.mime, 'application/pdf');
  assert.match(opened.opts.filename, /certificate of insurance/);
});

test('boost files sit under the submission files, which keep opening without a field', () => {
  const { w, holder } = bootPane([]);
  const files = w.collectFiles(['/api/.../download?filepath=111_w9.pdf']);
  holder.querySelector('#ca-docs-list').innerHTML = w.docsListHtml(files, '4455');
  w.renderBoostDocs('4455', BOOST);
  assert.strictEqual(holder.querySelectorAll('button.doc-open').length, 3);
  holder.querySelector('#ca-docs-list button.doc-open').click();
  const opened = w.OperFiDocViewer._calls.find(c => c.method === 'open');
  assert.ok(!/field=/.test(opened.opts.url));
});

test('no boost files leaves the empty state alone', () => {
  const { w, holder } = bootPane([]);
  w.renderBoostDocs('4455', []);
  assert.match(holder.innerHTML, /No supporting documents uploaded/);
});

test('a slow boost response for the previous record never lands on the new one', async () => {
  const { w, holder } = bootPane([]);
  const pending = [];
  w.fetch = (url) => new Promise(res => pending.push({ url, res }));
  w.fetchBoostDocs({ ID: '1111' });
  w.fetchBoostDocs({ ID: '4455' });
  const ok = files => ({ ok: true, json: () => Promise.resolve({ files }) });
  pending[1].res(ok([]));
  pending[0].res(ok(BOOST));
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(holder.querySelectorAll('#ca-boost-docs button').length, 0);
  assert.match(pending[1].url, /\/credit-doc\/boost-files\?email=b%40o\.com&record_id=4455$/);
});
