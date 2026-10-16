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

test('staff see the add control under Documents', async () => {
  const { d } = await boot(PAYLOAD);
  assert.ok(d.querySelector('[data-doc-add]'));
  assert.ok(d.getElementById('cp-doc-file'));
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
