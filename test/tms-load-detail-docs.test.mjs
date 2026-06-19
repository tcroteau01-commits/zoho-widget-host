import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../tms-load-detail.html', import.meta.url), 'utf8');

function makeWidget() {
  const posts = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/tms-load-detail.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = function(url, init){
        if (init && init.method === 'POST') {
          posts.push({ url: url, body: JSON.parse(init.body) });
          return Promise.resolve({ json: () => Promise.resolve({ ok: true, document_id: 'doc_1', emailed: !!JSON.parse(init.body).send, pdf_base64: 'JVBERi0=' }) });
        }
        if (String(url).indexOf('/tms-docs') !== -1) return Promise.resolve({ json: () => Promise.resolve({ documents: [{ id: 'd1', document_type: 'Rate Con', source: 'system-generated', uploaded_at: '2026-05-31T10:00:00', has_file: true }] }) });
        return Promise.resolve({ json: () => Promise.resolve({ carriers: [], customers: [], templates: [] }) });
      };
    }
  });
  return { window: dom.window, posts };
}

test('documents card is hidden until the load is saved (has id)', () => {
  const { window } = makeWidget();
  window.loadId = '';
  window.refreshDocCard();
  assert.equal(window.document.getElementById('docs-card').classList.contains('hidden'), true);
  window.loadId = '1001';
  window.refreshDocCard();
  assert.equal(window.document.getElementById('docs-card').classList.contains('hidden'), false);
});

test('generateDoc(preview) posts send:false and triggers a download', async () => {
  const { window, posts } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.loadId = '1001';
  let downloaded = null;
  window._downloadPdf = function(b64, name){ downloaded = name; };
  await window.generateDoc('rate_con', false);
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /\/tms-doc\/generate$/);
  assert.equal(posts[0].body.send, false);
  assert.equal(posts[0].body.doc_type, 'rate_con');
  assert.ok(downloaded);
});

test('generateDoc(send) posts send:true with recipient', async () => {
  const { window, posts } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.loadId = '1001';
  window.document.getElementById('doc-to-rate_con').value = 'dispatch@roadway.com';
  await window.generateDoc('rate_con', true);
  assert.equal(posts[0].body.send, true);
  assert.equal(posts[0].body.recipient_email, 'dispatch@roadway.com');
});

test('renderDocList shows existing documents', () => {
  const { window } = makeWidget();
  window.renderDocList([{ id: 'd1', document_type: 'Rate Con', source: 'system-generated', uploaded_at: '2026-05-31T10:00:00' }]);
  const rows = window.document.querySelectorAll('#doc-list .doc-item');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /Rate Con/);
});

test('generating cue is visibly busy, not muted gray', async () => {
  const { window } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.loadId = '1001';
  // call the status helper directly in busy mode
  window._docStatus('Generating…', true);
  const el = window.document.getElementById('doc-status');
  assert.equal(el.classList.contains('busy'), true);
  assert.equal(el.classList.contains('muted'), false);
  assert.match(el.textContent, /Generating/);
});

test('BOL row exists and generates with doc_type bol', async () => {
  const { window, posts } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.loadId = '1001';
  window.document.getElementById('doc-to-bol').value = 'dispatch@roadway.com';
  await window.generateDoc('bol', true);
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /\/tms-doc\/generate$/);
  assert.equal(posts[0].body.doc_type, 'bol');
  assert.equal(posts[0].body.send, true);
});

test('voided rate con renders struck and does not satisfy the carrier-doc gate', () => {
  const { window } = makeWidget();
  const { renderDocList, _gateFailures } = window;
  const docs = [
    { document_type: 'Rate Con', source: 'system-generated', voided: true },
    { document_type: 'Customer Invoice', source: 'system-generated', voided: false },
  ];
  renderDocList(docs);
  const voidedRow = window.document.querySelector('.doc-item.voided');
  assert.ok(voidedRow, 'voided row has the voided class');
  assert.match(voidedRow.textContent, /Voided/);
  // carrier-side doc (Rate Con) is voided -> gate still requires a carrier doc
  const fails = _gateFailures({ status: 'POD Received', carrier_id: 'v1' }, docs);
  assert.ok(fails.some(f => /carrier-side document/.test(f)));
});
