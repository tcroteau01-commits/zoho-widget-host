// CUSTDOC1: credit adds a document (an MSA, a PO) to a customer from the
// profile. Tom, 2026-10-16: "add and edit everything on the Customer Profile and
// keep an audit trail but not flag a change that requires someone to Mark Reviewed."
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');
const profileJs = fs.readFileSync(path.resolve('customer-profile.js'), 'utf8');
function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

const PAYLOAD = {
  submission_id: '4455', customer_name: 'HOGAN EQUIPMENT', broker: 'Marek LLC',
  status: 'Approved', engine: null, identity: null, summary: null, fv_debtor: null,
  fv_candidates: [], priors: [], priors_unavailable: false, notes: [], activity: [],
  contacts: {}, submitted: { company_name: 'HOGAN EQUIPMENT', documents: [] },
  can_act: true
};

async function boot(payload, reply) {
  const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
                              url: 'https://x.github.io/' }).window;
  await wait(50);
  w.eval(profileJs);
  const calls = [];
  w.fetch = function(url, opts) {
    calls.push({ url: url, opts: opts || {} });
    if (/\/document$/.test(url)) return Promise.resolve(reply || { ok: true, status: 200,
      json: function() { return Promise.resolve({ ok: true }); } });
    return Promise.resolve({ ok: true, status: 200, json: function() { return Promise.resolve(payload); } });
  };
  w.renderProfile({ ID: '4455' }, payload);
  return { w: w, d: w.document, calls: calls };
}

function adds(calls) { return calls.filter(function(c) { return /\/document$/.test(c.url); }); }

function pick(w, d, name) {
  const input = d.getElementById('cp-doc-file');
  const file = new w.File(['%PDF-1.4'], name, { type: 'application/pdf' });
  Object.defineProperty(input, 'files', { value: [file] });
}

test('a viewer without can_act gets no add control', async () => {
  const { d } = await boot(Object.assign({}, PAYLOAD, { can_act: false }));
  assert.equal(d.querySelector('[data-doc-add]'), null);
});

test('Documents is its own section, with the add control in it', async () => {
  const { d } = await boot(PAYLOAD);
  const sec = d.querySelector('.cp-documents');
  assert.ok(sec, 'a Documents section of its own');
  assert.ok(sec.textContent.includes('Documents'));
  assert.ok(sec.querySelector('[data-doc-add]'));
  assert.ok(sec.querySelector('#cp-doc-file'));
  assert.equal(d.querySelector('.cp-submitted [data-doc-add]'), null);
});

test('no file chosen sends nothing', async () => {
  const { d, calls } = await boot(PAYLOAD);
  d.querySelector('[data-doc-add]').click();
  await wait(20);
  assert.equal(adds(calls).length, 0);
});

test('the file and what it is go to the document route with the session cookie', async () => {
  const { w, d, calls } = await boot(PAYLOAD);
  pick(w, d, 'Hogan MSA.pdf');
  d.getElementById('cp-doc-desc').value = '  MSA ';
  d.querySelector('[data-doc-add]').click();
  await wait(20);
  const sent = adds(calls);
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /\/customer-profile\/4455\/document$/);
  assert.equal(sent[0].opts.method, 'POST');
  assert.equal(sent[0].opts.credentials, 'include');
  assert.equal(sent[0].opts.body.get('file').name, 'Hogan MSA.pdf');
  assert.equal(sent[0].opts.body.get('description'), 'MSA');
});

test('a success re-reads the profile so the new file is listed', async () => {
  const { w, d, calls } = await boot(PAYLOAD);
  pick(w, d, 'po.pdf');
  d.querySelector('[data-doc-add]').click();
  await wait(30);
  const after = calls.slice(calls.findIndex(function(c) { return /\/document$/.test(c.url); }) + 1);
  assert.ok(after.some(function(c) { return /\/customer-profile\/4455/.test(c.url) && !/\/document$/.test(c.url); }));
});

test('a refusal shows the reason and unlocks the button', async () => {
  const reply = { ok: false, status: 400, json: function() {
    return Promise.resolve({ error: 'This customer already has 10 supporting documents, the most Creator holds.' }); } };
  const { w, d } = await boot(PAYLOAD, reply);
  pick(w, d, 'po.pdf');
  const btn = d.querySelector('[data-doc-add]');
  btn.click();
  await wait(30);
  assert.ok(!btn.disabled);
  assert.ok(d.body.textContent.includes('10 supporting documents'));
});

// --- CUSTDOC2: upload time, and the shared viewer -----------------------------
// Tom, 2026-10-16: "Might be nice to see when a doc was uploaded. Would also be
// nice to have the native Doc Viewing Tool here ... so we don't have to download it."

const WITH_DOCS = Object.assign({}, PAYLOAD, { api_base: 'https://brokers.operfi.com',
  submitted: { company_name: 'HOGAN EQUIPMENT', documents: [
    { field: 'supporting', idx: 0, label: 'Supporting document 1', ext: 'PDF',
      uploaded_at: '2026-09-30T13:52:58Z' },
    { field: 'supporting', idx: 1, label: 'Supporting document 2', ext: 'PDF', uploaded_at: null }] } });

async function bootWithViewer(payload) {
  const b = await boot(payload);
  const opened = [];
  b.w.OperFiDocViewer = { open: function(o) { opened.push(o); } };
  return Object.assign(b, { opened: opened });
}

test('each file shows when it was uploaded, and a file without a time shows none', async () => {
  const { d } = await boot(WITH_DOCS);
  const items = [...d.querySelectorAll('.cp-documents li')].map(function(li) { return li.textContent; });
  assert.match(items[0], /uploaded 2026-09-30 13:52 UTC/);
  assert.doesNotMatch(items[1], /uploaded/);
});

test('clicking a file opens it in the shared viewer by its slot URL', async () => {
  const { w, d, opened } = await bootWithViewer(WITH_DOCS);
  const link = d.querySelector('.cp-documents a.cp-doc-view');
  const ev = new w.MouseEvent('click', { bubbles: true, cancelable: true });
  link.dispatchEvent(ev);
  assert.ok(ev.defaultPrevented, 'no new tab, no download');
  assert.equal(opened.length, 1);
  assert.equal(opened[0].url,
    'https://brokers.operfi.com/customer-profile/4455/doc?field=supporting&idx=0');
  assert.equal(opened[0].filename, 'Supporting document 1.pdf');
  assert.equal(opened[0].mime, 'application/pdf');
});

test('the viewer still works after the profile re-renders', async () => {
  const { w, d, opened } = await bootWithViewer(WITH_DOCS);
  w.renderProfile({ ID: '4455' }, WITH_DOCS);
  d.querySelector('.cp-documents a.cp-doc-view').click();
  assert.equal(opened.length, 1, 'opened once, not once per render');
});

test('without the viewer the link is left to open in a new tab', async () => {
  const { w, d } = await boot(WITH_DOCS);
  delete w.OperFiDocViewer;
  const ev = new w.MouseEvent('click', { bubbles: true, cancelable: true });
  d.querySelector('.cp-documents a.cp-doc-view').dispatchEvent(ev);
  assert.ok(!ev.defaultPrevented);
});
