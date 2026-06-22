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

test('voided rate con renders struck', () => {
  const { window } = makeWidget();
  const { renderDocList } = window;
  const docs = [
    { document_type: 'Rate Con', source: 'system-generated', voided: true },
    { document_type: 'Customer Invoice', source: 'system-generated', voided: false },
  ];
  renderDocList(docs);
  const voidedRow = window.document.querySelector('.doc-item.voided');
  assert.ok(voidedRow, 'voided row has the voided class');
  assert.match(voidedRow.textContent, /Voided/);
  // Doc-side presence gating (carrier/customer side) is now enforced server-side via evaluate_submission_gates.
});

// ── W2: renderDocLibrary tests ──────────────────────────────────────────────

function makeLibraryWidget() {
  const posts = [];
  const confirms = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/tms-load-detail.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.confirm = function(msg) { confirms.push(msg); return true; };
      window.fetch = function(url, init){
        if (init && init.method === 'POST') {
          posts.push({ url: url, body: JSON.parse(init.body) });
          return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
        }
        if (String(url).indexOf('/tms-docs') !== -1) return Promise.resolve({ json: () => Promise.resolve({ documents: [] }) });
        return Promise.resolve({ json: () => Promise.resolve({ carriers: [], customers: [], templates: [] }) });
      };
    }
  });
  dom.window.brokerEmail = 'b@op.com';
  dom.window.loadId = 'LD001';
  dom.window.BROKER_API_BASE = 'https://api.example.com';
  return { window: dom.window, posts, confirms };
}

test('renderDocLibrary: Preview button only shown when has_file is true', () => {
  const { window } = makeLibraryWidget();
  const docs = [
    { id: 'd1', document_type: 'POD', source: 'uploaded', uploaded_at: '2026-06-01T10:00:00', has_file: true, voided: false, in_submission: false, preview_token: 'tok1' },
    { id: 'd2', document_type: 'Rate Con', source: 'system-generated', uploaded_at: '2026-06-01T11:00:00', has_file: false, voided: false, in_submission: false, preview_token: '' },
  ];
  window.renderDocLibrary(docs);
  const items = window.document.querySelectorAll('#doc-list .doc-lib-item');
  assert.equal(items.length, 2, 'renders both rows');
  // First doc has file — preview button visible
  const previewBtns0 = items[0].querySelectorAll('button.doc-lib-preview');
  assert.equal(previewBtns0.length, 1, 'Preview button present when has_file=true');
  assert.ok(!previewBtns0[0].classList.contains('hidden'), 'Preview button not hidden when has_file=true');
  // Second doc has no file — preview button hidden
  const previewBtns1 = items[1].querySelectorAll('button.doc-lib-preview');
  assert.equal(previewBtns1.length, 1, 'Preview button element present even without file');
  assert.ok(previewBtns1[0].classList.contains('hidden'), 'Preview button hidden when has_file=false');
});

test('renderDocLibrary: "✓ In submission" badge for in_submission docs, "Add" button otherwise', () => {
  const { window } = makeLibraryWidget();
  const docs = [
    { id: 'd1', document_type: 'POD', source: 'uploaded', uploaded_at: '2026-06-01T10:00:00', has_file: true, voided: false, in_submission: true, preview_token: 'tok1' },
    { id: 'd2', document_type: 'Rate Con', source: 'system-generated', uploaded_at: '2026-06-01T11:00:00', has_file: true, voided: false, in_submission: false, preview_token: 'tok2' },
  ];
  window.renderDocLibrary(docs);
  const items = window.document.querySelectorAll('#doc-list .doc-lib-item');
  assert.equal(items.length, 2);
  // in_submission=true: badge present, no "Add" button
  assert.match(items[0].textContent, /In submission/, 'in_submission doc shows badge text');
  const addBtns0 = items[0].querySelectorAll('button.doc-lib-add');
  assert.equal(addBtns0.length, 0, 'no Add button for in_submission doc');
  // in_submission=false: "Add" button present, no badge
  const addBtns1 = items[1].querySelectorAll('button.doc-lib-add');
  assert.equal(addBtns1.length, 1, 'Add button present when not in_submission');
  assert.ok(!items[1].textContent.includes('✓ In submission') || items[1].querySelector('.doc-lib-add'), 'add doc shows Add button');
});

test('renderDocLibrary: voided rows have voided class and struck-through appearance', () => {
  const { window } = makeLibraryWidget();
  const docs = [
    { id: 'd1', document_type: 'Rate Con', source: 'system-generated', uploaded_at: '2026-06-01T10:00:00', has_file: true, voided: true, in_submission: false, preview_token: 'tok1' },
    { id: 'd2', document_type: 'BOL', source: 'system-generated', uploaded_at: '2026-06-01T11:00:00', has_file: true, voided: false, in_submission: false, preview_token: 'tok2' },
  ];
  window.renderDocLibrary(docs);
  const items = window.document.querySelectorAll('#doc-list .doc-lib-item');
  assert.ok(items[0].classList.contains('voided'), 'voided row has voided class');
  assert.ok(!items[1].classList.contains('voided'), 'non-voided row lacks voided class');
});

test('renderDocLibrary: Delete button triggers confirm then posts to /tms-doc/delete', async () => {
  const { window, posts, confirms } = makeLibraryWidget();
  const docs = [
    { id: 'd1', document_type: 'POD', source: 'uploaded', uploaded_at: '2026-06-01T10:00:00', has_file: true, voided: false, in_submission: false, preview_token: 'tok1' },
  ];
  window.renderDocLibrary(docs);
  const delBtn = window.document.querySelector('button.doc-lib-delete');
  assert.ok(delBtn, 'Delete button must exist');
  delBtn.click();
  assert.equal(confirms.length, 1, 'confirm was called');
  // wait a tick for the async post
  await new Promise(r => setTimeout(r, 20));
  assert.equal(posts.length, 1, 'one POST made');
  assert.match(posts[0].url, /\/tms-doc\/delete$/);
  assert.equal(posts[0].body.doc_id, 'd1');
  assert.equal(posts[0].body.email, 'b@op.com');
  assert.equal(posts[0].body.load_id, 'LD001');
});

test('renderDocLibrary: Preview button calls openDocViewer with correct URL and type', () => {
  const { window } = makeLibraryWidget();
  const calls = [];
  window.openDocViewer = function(url, title) { calls.push({ url, title }); };
  const docs = [
    { id: 'd1', document_type: 'POD', source: 'uploaded', uploaded_at: '2026-06-01T10:00:00', has_file: true, voided: false, in_submission: false, preview_token: 'tok_abc' },
  ];
  window.renderDocLibrary(docs);
  const previewBtn = window.document.querySelector('button.doc-lib-preview');
  previewBtn.click();
  assert.equal(calls.length, 1, 'openDocViewer called');
  assert.match(calls[0].url, /\/tms-doc-file\?t=tok_abc$/);
  assert.equal(calls[0].title, 'POD');
});

test('renderDocLibrary: Add button posts in_submission:true to /tms-doc/submission', async () => {
  const { window, posts } = makeLibraryWidget();
  const docs = [
    { id: 'd2', document_type: 'Rate Con', source: 'system-generated', uploaded_at: '2026-06-01T11:00:00', has_file: true, voided: false, in_submission: false, preview_token: 'tok2' },
  ];
  window.renderDocLibrary(docs);
  const addBtn = window.document.querySelector('button.doc-lib-add');
  assert.ok(addBtn, 'Add button must exist');
  addBtn.click();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(posts.length, 1, 'one POST made');
  assert.match(posts[0].url, /\/tms-doc\/submission$/);
  assert.equal(posts[0].body.doc_id, 'd2');
  assert.equal(posts[0].body.in_submission, true);
  assert.equal(posts[0].body.email, 'b@op.com');
  assert.equal(posts[0].body.load_id, 'LD001');
});

test('library rows wrap controls in an aligned action group for both states', () => {
  const { window } = makeLibraryWidget();
  const { renderDocLibrary } = window;
  renderDocLibrary([
    { id: 'a', document_type: 'Carrier Invoice', source: 'broker-upload',
      uploaded_at: '2026-06-22T15:11', has_file: true, in_submission: true },
    { id: 'b', document_type: 'Rate Con', source: 'system-generated',
      uploaded_at: '2026-06-22T15:09', has_file: true, in_submission: false },
  ]);
  const items = window.document.querySelectorAll('#doc-list .doc-lib-item');
  assert.strictEqual(items.length, 2);
  items.forEach((it) => {
    const actions = it.querySelector('.doc-lib-actions');
    assert.ok(actions, 'each row has a .doc-lib-actions group');
    assert.ok(actions.querySelector('.doc-lib-preview'), 'preview in actions');
    assert.ok(actions.querySelector('.doc-lib-delete'), 'delete in actions');
  });
  // in_submission row shows the badge; the other shows the add button
  assert.ok(items[0].querySelector('.doc-lib-actions .doc-lib-badge'));
  assert.ok(items[1].querySelector('.doc-lib-actions .doc-lib-add'));
});
test('refreshDocs: re-fetches /tms-docs and re-renders library and submit panel', async () => {
  const { window } = makeLibraryWidget();
  window._currentLoad = { id: 'LD001', status: 'Delivered', vetting: {} };
  let renderLibraryCalls = 0;
  let renderPanelCalls = 0;
  const origLib = window.renderDocLibrary;
  window.renderDocLibrary = function(docs) { renderLibraryCalls++; origLib.call(window, docs); };
  const origPanel = window.renderSubmitPanel;
  window.renderSubmitPanel = function(load, docs) { renderPanelCalls++; if (origPanel) origPanel.call(window, load, docs); };
  await window.refreshDocs();
  assert.ok(renderLibraryCalls >= 1, 'renderDocLibrary called by refreshDocs');
  assert.ok(renderPanelCalls >= 1, 'renderSubmitPanel called by refreshDocs');
});
