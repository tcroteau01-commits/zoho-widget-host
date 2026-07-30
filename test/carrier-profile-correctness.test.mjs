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

function boot() {
  return bootCarrierProfile();
}

test('_checkRow renders a neutral no-data state (na), not green', () => {
  const w = boot();
  // na must not use the good/✓ styling
  const html = w._checkRow('X', 'no info', 'src', 'na');
  assert.match(html, /check-pill na/);
  assert.doesNotMatch(html, /check-pill good/);
});

test('unverified factor (blank Factor_Status) is NOT shown as Approved/green', () => {
  const w = boot();
  w.renderBankChecklist({ vendor: { Factoring_Company: { ID: 'F1' } }, bank: { has_bank_info: false } });
  const html = w.document.getElementById('cp-bank-checklist').innerHTML;
  assert.match(html, /Not Verified/);
  assert.doesNotMatch(html, /Factor status:\s*<strong>Approved/);
  // the factor row must not be green
  assert.match(html, /Factoring Company Status[\s\S]*?check-pill (warn|na)/);
});

test('a genuinely Approved factor still shows Approved/green', () => {
  const w = boot();
  w.renderBankChecklist({ vendor: { Factoring_Company: { ID: 'F1' }, Factor_Status: 'Approved' }, bank: { has_bank_info: false } });
  assert.match(w.document.getElementById('cp-bank-checklist').innerHTML, /Approved/);
});

test('no bank on file is neutral, not a green OK', () => {
  const w = boot();
  w.renderBankChecklist({ vendor: {}, bank: { has_bank_info: false } });
  const row = w.document.getElementById('cp-bank-checklist').innerHTML;
  // Carrier-Bank State Match with no bank → na, not good
  assert.match(row, /Carrier-Bank State Match[\s\S]*?check-pill na/);
});

test('NOT RATED safety rating is neutral, not green', () => {
  const w = boot();
  w.renderSafetyChecklist({ carrierok: {} });   // no safety_rating_desc
  assert.match(w.document.getElementById('cp-safety-checklist').innerHTML,
    /FMCSA Safety Rating[\s\S]*?check-pill na/);
});
