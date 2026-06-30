import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../carrier-profile.html', import.meta.url), 'utf8');

// Mirrors the boot helper in carrier-profile-comments.test.mjs
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

test('authority card shows a chip for dual authority', () => {
  const w = bootCarrierProfile();
  w.renderAuthority({ authority_class: 'dual', carrierok: {} });
  const html = w.document.getElementById('cp-authority').innerHTML;
  assert.match(html, /double-broker/i);
});

test('authority card shows a chip for broker_only authority', () => {
  const w = bootCarrierProfile();
  w.renderAuthority({ authority_class: 'broker_only', carrierok: {} });
  const html = w.document.getElementById('cp-authority').innerHTML;
  assert.match(html, /not a carrier/i);
});

test('authority card shows no chip for a carrier', () => {
  const w = bootCarrierProfile();
  w.renderAuthority({ authority_class: 'carrier', carrierok: {} });
  assert.doesNotMatch(w.document.getElementById('cp-authority').innerHTML, /double-broker|not a carrier/i);
});

test('authority card shows no chip when authority_class is absent', () => {
  const w = bootCarrierProfile();
  w.renderAuthority({ carrierok: {} });
  assert.doesNotMatch(w.document.getElementById('cp-authority').innerHTML, /double-broker|not a carrier/i);
});

test('authority card chip uses cp-auth-warn class for dual', () => {
  const w = bootCarrierProfile();
  w.renderAuthority({ authority_class: 'dual', carrierok: {} });
  const chip = w.document.querySelector('#cp-authority .cp-auth-warn');
  assert.ok(chip, '.cp-auth-warn chip element should exist');
});
