import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../carrier-profile.html', import.meta.url), 'utf8');

// Build a jsdom window with the widget's script executed, ZOHO + fetch stubbed
// so boot() can't throw or make network calls. Returns { window, addCalls }.
function makeWidget() {
  const addCalls = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/carrier-profile.html', // real origin → enables localStorage/sessionStorage
    beforeParse(window) {
      window.ZOHO = {
        CREATOR: {
          UTIL: { getInitParams: () => new Promise(() => {}) }, // never resolves; boot stalls harmlessly
          DATA: {
            getRecords: () => Promise.resolve({ data: [] }),
            addRecords: (args) => { addCalls.push(args); return Promise.resolve({ code: 3000, result: [{}] }); }
          }
        }
      };
      window.fetch = () => new Promise(() => {});
    }
  });
  return { window: dom.window, addCalls };
}

// comments[] is the backend-normalized shape (flat Author_Name, Comment, Created_At).
// broker_contact_id is the logged-in broker's Contact ID, resolved server-side.
const RICH = {
  account_vendor: { av_id: 'av_1' },
  vendor: { ID: '9001' },
  broker_contact_id: 'c_77',
  comments: [
    { ID: '200', Comment: 'Newer note', Comment_Type: 'Risk',
      Author_Name: 'Sarah Kobylinski', Created_At: '20-May-2026 09:00:00', Pinned: 'false' },
    { ID: '100', Comment: 'Pinned note', Comment_Type: 'Operational',
      Author_Name: 'Mark Rinaldi', Created_At: '01-May-2026 09:00:00', Pinned: 'true' }
  ]
};

test('renderComments lists comments with author, type pill, and pinned first', () => {
  const { window } = makeWidget();
  window.profilePayload = RICH;
  window.renderComments(RICH);
  const list = window.document.getElementById('cp-comments');
  const items = list.querySelectorAll('.comment');
  assert.equal(items.length, 2);
  // Pinned sorts first
  assert.match(items[0].textContent, /Pinned note/);
  assert.match(items[0].textContent, /Mark Rinaldi/);
  assert.ok(items[0].querySelector('.comment-pinned-marker'));
  // Type pill class maps Risk -> risk
  assert.ok(items[1].querySelector('.comment-type-pill.risk'));
});

test('renderComments shows empty state when no comments', () => {
  const { window } = makeWidget();
  const p = { account_vendor: { av_id: 'av_1' }, vendor: { ID: '9001' }, comments: [] };
  window.profilePayload = p;
  window.renderComments(p);
  const list = window.document.getElementById('cp-comments');
  assert.match(list.textContent, /No comments yet/);
});

test('compose form is disabled when there is no account_vendor', () => {
  const { window } = makeWidget();
  const p = { account_vendor: null, vendor: { ID: '9001' }, comments: [] };
  window.profilePayload = p;
  window.renderComments(p);
  assert.equal(window.document.getElementById('cp-comment-text').disabled, true);
  assert.equal(window.document.getElementById('cp-comment-submit').disabled, true);
});

test('compose form is enabled and wired when account_vendor is present', () => {
  const { window } = makeWidget();
  window.profilePayload = RICH;
  window.renderComments(RICH);
  assert.equal(window.document.getElementById('cp-comment-text').disabled, false);
  assert.equal(window.document.getElementById('cp-comment-submit').disabled, false);
  assert.equal(window.document.getElementById('cp-comment-submit').onclick, window.addComment);
});

test('addComment rejects empty text without calling the SDK', () => {
  const { window, addCalls } = makeWidget();
  window.profilePayload = RICH;
  window.renderComments(RICH);
  window.brokerEmail = 'broker@op.com';
  window.document.getElementById('cp-comment-text').value = '   ';
  window.addComment();
  assert.equal(addCalls.length, 0);
  assert.match(window.document.getElementById('cp-comment-feedback').textContent, /comment/i);
});

test('addComment builds the correct ADD payload', async () => {
  const { window, addCalls } = makeWidget();
  window.profilePayload = RICH;
  window.renderComments(RICH);
  window.document.getElementById('cp-comment-text').value = 'Reliable on PA->NJ runs';
  window.document.getElementById('cp-comment-type').value = 'Operational';
  await window.addComment();
  assert.equal(addCalls.length, 1);
  assert.equal(addCalls[0].form_name, 'Vendor_Comments');
  const d = addCalls[0].payload.data;
  assert.equal(d.Account_Vendor, 'av_1');
  assert.equal(d.Comment, 'Reliable on PA->NJ runs');
  assert.equal(d.Comment_Type, 'Operational');
  assert.equal(d.Author, 'c_77');   // from payload broker_contact_id, not a client lookup
  assert.equal(window.document.getElementById('cp-comment-text').value, '');
});

test('addComment surfaces an error and does not write when broker_contact_id is missing', async () => {
  const { window, addCalls } = makeWidget();
  // Payload with a relationship but no resolved contact id (e.g. stale backend).
  const p = { account_vendor: { av_id: 'av_1' }, vendor: { ID: '9001' }, comments: [] };
  window.profilePayload = p;
  window.renderComments(p);
  window.document.getElementById('cp-comment-text').value = 'Some note';
  await window.addComment();
  assert.equal(addCalls.length, 0);
  assert.match(window.document.getElementById('cp-comment-feedback').textContent, /contact/i);
  assert.equal(window.document.getElementById('cp-comment-submit').disabled, false);
});

// dd-MMM-yyyy HH:mm:ss — the Creator datetime input/display format that
// _parseCreatorDate round-trips on read.
const CREATOR_DT = /^\d{2}-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{4} \d{2}:\d{2}:\d{2}$/;

test('addComment stamps Created_At in Creator datetime format (form default does not fire on API add)', async () => {
  const { window, addCalls } = makeWidget();
  window.profilePayload = RICH;
  window.renderComments(RICH);
  window.document.getElementById('cp-comment-text').value = 'Stamped note';
  await window.addComment();
  assert.equal(addCalls.length, 1);
  assert.match(addCalls[0].payload.data.Created_At, CREATOR_DT);
});

test('addComment forwards CRM IDs when the relationship carries them, omits them otherwise', async () => {
  // With CRM IDs on the Account_Vendor row.
  let w = makeWidget();
  const withIds = { account_vendor: { av_id: 'av_1', Account_CRM_ID: '5005550001', Vendor_CRM_ID: '5005559999' },
                    vendor: { ID: '9001' }, broker_contact_id: 'c_77', comments: [] };
  w.window.profilePayload = withIds;
  w.window.renderComments(withIds);
  w.window.document.getElementById('cp-comment-text').value = 'note';
  await w.window.addComment();
  let d = w.addCalls[0].payload.data;
  assert.equal(d.Account_CRM_ID, '5005550001');
  assert.equal(d.Vendor_CRM_ID, '5005559999');

  // Without CRM IDs: keys are not sent (no empty-string writes).
  w = makeWidget();
  w.window.profilePayload = RICH;
  w.window.renderComments(RICH);
  w.window.document.getElementById('cp-comment-text').value = 'note';
  await w.window.addComment();
  d = w.addCalls[0].payload.data;
  assert.ok(!('Account_CRM_ID' in d));
  assert.ok(!('Vendor_CRM_ID' in d));
});

test('_acquireVendorTarget recovers vendorId from sessionStorage on reload (URL + localStorage empty)', () => {
  const { window } = makeWidget();
  window.localStorage.clear();
  window.sessionStorage.setItem('carrierProfileVendorId', 'v_reload_9');
  const t = window._acquireVendorTarget();
  assert.equal(t.vendorId, 'v_reload_9');
});

test('loadProfile persists vendorId to sessionStorage so a reload can recover it', () => {
  const { window } = makeWidget();
  window.sessionStorage.removeItem('carrierProfileVendorId');
  window.vendorId = 'v_42';
  window.brokerEmail = 'broker@op.com';
  window.loadProfile();   // fetch is stubbed (never resolves); persistence is synchronous
  assert.equal(window.sessionStorage.getItem('carrierProfileVendorId'), 'v_42');
});

test('submitDecision stamps Reviewed_At + Reviewed_By and forwards CRM IDs', async () => {
  const { window, addCalls } = makeWidget();
  const p = { account_vendor: { av_id: 'av_1', Account_CRM_ID: '5005550001', Vendor_CRM_ID: '5005559999' },
              vendor: { ID: '9001' }, broker_contact_id: 'c_77',
              system_recommendation: 'Approve', risk_decisions: [], comments: [] };
  window.profilePayload = p;
  window.renderChecklist(p);
  Object.keys(window.checklistState).forEach(k => { window.checklistState[k] = true; });
  window.selectedDecision = 'Approve';   // notes not required for Approve == rec
  await window.submitDecision();
  assert.equal(addCalls.length, 1);
  assert.equal(addCalls[0].form_name, 'Carrier_Risk_Decision');
  const d = addCalls[0].payload.data;
  assert.equal(d.Reviewed_By, 'c_77');
  assert.match(d.Reviewed_At, CREATOR_DT);
  assert.equal(d.Account_CRM_ID, '5005550001');
  assert.equal(d.Vendor_CRM_ID, '5005559999');
});

test('checklist blocks the decision options and submit until every item is checked', () => {
  const { window } = makeWidget();
  const p = { account_vendor: { av_id: 'av_1' }, vendor: { ID: '9001' }, bank: { has_bank_info: true }, broker_contact_id: 'c_77' };
  window.profilePayload = p;
  window.renderChecklist(p);
  window.wireDecisionCapture(p);
  const opt = window.document.querySelector('#cp-decision-options .decision-option[data-decision="Approve"]');
  assert.ok(opt.classList.contains('disabled'));
  assert.equal(window.document.getElementById('cp-submit').disabled, true);

  Object.keys(window.checklistState).forEach(k => {
    const cb = window.document.querySelector('.cp-check-item[data-key="' + k + '"]');
    cb.checked = true;
    cb.onchange();
  });
  assert.ok(!opt.classList.contains('disabled'));
});

test('Select All checks every item and unlocks the decision options in one action', () => {
  const { window } = makeWidget();
  const p = { account_vendor: { av_id: 'av_1' }, vendor: { ID: '9001' }, bank: { has_bank_info: true }, broker_contact_id: 'c_77' };
  window.profilePayload = p;
  window.renderChecklist(p);
  window.wireDecisionCapture(p);
  const selectAll = window.document.getElementById('cp-check-all');
  selectAll.checked = true;
  selectAll.onchange();
  assert.ok(Object.keys(window.checklistState).every(k => window.checklistState[k] === true));
  const opt = window.document.querySelector('#cp-decision-options .decision-option[data-decision="Approve"]');
  assert.ok(!opt.classList.contains('disabled'));
});

test('bank-letter checklist item only appears when direct-pay or factor status is Denied/Pending', () => {
  const { window } = makeWidget();
  const direct = { account_vendor: { av_id: 'av_1' }, vendor: { ID: '9001' }, bank: { has_bank_info: false } };
  window.renderChecklist(direct);
  assert.ok(window.document.querySelector('.cp-check-item[data-key="Checklist_Bank_Letter_Verified"]'));

  const cleanFactor = { account_vendor: { av_id: 'av_1' }, vendor: { ID: '9001', Factor_Status: 'Approved' }, bank: { has_bank_info: true } };
  window.renderChecklist(cleanFactor);
  assert.ok(!window.document.querySelector('.cp-check-item[data-key="Checklist_Bank_Letter_Verified"]'));
});

test('submitDecision blocks with a feedback message when the checklist is incomplete', async () => {
  const { window, addCalls } = makeWidget();
  const p = { account_vendor: { av_id: 'av_1' }, vendor: { ID: '9001' }, broker_contact_id: 'c_77',
              system_recommendation: 'Approve', risk_decisions: [] };
  window.profilePayload = p;
  window.renderChecklist(p);   // leaves every item unchecked
  window.selectedDecision = 'Approve';
  await window.submitDecision();
  assert.equal(addCalls.length, 0);
  assert.match(window.document.getElementById('cp-rail-feedback').textContent, /checklist/i);
});

test('buildDecisionPayload includes all checklist booleans, null for the inapplicable bank-letter item', () => {
  const { window } = makeWidget();
  const p = { account_vendor: { av_id: 'av_1' }, vendor: { ID: '9001', Factor_Status: 'Approved' }, bank: { has_bank_info: true },
              system_recommendation: 'Approve', risk_decisions: [] };
  window.profilePayload = p;
  window.renderChecklist(p);
  Object.keys(window.checklistState).forEach(k => { window.checklistState[k] = true; });
  window.selectedDecision = 'Approve';
  const d = window.buildDecisionPayload();
  assert.equal(d.Checklist_COI_Truck_Driver, true);
  assert.equal(d.Checklist_Authority_Active, true);
  assert.equal(d.Checklist_Remittance_Matches, true);
  assert.equal(d.Checklist_Identity_Verified_FMCSA, true);
  assert.equal(d.Checklist_DOT_MC_Match_Pickup, true);
  assert.equal(d.Checklist_OOS_HOS_Reviewed, true);
  assert.equal(d.Checklist_Bank_Letter_Verified, null);
});

// ── UX fix 1: "↻ Refresh all data" button was a dead button (no handler) ──────

test('refresh button is wired to refreshAll after render', () => {
  const { window } = makeWidget();
  window.wireDecisionCapture({ account_vendor: null });   // wiring is independent of relationship
  const btn = window.document.querySelector('.refresh-btn');
  assert.equal(btn.onclick, window.refreshAll);
});

test('loadProfile(true) force-refreshes with refresh=1; loadProfile() does not', () => {
  const { window } = makeWidget();
  const urls = [];
  window.fetch = (u) => { urls.push(u); return new Promise(() => {}); };
  window.brokerEmail = 'broker@op.com';
  window.vendorId = 'v_42';

  window.loadProfile(true);
  assert.match(urls[0], /[?&]refresh=1\b/);

  window.loadProfile();
  assert.ok(!/[?&]refresh=1\b/.test(urls[1]));
});

test('refreshAll disables the button, shows a refreshing label, and force-loads', () => {
  const { window } = makeWidget();
  window.wireDecisionCapture({ account_vendor: null });
  let forced = null;
  window.loadProfile = (f) => { forced = f; return new Promise(() => {}); };
  const btn = window.document.querySelector('.refresh-btn');

  window.refreshAll();

  assert.equal(btn.disabled, true);
  assert.match(btn.textContent, /refresh/i);
  assert.equal(forced, true);
});

test('renderNoaCard shows factoring + pay term and a Manage button with a handler', () => {
  const { window } = makeWidget();
  const carrier = { vendor_id: '1001', factoring_company: 'Triumph', pay_term: 'Factoring Company',
                    doc_on_file: { record_id: 'n1', type: 'NOA Update', has_doc: true }, status: 'verified' };
  window.renderNoaCard(carrier);
  const card = window.document.getElementById('cp-noa-card');
  assert.match(card.textContent, /Triumph/);
  assert.match(card.textContent, /Factoring Company/);
  assert.equal(typeof window.document.getElementById('cp-noa-manage').onclick, 'function');
});

test('CP1 carrier switcher renders results and switching stamps the new vendor', () => {
  const { window } = makeWidget();
  const d = window.document;
  window.cpRenderSwitch([{ vendor_id: '777', carrier_name: 'NEW CARRIER', mc: '123', dot: '456' }]);
  const box = d.getElementById('cp-switch-results');
  assert.equal(box.style.display, '');
  const item = box.querySelector('.cp-switch-item');
  assert.ok(item, 'a result item should render');
  assert.match(item.textContent, /NEW CARRIER/);
  item.click();                                   // -> cpSwitchTo('777')
  assert.equal(window.sessionStorage.getItem('carrierProfileVendorId'), '777');
});
