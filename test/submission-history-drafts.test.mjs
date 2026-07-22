import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../history.html', import.meta.url), 'utf8');

function makeDom() {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/history.html?serviceOrigin=https://brokerhub.operfi.com',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ records: [] }) });
    }
  });
  return dom.window;
}

const DRAFT = { ID: '900', Purchase_Status: 'Draft', Customer_Reference_Number: 'EX-1',
  Customer_Rate: '1000', Carrier_Rate: '900' };
const PURCHASED = { ID: '901', Purchase_Status: 'Purchased', Customer_Reference_Number: 'EX-2',
  Customer_Rate: '1000', Carrier_Rate: '900' };
const PENDING = { ID: '902', Purchase_Status: 'Pending Docs', Customer_Reference_Number: 'EX-3',
  Customer_Rate: '1000', Carrier_Rate: '900' };

test('statusMeta maps Draft to a draft pill (not unknown)', () => {
  const w = makeDom();
  const m = w.statusMeta(DRAFT);
  assert.equal(m.key, 'draft');
  assert.equal(m.pill, 'draft');
  assert.match(m.label, /draft/i);
});

test('isDraft distinguishes draft loads', () => {
  const w = makeDom();
  assert.equal(w.isDraft(DRAFT), true);
  assert.equal(w.isDraft(PURCHASED), false);
});

test('statusMeta maps Pending Docs to a real label (not unknown)', () => {
  const w = makeDom();
  const m = w.statusMeta(PENDING);
  assert.equal(m.key, 'pending-docs');
  assert.match(m.label, /pending docs/i);
});

test('isEditable is true for Draft and Pending Docs, false otherwise', () => {
  const w = makeDom();
  assert.equal(w.isEditable(DRAFT), true);
  assert.equal(w.isEditable(PENDING), true);
  assert.equal(w.isEditable(PURCHASED), false);
});

test('rowHtml shows only a chevron — no inline edit/delete (actions live in the pane)', () => {
  const w = makeDom();
  const html = w.rowHtml(DRAFT, 0);
  assert.doesNotMatch(html, /data-edit-draft/);
  assert.doesNotMatch(html, /data-del-draft/);
  assert.match(html, /chev cell-chev/);
});

test('deleteDraftRow issues a DELETE to /draft-loads/<id> when confirmed', () => {
  const calls = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/history.html?serviceOrigin=https://brokerhub.operfi.com',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = (url, opts) => { calls.push({ url: String(url), opts: opts || {} }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }); };
    }
  });
  const w = dom.window;
  w.confirm = () => true;
  w.deleteDraftRow('900');
  const del = calls.find(c => /\/draft-loads\/900/.test(c.url) && c.opts.method === 'DELETE');
  assert.ok(del, 'DELETE issued');
});

function makeDomWithDelete(status) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/history.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = () => Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: () => Promise.resolve({}) });
    }
  });
  return dom.window;
}

test('deleteDraftRow treats a 404 (already deleted / stale cached row) as success — no error alert', async () => {
  const w = makeDomWithDelete(404);
  w.confirm = () => true;
  let alerted = false;
  w.alert = () => { alerted = true; };
  w.deleteDraftRow('900');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(alerted, false, 'no error alert on 404');
});

test('deleteDraftRow on a 403 (other account) shows a clear cross-account message', async () => {
  const w = makeDomWithDelete(403);
  w.confirm = () => true;
  let msg = '';
  w.alert = (m) => { msg = m; };
  w.deleteDraftRow('900');
  await new Promise(r => setTimeout(r, 10));
  assert.match(msg, /different account/i);
});

test('deleteDraftRow does nothing when the confirm is cancelled', () => {
  const calls = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/history.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = (url, opts) => { calls.push({ url: String(url), opts: opts || {} }); return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); };
    }
  });
  const w = dom.window;
  w.confirm = () => false;
  w.deleteDraftRow('900');
  assert.equal(calls.filter(c => c.opts && c.opts.method === 'DELETE').length, 0);
});

test('rowHtml surfaces the Load # in its own leading column and keeps Ref# on the customer', () => {
  const w = makeDom();
  const html = w.rowHtml({ ID: '950', Purchase_Status: 'Processing',
    Customer_Reference_Number: 'PO-77', Load_Rate_Confirmation_Number: '9150',
    Customer_Rate: '2000', Carrier_Rate: '1700' }, 0);
  assert.match(html, /Ref#\s*PO-77/);   // customer ref stays
  assert.match(html, /cell-label">Load #<\/div><div class="cell-val">9150/);   // load number in its own leading column
});

test('rowHtml shows an em dash for a missing Load # rather than "undefined"', () => {
  const w = makeDom();
  const html = w.rowHtml({ ID: '951', Purchase_Status: 'Processing',
    Customer_Reference_Number: 'PO-9', Customer_Rate: '2000', Carrier_Rate: '1700' }, 0);
  assert.match(html, /cell-label">Load #<\/div><div class="cell-val">—/);
  assert.doesNotMatch(html, /cell-val">undefined/);
});

test('rowHtml shows the carrier payment terms incl. factoring company in the list row', () => {
  const w = makeDom();
  const html = w.rowHtml({ ID: '952', Purchase_Status: 'Processing',
    Customer_Reference_Number: 'PO-1', Load_Rate_Confirmation_Number: '9150',
    Payment_Terms: 'Factoring Company - OPERATION FINANCE INC.',
    Customer_Rate: '2000', Carrier_Rate: '1700' }, 0);
  assert.match(html, /Factoring Company - OPERATION FINANCE INC\./);
});

test('rowHtml omits the payment-terms line when none is on the record', () => {
  const w = makeDom();
  const html = w.rowHtml({ ID: '953', Purchase_Status: 'Processing',
    Customer_Reference_Number: 'PO-2', Customer_Rate: '2000', Carrier_Rate: '1700' }, 0);
  assert.doesNotMatch(html, /undefined/);
});

test('rowHtml for a non-draft load keeps the chevron, no edit control', () => {
  const w = makeDom();
  const html = w.rowHtml(PURCHASED, 1);
  assert.doesNotMatch(html, /data-edit-draft/);
  assert.match(html, /class="chev/);
});

test('goToDraftQueue navigates the portal to the Draft Loads page', () => {
  const w = makeDom();
  w.goToDraftQueue();
  assert.equal(w.__lastNav, 'https://brokerhub.operfi.com/#Page:Draft_Loads');
});

test('editDraftLoad stashes the draft id and navigates to the Load Details form', () => {
  const w = makeDom();
  try { w.sessionStorage.removeItem('draftId'); } catch (e) {}
  w.editDraftLoad('900');
  assert.equal(w.sessionStorage.getItem('draftId'), '900');
  assert.equal(w.__lastNav, 'https://brokerhub.operfi.com/#Page:Load_Details');
});

test('panelActionsHtml shows Edit + Delete for editable loads only', () => {
  const w = makeDom();
  const editable = w.panelActionsHtml(PENDING);
  assert.match(editable, /id="p-edit"/);
  assert.match(editable, /id="p-del"/);
  assert.match(editable, /Fix this load/i);
  assert.equal(w.panelActionsHtml(PURCHASED), '');
});
