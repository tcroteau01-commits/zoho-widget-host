// TMSFB3: the last native confirm()/prompt() calls in the TMS pages become in-page dialogs.
// Board: Cancel load. Detail: Save as template, Duplicate, Delete document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const ROOT = new URL('../', import.meta.url);
const BOARD = readFileSync(new URL('tms-load-board.html', ROOT), 'utf8');
const DETAIL = readFileSync(new URL('tms-load-detail.html', ROOT), 'utf8');

const tick = () => new Promise((r) => setTimeout(r, 5));
const native = (name) => () => { throw new Error('native ' + name + '() must not be used'); };

function stubNatives(window) {
  window.confirm = native('confirm');
  window.prompt = native('prompt');
  window.alert = native('alert');
}

function makeBoard() {
  const posts = [];
  const dom = new JSDOM(BOARD, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/tms-load-board.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      stubNatives(window);
      window.fetch = function (url, init) {
        if (init && init.method === 'POST') {
          posts.push({ url: String(url), body: JSON.parse(init.body) });
          return Promise.resolve({ json: () => Promise.resolve({ ok: true, updated: ['30'], skipped: [] }) });
        }
        return Promise.resolve({ json: () => Promise.resolve({ loads: [], count: 0 }) });
      };
    },
  });
  dom.window.brokerEmail = 'b@op.com';
  return { window: dom.window, posts };
}

function makeDetail() {
  const posts = [];
  const dom = new JSDOM(DETAIL, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/tms-load-detail.html?serviceOrigin=https%3A%2F%2Fbrokerhub.operfi.com',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      stubNatives(window);
      window.fetch = function (url, init) {
        url = String(url);
        if (init && init.method === 'POST') {
          posts.push({ url, body: JSON.parse(init.body) });
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
        }
        if (/\/tms-docs/.test(url)) return Promise.resolve({ json: () => Promise.resolve({ documents: [] }) });
        return Promise.resolve({ json: () => Promise.resolve({ carriers: [], customers: [], templates: [] }) });
      };
    },
  });
  const w = dom.window;
  w.brokerEmail = 'b@op.com';
  w.loadId = '1001';
  w._currentLoad = { id: '1001', load_number: 'ACME-1042', status: 'Covered' };
  return { window: w, posts };
}
const loaded = async (w) => { await tick(); w.loadId = '1001'; };

function pickCustomer(w) {
  const sel = w.document.getElementById('f-customer_id');
  const o = w.document.createElement('option'); o.value = 'cu1'; o.textContent = 'Big Shipper';
  sel.appendChild(o); sel.value = 'cu1';
}
const key = (w, el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
const pm = (w) => w.document.getElementById('prompt-modal');
const isOpen = (el) => !el.classList.contains('hidden');

// ---- board: Cancel load ----
test('board: Cancel load opens the in-page confirm and posts nothing yet', async () => {
  const { window, posts } = makeBoard();
  window.cancelLoad({ id: '30', load_number: 'L-30', status: 'Booked' });
  const dlg = window.document.getElementById('tms-confirm');
  assert.ok(dlg, 'in-page confirm shown');
  assert.match(dlg.textContent, /Cancel load L-30\?/);
  assert.equal(dlg.querySelector('.cf-ok').textContent, 'Cancel load');
  assert.equal(posts.length, 0);
});

test('board: Keep it does nothing', async () => {
  const { window, posts } = makeBoard();
  const done = window.cancelLoad({ id: '30', load_number: 'L-30', status: 'Booked' });
  window.document.querySelector('#tms-confirm .cf-cancel').click();
  await done;
  assert.equal(posts.length, 0);
  assert.equal(window.document.getElementById('tms-confirm'), null);
});

test('board: Esc cancels the confirm without closing the slide-out', async () => {
  const { window, posts } = makeBoard();
  window.renderView({ id: '30', load_number: 'L-30', status: 'Booked' });
  window.document.getElementById('tms-slideout').classList.add('open');
  const done = window.cancelLoad({ id: '30', load_number: 'L-30', status: 'Booked' });
  key(window, window.document.querySelector('#tms-confirm .cf-cancel'), 'Escape');
  await done;
  assert.equal(posts.length, 0);
  assert.equal(window.document.getElementById('tms-confirm'), null);
  assert.ok(window.document.getElementById('tms-slideout').classList.contains('open'), 'slide-out stays open');
});

test('board: confirming posts the same single-id cancel as before', async () => {
  const { window, posts } = makeBoard();
  const done = window.cancelLoad({ id: '30', load_number: 'L-30', status: 'Booked' });
  window.document.querySelector('#tms-confirm .cf-ok').click();
  await done;
  const p = posts.find((x) => /\/tms-status-bulk$/.test(x.url));
  assert.ok(p, 'posted /tms-status-bulk');
  assert.deepEqual(p.body, { email: 'b@op.com', load_ids: ['30'], status: 'Cancelled' });
});

// ---- detail: Save as template ----
test('detail: Save as template opens a labelled text input with focus, max 80', async () => {
  const { window, posts } = makeDetail();
  await loaded(window);
  pickCustomer(window);
  window.document.getElementById('save-template-btn').click();
  assert.ok(isOpen(pm(window)));
  const inp = window.document.getElementById('pm-input');
  assert.equal(inp.type, 'text');
  assert.equal(inp.getAttribute('maxlength'), '80');
  assert.equal(window.document.querySelector('label[for="pm-input"]').textContent, 'Template name');
  assert.equal(window.document.activeElement, inp, 'focus goes to the input');
  assert.equal(posts.length, 0);
});

test('detail: template name is required and trimmed; over 80 is rejected inline', async () => {
  const { window, posts } = makeDetail();
  await loaded(window);
  pickCustomer(window);
  const saving = window.saveTemplate();
  const inp = window.document.getElementById('pm-input');
  const err = window.document.getElementById('pm-err');
  inp.value = '   ';
  window.document.getElementById('pm-ok').click();
  assert.match(err.textContent, /Enter a template name/);
  assert.ok(isOpen(pm(window)), 'stays open on a bad value');
  inp.value = 'x'.repeat(81);            // maxlength stops typing; pasted/scripted values still validated
  window.document.getElementById('pm-ok').click();
  assert.match(err.textContent, /80 characters or fewer/);
  assert.equal(posts.length, 0);
  inp.value = '  Dallas reefer  ';
  key(window, inp, 'Enter');              // Enter submits
  await saving;
  const p = posts.find((x) => /\/tms-template$/.test(x.url));
  assert.ok(p, 'posted /tms-template');
  assert.equal(p.body.template_name, 'Dallas reefer');
  assert.equal(p.body.customer_id, 'cu1');
  assert.equal(isOpen(pm(window)), false);
});

test('detail: Cancel and Esc on Save as template post nothing', async () => {
  const { window, posts } = makeDetail();
  await loaded(window);
  pickCustomer(window);
  let saving = window.saveTemplate();
  window.document.getElementById('pm-input').value = 'Lane A';
  window.document.getElementById('pm-cancel').click();
  await saving;
  saving = window.saveTemplate();
  window.document.getElementById('pm-input').value = 'Lane A';
  key(window, window.document.getElementById('pm-input'), 'Escape');
  await saving;
  assert.equal(posts.length, 0);
  assert.equal(isOpen(pm(window)), false);
});

test('detail: Save as template still requires a customer first, with no dialog', async () => {
  const { window } = makeDetail();
  await loaded(window);
  await window.saveTemplate();
  assert.equal(isOpen(pm(window)), false);
});

// ---- detail: Duplicate ----
test('detail: Duplicate opens a number input (1 to 20) defaulting to 1, focused', async () => {
  const { window, posts } = makeDetail();
  await loaded(window);
  window.document.getElementById('duplicate-btn').click();
  assert.ok(isOpen(pm(window)));
  const inp = window.document.getElementById('pm-input');
  assert.equal(inp.type, 'number');
  assert.equal(inp.getAttribute('min'), '1');
  assert.equal(inp.getAttribute('max'), '20');
  assert.equal(inp.value, '1');
  assert.equal(window.document.activeElement, inp);
  assert.equal(posts.length, 0);
});

test('detail: copies validation rejects 0, 21, 2.5 and blank inline', async () => {
  const { window, posts } = makeDetail();
  await loaded(window);
  window.promptDuplicate();
  const inp = window.document.getElementById('pm-input');
  const err = window.document.getElementById('pm-err');
  for (const bad of ['0', '21', '2.5', '', '-3']) {
    inp.value = bad;
    window.document.getElementById('pm-ok').click();
    assert.match(err.textContent, /whole number from 1 to 20/, 'rejects ' + JSON.stringify(bad));
    assert.equal(inp.getAttribute('aria-invalid'), 'true');
    assert.ok(isOpen(pm(window)));
  }
  assert.equal(posts.length, 0);
  inp.dispatchEvent(new window.Event('input'));
  assert.equal(err.textContent, '', 'typing clears the error');
});

test('detail: confirming 3 copies posts 3 drafts to /tms-load, same as before', async () => {
  const { window, posts } = makeDetail();
  await loaded(window);
  const dup = window.promptDuplicate();
  const inp = window.document.getElementById('pm-input');
  inp.value = '3';
  key(window, inp, 'Enter');
  await dup;
  const p = posts.filter((x) => /\/tms-load$/.test(x.url));
  assert.equal(p.length, 3);
  p.forEach((x) => { assert.equal(x.body.status, 'Draft'); assert.equal(x.body.id, ''); assert.equal(x.body.carrier_id, ''); });
});

test('detail: Cancel on Duplicate creates nothing', async () => {
  const { window, posts } = makeDetail();
  await loaded(window);
  const dup = window.promptDuplicate();
  window.document.getElementById('pm-cancel').click();
  await dup;
  assert.equal(posts.length, 0);
});

// ---- detail: Delete document ----
const DOC = { id: 'd1', document_type: 'POD', source: 'uploaded', uploaded_at: '2026-06-01T10:00:00',
  has_file: true, voided: false, in_submission: false, preview_token: 'tok1' };

test('detail: Delete document opens the in-page confirm; Keep it posts nothing', async () => {
  const { window, posts } = makeDetail();
  await loaded(window);
  window.renderDocLibrary([DOC]);
  window.document.querySelector('button.doc-lib-delete').click();
  const cm = window.document.getElementById('confirm-modal');
  assert.ok(isOpen(cm));
  assert.match(window.document.getElementById('cm-title').textContent, /Delete this document\?/);
  window.document.getElementById('cm-cancel').click();
  await tick();
  assert.equal(posts.length, 0);
});

test('detail: confirming Delete document posts /tms-doc/delete as before', async () => {
  const { window, posts } = makeDetail();
  await loaded(window);
  window.renderDocLibrary([DOC]);
  window.document.querySelector('button.doc-lib-delete').click();
  window.document.getElementById('cm-ok').click();
  await tick();
  const p = posts.find((x) => /\/tms-doc\/delete$/.test(x.url));
  assert.ok(p);
  assert.deepEqual(p.body, { email: 'b@op.com', load_id: '1001', doc_id: 'd1' });
});

// ---- source guard ----
test('no native confirm/prompt/alert call remains in any tms-*.html', () => {
  const files = readdirSync(ROOT).filter((f) => /^tms-.*\.html$/.test(f));
  assert.ok(files.length >= 3);
  for (const f of files) {
    const src = readFileSync(new URL(f, ROOT), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(src, /(^|[^\w.$])(window\.)?(confirm|prompt|alert)\s*\(/m, f + ' still calls a native dialog');
  }
});
