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

test('buildDecisionPayload captures the current risk computation as Risk_Snapshot1', () => {
  const { window } = makeWidget();
  window.profilePayload = {
    account_vendor: { av_id: 'av_1' },
    system_recommendation: 'Approve',
    risk_decisions: [],
    risk: { tier: 'Medium', flags: [{ id: 'quick_pay', category: 'Payment and Internal', severity: 'Medium', label: 'Quick Pay Payment Terms' }] },
  };
  window.checklistState = { Checklist_COI_Truck_Driver: true };
  window.selectedDecision = 'Approve with Caution';

  const payload = window.buildDecisionPayload();

  assert.equal(typeof payload.Risk_Snapshot1, 'string');
  const parsed = JSON.parse(payload.Risk_Snapshot1);
  assert.equal(parsed.tier, 'Medium');
  assert.equal(parsed.flags[0].id, 'quick_pay');
});

test('buildDecisionPayload does not throw when risk is missing from profilePayload', () => {
  const { window } = makeWidget();
  window.profilePayload = {
    account_vendor: { av_id: 'av_1' },
    system_recommendation: 'Approve',
    risk_decisions: [],
  };
  window.checklistState = {};
  window.selectedDecision = 'Approve';

  const payload = window.buildDecisionPayload();

  assert.equal(payload.Risk_Snapshot1, '{}');
});

test('buildDecisionPayload picks the 180-day Trigger_Type when Re_Review_Reason says so', () => {
  const { window } = makeWidget();
  window.profilePayload = {
    account_vendor: { av_id: 'av_1', Re_Review_Reason: '180 days since last review' },
    system_recommendation: 'Approve', risk_decisions: [{ ID: '1' }],
    risk: { tier: 'Low', flags: [] },
  };
  window.checklistState = {};
  window.selectedDecision = 'Approve';
  const payload = window.buildDecisionPayload();
  assert.equal(payload.Trigger_Type, 'Re-review: 180-Day Freshness Check');
});

test('buildDecisionPayload keeps the standard re-review Trigger_Type when Re_Review_Reason is absent/non-180-day', () => {
  const { window } = makeWidget();
  window.profilePayload = {
    account_vendor: { av_id: 'av_1' },
    system_recommendation: 'Approve', risk_decisions: [{ ID: '1' }],
    risk: { tier: 'Low', flags: [] },
  };
  window.checklistState = {};
  window.selectedDecision = 'Approve';
  const payload = window.buildDecisionPayload();
  assert.equal(payload.Trigger_Type, 'Re-review: Authority, Ins, Safety, Crash, OOS, Fraud');
});

test('submitDecision leaves the button disabled after a successful save (fresh checklist required for the next decision)', async () => {
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

  await window.submitDecision();

  const sb = window.document.getElementById('cp-submit');
  assert.equal(sb.disabled, true,
    'the reload resets the checklist, so the button must stay disabled until it is completed again for a new decision');
});
