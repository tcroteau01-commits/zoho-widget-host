import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../carrier-profile.html', import.meta.url), 'utf8');

// Build a jsdom window with the widget's script executed, ZOHO.CREATOR.DATA.addRecords
// stubbed to succeed, and fetch stubbed to record every URL requested and resolve with
// a minimal valid /carrier-profile payload. Returns { window, addCalls, fetchUrls }.
function makeWidget() {
  const addCalls = [];
  const fetchUrls = [];
  const profileResponse = {
    vendor: { ID: '9001' }, carrierok: {}, ipqs: {}, bank: {},
    account_vendor: { av_id: 'av_1' }, broker_contact_id: 'c_77',
    risk_decisions: [], comments: [], system_recommendation: 'Approve',
  };
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/carrier-profile.html',
    beforeParse(window) {
      window.ZOHO = {
        CREATOR: {
          UTIL: { getInitParams: () => new Promise(() => {}) },
          DATA: {
            getRecords: () => Promise.resolve({ data: [] }),
            addRecords: (args) => { addCalls.push(args); return Promise.resolve({ code: 3000, result: [{}] }); },
          },
        },
      };
      window.fetch = (url) => {
        fetchUrls.push(String(url));
        return Promise.resolve({ ok: true, json: () => Promise.resolve(profileResponse) });
      };
    },
  });
  return { window: dom.window, addCalls, fetchUrls };
}

test('submitDecision force-refreshes the profile (busts the backend cache) after a successful save', async () => {
  const { window, fetchUrls } = makeWidget();
  window.brokerEmail = 'broker@op.com';
  window.vendorId = '9001';
  window.profilePayload = {
    account_vendor: { av_id: 'av_1' }, broker_contact_id: 'c_77',
    system_recommendation: 'Approve', risk_decisions: [],
  };
  window.checklistState = {
    Checklist_COI_Truck_Driver: true, Checklist_Authority_Active: true,
    Checklist_Remittance_Matches: true, Checklist_Identity_Verified_FMCSA: true,
    Checklist_DOT_MC_Match_Pickup: true, Checklist_OOS_HOS_Reviewed: true,
  };
  window.selectedDecision = 'Approve';
  window.document.getElementById('cp-notes').value = 'looks fine';

  await window.submitDecision();

  const profileCalls = fetchUrls.filter((u) => u.indexOf('/carrier-profile') !== -1);
  assert.ok(profileCalls.length >= 1, 'expected at least one /carrier-profile refetch after save');
  assert.match(profileCalls[profileCalls.length - 1], /refresh=1/,
    'the post-save refetch must pass refresh=1 to bust the backend cache, or the widget shows stale pre-decision data');
});

test('submitDecision clears the decision notes textarea after a successful save', async () => {
  const { window } = makeWidget();
  window.brokerEmail = 'broker@op.com';
  window.vendorId = '9001';
  window.profilePayload = {
    account_vendor: { av_id: 'av_1' }, broker_contact_id: 'c_77',
    system_recommendation: 'Approve', risk_decisions: [],
  };
  window.checklistState = {
    Checklist_COI_Truck_Driver: true, Checklist_Authority_Active: true,
    Checklist_Remittance_Matches: true, Checklist_Identity_Verified_FMCSA: true,
    Checklist_DOT_MC_Match_Pickup: true, Checklist_OOS_HOS_Reviewed: true,
  };
  window.selectedDecision = 'Approve';
  window.document.getElementById('cp-notes').value = 'looks fine';

  await window.submitDecision();

  assert.equal(window.document.getElementById('cp-notes').value, '');
});

test('submitDecision restores the button label after the post-save reload completes', async () => {
  const { window } = makeWidget();
  window.brokerEmail = 'broker@op.com';
  window.vendorId = '9001';
  window.profilePayload = {
    account_vendor: { av_id: 'av_1' }, broker_contact_id: 'c_77',
    system_recommendation: 'Approve', risk_decisions: [],
  };
  window.checklistState = {
    Checklist_COI_Truck_Driver: true, Checklist_Authority_Active: true,
    Checklist_Remittance_Matches: true, Checklist_Identity_Verified_FMCSA: true,
    Checklist_DOT_MC_Match_Pickup: true, Checklist_OOS_HOS_Reviewed: true,
  };
  window.selectedDecision = 'Approve';

  const sb = window.document.getElementById('cp-submit');
  const savingPromise = window.submitDecision();
  assert.equal(sb.textContent, 'Saving…');
  await savingPromise;
  assert.equal(sb.textContent, 'Save Decision & Update Hiring Status');
});
