import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../noa-management.html', import.meta.url), 'utf8');

export function makeWidget() {
  const addCalls = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/noa-management.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: {
        UTIL: { getInitParams: () => new Promise(() => {}) },
        DATA: { addRecords: (a) => { addCalls.push(a); return Promise.resolve({ code: 3000, result: [{ ID: 'rec_1' }] }); } },
      }};
      window.fetch = () => new Promise(() => {});
    }
  });
  return { window: dom.window, addCalls };
}

test('_acquireNoaTarget recovers vendorId from sessionStorage on reload', () => {
  const { window } = makeWidget();
  window.localStorage.clear();
  window.sessionStorage.setItem('noaManagementVendorId', 'v_77');
  const t = window._acquireNoaTarget();
  assert.equal(t.vendorId, 'v_77');
});
