import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../tms-load-detail.html', import.meta.url), 'utf8');

function boot() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  dom.window.brokerEmail = 'b@x.com';
  dom.window.BROKER_API_BASE = 'http://api';
  return dom;
}

test('submit panel shows gate failures and disables submit', () => {
  const dom = boot();
  const { renderSubmitPanel } = dom.window;
  renderSubmitPanel(
    { id: '1', status: 'In Transit', vetting: {} },
    [{ document_type: 'POD' }]
  );
  const panel = dom.window.document.getElementById('submit-panel');
  assert.ok(/Ready to Submit/.test(panel.textContent));
  assert.strictEqual(dom.window.document.getElementById('btn-submit-factoring').disabled, true);
});

test('submit panel enables submit when gates pass and invoice entered', () => {
  const dom = boot();
  const { renderSubmitPanel } = dom.window;
  renderSubmitPanel(
    { id: '1', status: 'Ready to Submit', carrier_id: 'v1', vetting: { authority_active: true } },
    [{ document_type: 'POD' }, { document_type: 'Rate Con' }]
  );
  const inv = dom.window.document.getElementById('f-factoring-invoice');
  inv.value = 'FCT-1';
  inv.dispatchEvent(new dom.window.Event('input'));
  assert.strictEqual(dom.window.document.getElementById('btn-submit-factoring').disabled, false);
});

test('vetting warning reveals override checkbox', () => {
  const dom = boot();
  const { renderSubmitPanel } = dom.window;
  renderSubmitPanel(
    { id: '1', status: 'POD Received', vetting: { authority_active: false } },
    [{ document_type: 'POD' }, { document_type: 'Rate Con' }]
  );
  const ov = dom.window.document.getElementById('chk-override');
  assert.ok(ov, 'override checkbox present');
  assert.ok(/authority/i.test(dom.window.document.getElementById('submit-panel').textContent));
});

test('already-submitted load shows funding link and locks', () => {
  const dom = boot();
  const { renderSubmitPanel } = dom.window;
  renderSubmitPanel(
    { id: '1', status: 'Submitted', funding_portal_link: 'http://x/9', vetting: {} },
    []
  );
  const panel = dom.window.document.getElementById('submit-panel');
  assert.ok(/Submitted/.test(panel.textContent));
  assert.ok(panel.querySelector('a[href="http://x/9"]'));
});

test('submit gate fails when no carrier is assigned', () => {
  const dom = boot();
  const { renderSubmitPanel } = dom.window;
  renderSubmitPanel(
    { id: '1', status: 'POD Received', carrier_id: '', vetting: { authority_active: true } },
    [{ document_type: 'POD' }, { document_type: 'Rate Con' }]
  );
  dom.window.document.getElementById('f-factoring-invoice').value = 'FCT-1';
  dom.window.document.getElementById('f-factoring-invoice')
     .dispatchEvent(new dom.window.Event('input'));
  assert.strictEqual(dom.window.document.getElementById('btn-submit-factoring').disabled, true);
});

test('submit panel renders two document zones (only in_submission docs)', () => {
  const dom = boot();
  const w = dom.window;
  w.renderSubmitPanel(
    { id: '1', status: 'Delivered', carrier_id: 'v1', vetting: {} },
    [
      { id: 'd1', document_type: 'POD', has_file: true, voided: false, in_submission: true, preview_token: 't1' },
      { id: 'd2', document_type: 'Carrier Invoice', has_file: true, voided: false, in_submission: true, preview_token: 't2' },
    ]
  );
  const cust = w.document.getElementById('zone-customer');
  const carr = w.document.getElementById('zone-carrier');
  assert.ok(cust && carr, 'both zones render');
  assert.match(cust.textContent, /POD/);
  assert.match(carr.textContent, /Carrier Invoice/);
  // POD must not appear in the carrier zone
  assert.doesNotMatch(carr.textContent, /POD/);
});

test('submit enables (amber) only at Ready to Submit with invoice + carrier', () => {
  const dom = boot();
  const w = dom.window;
  w.renderSubmitPanel(
    { id: '1', status: 'Ready to Submit', carrier_id: 'v1', vetting: {} },
    [{ document_type: 'POD' }, { document_type: 'Carrier Invoice' }]
  );
  const inv = w.document.getElementById('f-factoring-invoice');
  inv.value = 'FCT-1'; inv.dispatchEvent(new w.Event('input'));
  const btn = w.document.getElementById('btn-submit-factoring');
  assert.equal(btn.disabled, false);
  assert.ok(btn.classList.contains('ready'));
});

test('submit stays disabled when status is only POD Received', () => {
  const dom = boot();
  const w = dom.window;
  w.renderSubmitPanel(
    { id: '1', status: 'POD Received', carrier_id: 'v1', vetting: {} },
    [{ document_type: 'POD' }]
  );
  const inv = w.document.getElementById('f-factoring-invoice');
  inv.value = 'FCT-1'; inv.dispatchEvent(new w.Event('input'));
  const btn = w.document.getElementById('btn-submit-factoring');
  assert.equal(btn.disabled, true);
});

// ── W3: in-submission-only packet tests ─────────────────────────────────────

function bootW3() {
  const posts = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/tms-load-detail.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = function(url, init) {
        if (init && init.method === 'POST') {
          posts.push({ url, body: JSON.parse(init.body) });
          return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
        }
        return Promise.resolve({ json: () => Promise.resolve({ carriers: [], customers: [], templates: [], documents: [] }) });
      };
    }
  });
  dom.window.brokerEmail = 'b@x.com';
  dom.window.loadId = 'LD001';
  dom.window.BROKER_API_BASE = 'http://api';
  return { dom, posts };
}

test('W3: packet shows only in_submission docs, not others', () => {
  const { dom } = bootW3();
  const w = dom.window;
  const docs = [
    { id: 'd1', document_type: 'POD', has_file: true, voided: false, in_submission: true, preview_token: 'tok1' },
    { id: 'd2', document_type: 'Rate Con', has_file: true, voided: false, in_submission: false, preview_token: 'tok2' },
    { id: 'd3', document_type: 'Carrier Invoice', has_file: true, voided: false, in_submission: true, preview_token: 'tok3' },
  ];
  w.renderSubmitPanel({ id: 'LD001', status: 'Ready to Submit', carrier_id: 'v1', vetting: {} }, docs);
  const panel = w.document.getElementById('submit-panel');
  // POD (in_submission=true) must appear
  assert.match(panel.textContent, /POD/);
  // Carrier Invoice (in_submission=true) must appear
  assert.match(panel.textContent, /Carrier Invoice/);
  // Rate Con (in_submission=false) must NOT appear in the packet
  // (it may appear in the gate list text but not as a doc row)
  const rows = panel.querySelectorAll('.fz-doc');
  const rowTexts = Array.from(rows).map(r => r.textContent);
  assert.ok(rowTexts.some(t => /POD/.test(t)), 'POD row present');
  assert.ok(rowTexts.some(t => /Carrier Invoice/.test(t)), 'Carrier Invoice row present');
  assert.ok(!rowTexts.some(t => /Rate Con/.test(t)), 'Rate Con row absent from packet');
});

test('W3: customer zone shows only customer-side in_submission docs', () => {
  const { dom } = bootW3();
  const w = dom.window;
  const docs = [
    { id: 'd1', document_type: 'POD', has_file: true, voided: false, in_submission: true, preview_token: 'tok1' },
    { id: 'd2', document_type: 'Carrier Invoice', has_file: true, voided: false, in_submission: true, preview_token: 'tok2' },
    { id: 'd3', document_type: 'BOL', has_file: true, voided: false, in_submission: false, preview_token: 'tok3' },
  ];
  w.renderSubmitPanel({ id: 'LD001', status: 'Delivered', carrier_id: 'v1', vetting: {} }, docs);
  const cust = w.document.getElementById('zone-customer');
  const carr = w.document.getElementById('zone-carrier');
  // POD → customer side (in_submission=true)
  assert.match(cust.textContent, /POD/);
  // BOL → customer side (in_submission=false) — must NOT appear
  assert.doesNotMatch(cust.textContent, /BOL/);
  // Carrier Invoice → carrier side (in_submission=true)
  assert.match(carr.textContent, /Carrier Invoice/);
  // POD must NOT appear in carrier zone
  assert.doesNotMatch(carr.textContent, /POD/);
});

test('W3: empty state when no in_submission docs for a side', () => {
  const { dom } = bootW3();
  const w = dom.window;
  const docs = [
    { id: 'd1', document_type: 'Rate Con', has_file: true, voided: false, in_submission: false, preview_token: 'tok1' },
  ];
  w.renderSubmitPanel({ id: 'LD001', status: 'Delivered', carrier_id: 'v1', vetting: {} }, docs);
  const panel = w.document.getElementById('submit-panel');
  const emptyDivs = panel.querySelectorAll('.fz-empty');
  assert.ok(emptyDivs.length >= 2, 'both sides show None yet. when no in_submission docs');
});

test('W3: Preview button appears for in_submission doc with has_file', () => {
  const { dom } = bootW3();
  const w = dom.window;
  const calls = [];
  w.openDocViewer = function(url, title) { calls.push({ url, title }); };
  const docs = [
    { id: 'd1', document_type: 'POD', has_file: true, voided: false, in_submission: true, preview_token: 'abc123' },
  ];
  w.renderSubmitPanel({ id: 'LD001', status: 'Delivered', carrier_id: 'v1', vetting: {} }, docs);
  const panel = w.document.getElementById('submit-panel');
  const previewBtn = panel.querySelector('button.pkt-preview');
  assert.ok(previewBtn, 'Preview button exists');
  previewBtn.click();
  assert.equal(calls.length, 1, 'openDocViewer called');
  assert.match(calls[0].url, /\/tms-doc-file\?t=abc123$/);
  assert.equal(calls[0].title, 'POD');
});

test('W3: Preview button absent when has_file is false', () => {
  const { dom } = bootW3();
  const w = dom.window;
  const docs = [
    { id: 'd1', document_type: 'POD', has_file: false, voided: false, in_submission: true, preview_token: '' },
  ];
  w.renderSubmitPanel({ id: 'LD001', status: 'Delivered', carrier_id: 'v1', vetting: {} }, docs);
  const panel = w.document.getElementById('submit-panel');
  const previewBtn = panel.querySelector('button.pkt-preview');
  assert.ok(!previewBtn, 'No Preview button when has_file=false');
});

test('W3: voided in_submission doc shows strikethrough indicator', () => {
  const { dom } = bootW3();
  const w = dom.window;
  const docs = [
    { id: 'd1', document_type: 'POD', has_file: true, voided: true, in_submission: true, preview_token: 'tok1' },
  ];
  w.renderSubmitPanel({ id: 'LD001', status: 'Delivered', carrier_id: 'v1', vetting: {} }, docs);
  const panel = w.document.getElementById('submit-panel');
  const voidedRow = panel.querySelector('.fz-doc.voided');
  assert.ok(voidedRow, 'voided row has voided class');
  assert.match(voidedRow.textContent, /voided/i);
});

test('W3: Remove button posts in_submission:false and calls refreshDocs', async () => {
  const { dom, posts } = bootW3();
  const w = dom.window;
  let refreshed = false;
  w.refreshDocs = function() { refreshed = true; return Promise.resolve(); };
  const docs = [
    { id: 'd1', document_type: 'POD', has_file: true, voided: false, in_submission: true, preview_token: 'tok1' },
  ];
  w.renderSubmitPanel({ id: 'LD001', status: 'Delivered', carrier_id: 'v1', vetting: {} }, docs);
  const panel = w.document.getElementById('submit-panel');
  const removeBtn = panel.querySelector('button.pkt-remove');
  assert.ok(removeBtn, 'Remove button exists');
  removeBtn.click();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(posts.length, 1, 'one POST made');
  assert.match(posts[0].url, /\/tms-doc\/submission$/);
  assert.equal(posts[0].body.doc_id, 'd1');
  assert.equal(posts[0].body.in_submission, false);
  assert.equal(posts[0].body.email, 'b@x.com');
  assert.equal(posts[0].body.load_id, 'LD001');
  assert.equal(refreshed, true, 'refreshDocs called after Remove');
});

test('W3: no upload dropzone elements in the packet panel', () => {
  const { dom } = bootW3();
  const w = dom.window;
  w.renderSubmitPanel({ id: 'LD001', status: 'Delivered', carrier_id: 'v1', vetting: {} }, []);
  const panel = w.document.getElementById('submit-panel');
  assert.ok(!panel.querySelector('.dropzone'), 'no .dropzone elements in packet');
  assert.ok(!panel.querySelector('input[type="file"]'), 'no file inputs in packet');
  assert.ok(!panel.querySelector('#zone-customer-upload-btn'), 'no upload button in packet');
  assert.ok(!panel.querySelector('#zone-carrier-upload-btn'), 'no carrier upload button in packet');
});

// ── W4: invoice .field wrapper + full-width primary submit button ────────────

test('W4: invoice input is wrapped in a .field div with label', () => {
  const { dom } = bootW3();
  const w = dom.window;
  w.renderSubmitPanel({ id: 'LD001', status: 'Delivered', carrier_id: 'v1', vetting: {} }, []);
  const panel = w.document.getElementById('submit-panel');
  const inv = panel.querySelector('#f-factoring-invoice');
  assert.ok(inv, '#f-factoring-invoice exists');
  const fieldDiv = inv.closest('.field');
  assert.ok(fieldDiv, '#f-factoring-invoice is wrapped in a .field div');
  const lbl = fieldDiv.querySelector('label');
  assert.ok(lbl, '.field contains a label element');
  assert.match(lbl.textContent, /Carrier \/ Factoring Invoice/i, 'label text matches');
});

test('W4: submit button has btn and primary classes', () => {
  const { dom } = bootW3();
  const w = dom.window;
  w.renderSubmitPanel({ id: 'LD001', status: 'Delivered', carrier_id: 'v1', vetting: {} }, []);
  const btn = w.document.getElementById('btn-submit-factoring');
  assert.ok(btn, '#btn-submit-factoring exists');
  assert.ok(btn.classList.contains('btn'), 'button has .btn class');
  assert.ok(btn.classList.contains('primary'), 'button has .primary class');
  assert.ok(btn.disabled, 'button is disabled by default');
});

test('W4: .ready amber behavior still composes with .btn.primary', () => {
  const { dom } = bootW3();
  const w = dom.window;
  w.renderSubmitPanel(
    { id: 'LD001', status: 'Ready to Submit', carrier_id: 'v1', vetting: {} },
    [{ document_type: 'POD' }, { document_type: 'Carrier Invoice' }]
  );
  const inv = w.document.getElementById('f-factoring-invoice');
  inv.value = 'FCT-999';
  inv.dispatchEvent(new w.Event('input'));
  const btn = w.document.getElementById('btn-submit-factoring');
  assert.equal(btn.disabled, false, 'button enabled when gates pass');
  assert.ok(btn.classList.contains('ready'), 'button has .ready class when enabled');
  assert.ok(btn.classList.contains('btn'), '.btn class still present');
  assert.ok(btn.classList.contains('primary'), '.primary class still present');
});

test('W4: disabled attr present when gates fail, absent when gates pass; btn+primary always present', () => {
  // Gates fail: no carrier, wrong status
  const { dom: domFail } = bootW3();
  const wF = domFail.window;
  wF.renderSubmitPanel(
    { id: 'LD001', status: 'In Transit', carrier_id: '', vetting: {} },
    []
  );
  const btnFail = wF.document.getElementById('btn-submit-factoring');
  assert.equal(btnFail.disabled, true, 'disabled attribute set when gates fail (grey state)');
  assert.ok(btnFail.classList.contains('btn'), '.btn class present on disabled button');
  assert.ok(btnFail.classList.contains('primary'), '.primary class present on disabled button');

  // Gates pass: correct status, carrier, invoice
  const { dom: domPass } = bootW3();
  const wP = domPass.window;
  wP.renderSubmitPanel(
    { id: 'LD001', status: 'Ready to Submit', carrier_id: 'v1', vetting: {} },
    [{ document_type: 'POD' }, { document_type: 'Carrier Invoice' }]
  );
  const inv = wP.document.getElementById('f-factoring-invoice');
  inv.value = 'FCT-1';
  inv.dispatchEvent(new wP.Event('input'));
  const btnPass = wP.document.getElementById('btn-submit-factoring');
  assert.equal(btnPass.disabled, false, 'disabled attribute cleared when gates pass (amber state)');
  assert.ok(btnPass.classList.contains('btn'), '.btn class present on enabled button');
  assert.ok(btnPass.classList.contains('primary'), '.primary class present on enabled button');
});

test('packet doc rows use a flex layout so buttons do not wrap', () => {
  // CSS layout is not computed by jsdom; assert the stylesheet declares the rule.
  assert.match(html, /\.fz-doc\s*\{[^}]*display\s*:\s*flex/);
  assert.match(html, /\.fz-doc-label\s*\{[^}]*flex\s*:\s*1/);
});
