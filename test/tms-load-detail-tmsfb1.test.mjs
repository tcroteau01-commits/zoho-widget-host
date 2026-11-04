// TMSFB1 (load detail): in-page clause editor, send popup + CC, POD reminder, delete draft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../tms-load-detail.html', import.meta.url), 'utf8');

const TERMS = [
  { id: 'double_broker', title: 'No Double Brokering', enabled: true, body: 'No re-brokering.', vars: {}, custom: false },
  { id: 'detention', title: 'Detention', enabled: true, body: 'Detention at {rate} per hour.', vars: { rate: '$50.00' }, custom: false },
];

function makeWidget(opts) {
  opts = opts || {};
  const posts = [];
  const gets = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/tms-load-detail.html?serviceOrigin=https%3A%2F%2Fbrokerhub.operfi.com',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.confirm = () => { throw new Error('native confirm() must not be used'); };
      window.fetch = function (url, init) {
        url = String(url);
        if (init && init.method === 'POST') {
          const body = JSON.parse(init.body);
          posts.push({ url, body });
          if (/\/tms-pod\/nudge$/.test(url)) {
            return Promise.resolve({ json: () => Promise.resolve(opts.nudgeResp || { sent: body.load_ids, skipped: [] }) });
          }
          if (/\/tms-load\/delete$/.test(url)) {
            const r = opts.deleteResp || { ok: true };
            return Promise.resolve({ ok: r.ok !== false, json: () => Promise.resolve(r) });
          }
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, emailed: true }) });
        }
        gets.push(url);
        if (/\/tms-doc\/recipients/.test(url)) {
          if (opts.noRecipients) return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'Not Found' }) });
          return Promise.resolve({ ok: true, json: () => Promise.resolve({
            carrier_email: 'dispatch@roadway.com', customer_email: 'ap@bigshipper.com', broker_email: 'rep@broker.com' }) });
        }
        if (/\/tms-doc\/upload-link/.test(url)) {
          return Promise.resolve({ json: () => Promise.resolve({ url: 'https://x/up?token=1', emailed: true }) });
        }
        if (/\/tms-docs/.test(url)) return Promise.resolve({ json: () => Promise.resolve({ documents: [] }) });
        return Promise.resolve({ json: () => Promise.resolve({ carriers: [], customers: [], templates: [] }) });
      };
    },
  });
  const w = dom.window;
  w.brokerEmail = 'b@op.com';
  w.loadId = '1001';
  w._currentLoad = { id: '1001', load_number: 'ACME-1042', status: opts.status || 'Covered' };
  w.document.getElementById('f-status').value = opts.status || 'Covered';
  return { window: w, posts, gets };
}

const tick = () => new Promise((r) => setTimeout(r, 5));
// the page's load handler re-reads the target and resets loadId, so prime after it
const loaded = async (w) => { await tick(); w.loadId = '1001'; };

// ---- send popup ----
test('the inline doc-to email inputs are gone from the Documents card', () => {
  const { window } = makeWidget();
  assert.equal(window.document.querySelectorAll('#docs-card .doc-gen-row input.doc-to').length, 0);
  assert.equal(window.document.getElementById('doc-to-rate_con'), null);
});

test('RC Send opens the popup with To prefilled from /tms-doc/recipients (carrier side)', async () => {
  const { window, posts, gets } = makeWidget();
  await loaded(window);
  window.document.querySelector('button[data-act="send"][data-doc="rate_con"]').click();
  await tick();
  const m = window.document.getElementById('send-modal');
  assert.equal(m.classList.contains('hidden'), false);
  assert.match(window.document.getElementById('sm-title').textContent, /Rate Confirmation/);
  assert.match(window.document.getElementById('sm-note').textContent, /ACME-1042/);
  assert.equal(window.document.getElementById('sm-to').value, 'dispatch@roadway.com');
  assert.ok(gets.some((u) => /\/tms-doc\/recipients\?email=b%40op\.com&load_id=1001/.test(u)));
  assert.equal(posts.length, 0, 'nothing sent until Send is clicked');
});

test('Invoice Send prefills the customer email', async () => {
  const { window } = makeWidget();
  await window.openSendModal('doc', 'customer_invoice');
  assert.equal(window.document.getElementById('sm-to').value, 'ap@bigshipper.com');
});

test('modal Send posts generate with recipient_email and a parsed cc array', async () => {
  const { window, posts } = makeWidget();
  await window.openSendModal('doc', 'bol');
  window.document.getElementById('sm-to').value = 'ops@roadway.com';
  window.document.getElementById('sm-cc').value = ' a@x.com; b@y.com , A@x.com,, ';
  await window.submitSendModal();
  const p = posts.find((x) => /\/tms-doc\/generate$/.test(x.url));
  assert.equal(p.body.doc_type, 'bol');
  assert.equal(p.body.send, true);
  assert.equal(p.body.recipient_email, 'ops@roadway.com');
  assert.deepEqual(p.body.cc, ['a@x.com', 'b@y.com']);
  assert.ok(window.document.getElementById('send-modal').classList.contains('hidden'));
});

test('no cc key is sent when CC is blank', async () => {
  const { window, posts } = makeWidget();
  await window.openSendModal('doc', 'rate_con');
  await window.submitSendModal();
  const p = posts.find((x) => /\/tms-doc\/generate$/.test(x.url));
  assert.equal(p.body.recipient_email, 'dispatch@roadway.com');
  assert.equal('cc' in p.body, false);
});

test('parseCcList: commas or semicolons, dedupes, max 5, rejects bad addresses', () => {
  const { window } = makeWidget();
  assert.deepEqual(Array.from(window.parseCcList('a@x.com;b@y.com').list), ['a@x.com', 'b@y.com']);
  assert.equal(window.parseCcList('').list.length, 0);
  assert.match(window.parseCcList('a@x.com, not-an-email').error, /not-an-email/);
  assert.match(window.parseCcList('1@x.com,2@x.com,3@x.com,4@x.com,5@x.com,6@x.com').error, /5/);
  assert.equal(window.parseCcList('1@x.com,2@x.com,3@x.com,4@x.com,5@x.com').list.length, 5);
});

test('modal validation: To required + valid, bad CC blocks the send', async () => {
  const { window, posts } = makeWidget();
  await window.openSendModal('doc', 'rate_con');
  const to = window.document.getElementById('sm-to');
  const err = window.document.getElementById('sm-err');
  to.value = '';
  await window.submitSendModal();
  assert.match(err.textContent, /who this goes to/);
  to.value = 'nope';
  await window.submitSendModal();
  assert.match(err.textContent, /valid email/);
  to.value = 'ok@x.com';
  window.document.getElementById('sm-cc').value = 'bad@';
  await window.submitSendModal();
  assert.match(err.textContent, /CC/);
  assert.equal(posts.length, 0);
  assert.equal(window.document.getElementById('send-modal').classList.contains('hidden'), false);
});

test('Cancel closes the popup and sends nothing', async () => {
  const { window, posts } = makeWidget();
  await loaded(window);
  await window.openSendModal('doc', 'rate_con');
  window.document.getElementById('sm-cancel').click();
  assert.ok(window.document.getElementById('send-modal').classList.contains('hidden'));
  await window.submitSendModal();
  assert.equal(posts.length, 0);
});

test('an old API without /tms-doc/recipients still opens the popup with To blank', async () => {
  const { window } = makeWidget({ noRecipients: true });
  await window.openSendModal('doc', 'rate_con');
  assert.equal(window.document.getElementById('send-modal').classList.contains('hidden'), false);
  assert.equal(window.document.getElementById('sm-to').value, '');
});

test('Email to carrier goes through the popup and passes recipient_email + comma cc', async () => {
  const { window, gets } = makeWidget();
  await loaded(window);
  window.document.getElementById('carrier-email-btn').click();
  await tick();
  assert.match(window.document.getElementById('sm-title').textContent, /upload link/);
  window.document.getElementById('sm-cc').value = 'a@x.com;b@y.com';
  await window.submitSendModal();
  const hit = gets.find((u) => /\/tms-doc\/upload-link/.test(u));
  assert.match(hit, /send=1/);
  assert.match(hit, /recipient_email=dispatch%40roadway\.com/);
  assert.match(hit, /cc=a%40x\.com%2Cb%40y\.com/);
});

// ---- POD reminder ----
test('Send POD reminder shows only for Delivered or In Transit', () => {
  for (const [status, shown] of [['Delivered', true], ['In Transit', true], ['Covered', false], ['Draft', false], ['POD Received', false]]) {
    const { window } = makeWidget({ status });
    window.refreshSaveButtons();
    assert.equal(!window.document.getElementById('pod-nudge-btn').classList.contains('hidden'), shown, status);
  }
});

test('POD reminder posts one load_id with recipient + cc to /tms-pod/nudge', async () => {
  const { window, posts } = makeWidget({ status: 'Delivered' });
  await loaded(window);
  window.refreshSaveButtons();
  window.document.getElementById('pod-nudge-btn').click();
  await tick();
  assert.equal(window.document.getElementById('sm-to').value, 'dispatch@roadway.com');
  window.document.getElementById('sm-cc').value = 'ops@broker.com';
  await window.submitSendModal();
  const p = posts.find((x) => /\/tms-pod\/nudge$/.test(x.url));
  assert.deepEqual(p.body, { email: 'b@op.com', load_ids: ['1001'],
                             recipient_email: 'dispatch@roadway.com', cc: ['ops@broker.com'] });
  assert.match(window.document.getElementById('doc-status').textContent, /POD reminder sent/);
});

test('a skipped POD reminder reports the reason', async () => {
  const { window } = makeWidget({ status: 'Delivered',
    nudgeResp: { sent: [], skipped: [{ id: '1001', reason: 'nudged in the last 10 minutes' }] } });
  await window.sendPodNudge('dispatch@roadway.com', []);
  assert.match(window.document.getElementById('doc-status').textContent, /not sent: nudged in the last 10 minutes/);
});

// ---- delete draft ----
test('Delete draft shows only for a saved Draft or Available load', () => {
  for (const [status, shown] of [['Draft', true], ['Available', true], ['Covered', false], ['Delivered', false]]) {
    const { window } = makeWidget({ status });
    window.refreshSaveButtons();
    assert.equal(!window.document.getElementById('delete-draft-btn').classList.contains('hidden'), shown, status);
  }
  const { window } = makeWidget({ status: 'Draft' });
  window.loadId = '';
  window.refreshSaveButtons();
  assert.ok(window.document.getElementById('delete-draft-btn').classList.contains('hidden'), 'unsaved load');
});

test('Delete draft confirms in-page, posts /tms-load/delete, then returns to the board', async () => {
  const { window, posts } = makeWidget({ status: 'Draft' });
  let nav = '';
  window.goToBoard = () => { nav = window.portalPageUrl('TMS_Dispatch_Board'); };
  const done = window.deleteDraftLoad();
  const cm = window.document.getElementById('confirm-modal');
  assert.equal(cm.classList.contains('hidden'), false);
  assert.match(cm.textContent, /ACME-1042/);
  assert.equal(posts.length, 0);
  window.document.getElementById('cm-ok').click();
  await done;
  const p = posts.find((x) => /\/tms-load\/delete$/.test(x.url));
  assert.deepEqual(p.body, { email: 'b@op.com', load_id: '1001' });
  assert.equal(nav, 'https://brokerhub.operfi.com/#Page:TMS_Dispatch_Board');
});

test('declining the delete confirm posts nothing and stays on the page', async () => {
  const { window, posts } = makeWidget({ status: 'Draft' });
  let navigated = false;
  window.goToBoard = () => { navigated = true; };
  const done = window.deleteDraftLoad();
  window.document.getElementById('cm-cancel').click();
  await done;
  assert.equal(posts.length, 0);
  assert.equal(navigated, false);
});

// ---- per-load terms editor ----
function termsLoad(extra) {
  return Object.assign({ id: 'L1', load_number: 'ACME-1042', status: 'Covered', added_time: '29-Jul-2026 10:00:00',
    rate_con_terms: JSON.parse(JSON.stringify(TERMS)).concat(extra || []), terms_customized: false }, {});
}

test('terms: blur does not commit a body edit; Cancel discards it', () => {
  const { window } = makeWidget();
  window.canEditTerms = true;
  window.renderTermsCard(termsLoad());
  window.unlockTerms();
  window.termsEditBody(1);
  const ta = window.document.querySelector('#tbody-detention textarea');
  ta.value = 'Changed.';
  ta.dispatchEvent(new window.Event('blur', { bubbles: true }));
  assert.ok(window.document.querySelector('#tbody-detention textarea'), 'still editing');
  assert.match(window.document.querySelector('#tbody-detention .ed-save').textContent, /Done/);
  window.document.querySelector('#tbody-detention .ed-cancel').click();
  assert.equal(window.document.querySelector('#tbody-detention textarea'), null);
  assert.match(window.document.getElementById('tbody-detention').textContent, /Detention at \$50\.00/);
});

test('terms: + Add clause opens the in-page editor, never prompt(), and cleans the text', async () => {
  const { window, posts } = makeWidget();
  window.canEditTerms = true;
  let prompted = 0;
  window.prompt = () => { prompted++; return 'x'; };
  window.renderTermsCard(termsLoad());
  window.unlockTerms();
  window.document.getElementById('terms-add-btn').click();
  const host = window.document.getElementById('terms-add-host');
  const ti = host.querySelector('.ed-title');
  const ta = host.querySelector('textarea');
  assert.ok(ti && ta, 'title + textarea rendered');
  assert.ok(ta.rows >= 6);
  ti.value = 'Lumper';
  ta.value = 'Lumper paid by carrier.\r\n\r\n\r\n\tReimbursed with receipt.  ';
  host.querySelector('.ed-save').click();
  assert.equal(prompted, 0);
  await window.saveLoadTerms();
  const sent = posts.find((x) => /\/tms-load-terms$/.test(x.url)).body.clauses;
  assert.equal(sent.length, 3);
  assert.equal(sent[2].title, 'Lumper');
  assert.equal(sent[2].body, 'Lumper paid by carrier.\n\n Reimbursed with receipt.');
  assert.equal(sent[2].custom, true);
});

test('terms: a custom clause title is editable', () => {
  const { window } = makeWidget();
  window.canEditTerms = true;
  window.renderTermsCard(termsLoad([{ id: 'custom_1', title: 'Old', enabled: true, body: 'B', vars: {}, custom: true }]));
  window.unlockTerms();
  window.termsEditBody(1);
  assert.equal(window.document.querySelector('#tbody-detention .ed-title'), null, 'built-in title is fixed');
  window.document.querySelector('#tbody-detention .ed-cancel').click();
  window.termsEditBody(2);
  window.document.querySelector('#tbody-custom_1 .ed-title').value = 'New title';
  window.document.querySelector('#tbody-custom_1 .ed-save').click();
  assert.match(window.document.getElementById('terms-body').textContent, /New title/);
});

test('terms: pasting inserts cleaned text', () => {
  const { window } = makeWidget();
  window.canEditTerms = true;
  window.renderTermsCard(termsLoad());
  window.unlockTerms();
  window.termsEditBody(0);
  const ta = window.document.querySelector('#tbody-double_broker textarea');
  ta.value = '';
  const ev = new window.Event('paste', { bubbles: true, cancelable: true });
  ev.clipboardData = { getData: () => 'One\u00A0two\r\n\r\n\r\nthree\u200B  ' };
  ta.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(ta.value, 'One two\n\nthree');
});

test('cleanClauseText matches the settings widget rules', () => {
  const { window } = makeWidget();
  const c = window.cleanClauseText;
  assert.equal(c('a\r\nb\rc'), 'a\nb\nc');
  assert.equal(c('a\u00A0b\u2003c'), 'a b c');
  assert.equal(c('a\u200Bb\uFEFFc'), 'abc');
  assert.equal(c('x \t\ny'), 'x\ny');
  assert.equal(c('p1\n\n\n\np2'), 'p1\n\np2');
  assert.equal(c('keep  two  spaces'), 'keep  two  spaces');
});

test('no prompt() clause flow remains; clause body + snapshot keep line breaks', () => {
  assert.doesNotMatch(HTML, /prompt\('Clause/);
  assert.match(HTML, /\.cl-body \{[^}]*white-space:pre-line/);
  assert.match(HTML, /ol\.snap li \{[^}]*white-space:pre-line/);
});

test('a 409 from delete shows the server error and does not navigate', async () => {
  const { window } = makeWidget({ status: 'Available', deleteResp: { ok: false, error: 'Only Draft or Available loads can be deleted' } });
  let navigated = false;
  window.goToBoard = () => { navigated = true; };
  const done = window.deleteDraftLoad();
  window.document.getElementById('cm-ok').click();
  await done;
  assert.equal(navigated, false);
  assert.match(window.document.getElementById('form-error').textContent, /Only Draft or Available/);
});
