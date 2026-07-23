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
