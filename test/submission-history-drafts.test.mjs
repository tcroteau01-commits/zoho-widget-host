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

test('rowHtml for a Draft load exposes an Edit control + draft badge', () => {
  const w = makeDom();
  const html = w.rowHtml(DRAFT, 0);
  assert.match(html, /data-edit-draft="900"/);
  assert.match(html, /status-pill draft/);
  assert.match(html, /Edit/);
});

test('rowHtml for a Draft load also exposes a Delete (✕) control', () => {
  const w = makeDom();
  const html = w.rowHtml(DRAFT, 0);
  assert.match(html, /data-del-draft="900"/);
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
