import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../carrier-profile.html', import.meta.url), 'utf8');

// Mirrors the boot helper in carrier-profile-authority.test.mjs
function bootCarrierProfile() {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/carrier-profile.html',
    beforeParse(window) {
      window.ZOHO = {
        CREATOR: {
          UTIL: { getInitParams: () => new Promise(() => {}) },
          DATA: {
            getRecords: () => Promise.resolve({ data: [] }),
            addRecords: () => Promise.resolve({ code: 3000, result: [{}] })
          }
        }
      };
      window.fetch = () => new Promise(() => {});
    }
  });
  return dom.window;
}

function verdictPayload(overrides = {}) {
  return Object.assign({
    overall: 'REVIEW', fail_count: 1, review_count: 2,
    pillars: {
      authority: { verdict: 'REVIEW', fail_count: 0, review_count: 1 },
      insurance: { verdict: 'PASS', fail_count: 0, review_count: 0 },
      safety: { verdict: 'FAIL', fail_count: 1, review_count: 0 },
      crash: { verdict: 'PASS', fail_count: 0, review_count: 0 },
      identity: { verdict: 'REVIEW', fail_count: 0, review_count: 1 }
    },
    facts: [
      { id: 'basic_alerts_hard_stop', pillar: 'safety', verdict: 'FAIL',
        label: '2+ CSA BASIC alerts', detail: 'Two or more BASIC categories in alert.',
        data_point: '2 of 5' },
      { id: 'prior_revocation', pillar: 'authority', verdict: 'REVIEW',
        label: 'Prior authority revocation', detail: '1 revocation on record.',
        data_point: 'total_revocations = 1' },
      { id: 'vpn_voip_footprint', pillar: 'identity', verdict: 'REVIEW',
        label: 'VPN and VOIP together at signup', detail: 'Combined masking pattern.',
        data_point: 'both true', tone: 'red' }
    ]
  }, overrides);
}

test('applyVerdict sets PASS/REVIEW/FAIL text on the section pills', () => {
  const w = bootCarrierProfile();
  w.applyVerdict({ verdict: verdictPayload() });
  assert.equal(w.document.getElementById('cp-acc-safety-pill').textContent, 'FAIL');
  assert.ok(w.document.getElementById('cp-acc-safety-pill').className.includes('flag'));
  assert.equal(w.document.getElementById('cp-acc-authority-pill').textContent, 'REVIEW');
  assert.ok(w.document.getElementById('cp-acc-authority-pill').className.includes('caution'));
  assert.equal(w.document.getElementById('cp-acc-insurance-pill').textContent, 'PASS');
  assert.equal(w.document.getElementById('cp-acc-footprint-pill').textContent, 'REVIEW');
});

test('applyVerdict renders fact rows inside the owning section', () => {
  const w = bootCarrierProfile();
  w.applyVerdict({ verdict: verdictPayload() });
  const safety = w.document.getElementById('cp-vfacts-safety').innerHTML;
  assert.match(safety, /2\+ CSA BASIC alerts/);
  assert.match(safety, /vfact fail/);
  const auth = w.document.getElementById('cp-vfacts-authority').innerHTML;
  assert.match(auth, /Prior authority revocation/);
  assert.match(auth, /vfact review/);
});

test('red-tone REVIEW fact gets the red styling class', () => {
  const w = bootCarrierProfile();
  w.applyVerdict({ verdict: verdictPayload() });
  assert.match(w.document.getElementById('cp-vfacts-identity').innerHTML,
    /vfact review red/);
});

test('applyVerdict without a verdict payload is a no-op (legacy pills stand)', () => {
  const w = bootCarrierProfile();
  const before = w.document.getElementById('cp-acc-safety-pill').textContent;
  w.applyVerdict({});
  assert.equal(w.document.getElementById('cp-acc-safety-pill').textContent, before);
  assert.equal(w.document.getElementById('cp-vfacts-safety').innerHTML, '');
});

test('fact labels are HTML-escaped', () => {
  const w = bootCarrierProfile();
  const v = verdictPayload();
  v.facts[0].label = '<img src=x onerror=alert(1)>';
  w.applyVerdict({ verdict: v });
  assert.doesNotMatch(w.document.getElementById('cp-vfacts-safety').innerHTML, /<img/);
});

test('rail roll-up phrases a fact count, FAILs first in detail', () => {
  const w = bootCarrierProfile();
  w.renderRecommendation({ verdict: verdictPayload() });
  const badge = w.document.getElementById('cp-rail-signal');
  assert.match(badge.textContent, /1 does not meet the standard/);
  assert.match(badge.textContent, /2 to review/);
  assert.ok(badge.className.includes('serious')); // fail present → red styling
  const detail = w.document.getElementById('cp-rail-signal-detail').innerHTML;
  assert.match(detail, /2\+ CSA BASIC alerts/);
  // documented network-graph limit (spec §1: document, don't hide)
  assert.match(detail, /chameleon|cross-carrier/i);
});

test('rail roll-up review-only and all-clear phrasings', () => {
  const w = bootCarrierProfile();
  w.renderRecommendation({ verdict: verdictPayload({
    fail_count: 0, review_count: 3 }) });
  const badge = w.document.getElementById('cp-rail-signal');
  assert.match(badge.textContent, /3 to review/);
  assert.doesNotMatch(badge.textContent, /does not meet/);
  assert.ok(badge.className.includes('elevated'));
  w.renderRecommendation({ verdict: verdictPayload({
    fail_count: 0, review_count: 0, facts: [] }) });
  assert.match(w.document.getElementById('cp-rail-signal').textContent,
    /No exceptions found/i);
});

test('rail falls back to legacy tier signal without a verdict payload', () => {
  const w = bootCarrierProfile();
  w.renderRecommendation({ risk: { tier: 'High', flags: [] } });
  assert.match(w.document.getElementById('cp-rail-signal').textContent, /Elevated signal/);
});

test('safety KPI reads fmcsa safety_rating_desc', () => {
  const w = bootCarrierProfile();
  w.renderRiskStrip({ risk: { tier: 'Low' },
    carrierok: { safety_rating_desc: 'Satisfactory', safety_rating_date: '2021-12-17' } });
  const kpi = w.document.querySelectorAll('#cp-kpi-row .kpi')[0];
  assert.equal(kpi.querySelector('.kpi-value').textContent, 'SATISFACTORY');
});

test('KPI 2 shows BASIC alert count, not CarrierOK risk score', () => {
  const w = bootCarrierProfile();
  const label = w.document.querySelectorAll('#cp-kpi-row .kpi-label')[1];
  assert.match(label.textContent, /BASIC Alerts/i);
  w.renderRiskStrip({ risk: { tier: 'Low' }, carrierok: {
    basic_alert_unsafe_driving: true, basic_alert_hours_of_service: true } });
  const kpi = w.document.querySelectorAll('#cp-kpi-row .kpi')[1];
  assert.equal(kpi.querySelector('.kpi-value').textContent, '2');
  assert.ok(kpi.className.includes('bad')); // 2+ = hard-stop styling
  w.renderRiskStrip({ risk: { tier: 'Low' }, carrierok: {} });
  assert.equal(w.document.querySelectorAll('#cp-kpi-row .kpi')[1]
    .querySelector('.kpi-value').textContent, '0');
});

test('safety checklist reads safety_rating_desc', () => {
  const w = bootCarrierProfile();
  w.renderSafetyChecklist({ carrierok: { safety_rating_desc: 'Conditional' } });
  assert.match(w.document.getElementById('cp-safety-checklist').innerHTML, /Conditional/);
});
