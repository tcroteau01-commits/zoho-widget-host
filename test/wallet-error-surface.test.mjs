import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../wallet.html', import.meta.url), 'utf8');

// Boot the wallet, force addRecords to reject with a plain object (the shape the
// Creator SDK actually rejects with — no .message), drive the submit, and read
// the status banner. It must surface the real error, never "[object Object]".
function makeWallet(rejectValue) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/wallet.html?email=broker@op.com',
    beforeParse(window) {
      window.scrollTo = () => {};
      window.ZOHO = { CREATOR: {
        UTIL: { getInitParams: () => new Promise(() => {}) },
        DATA: { addRecords: () => Promise.reject(rejectValue) },
      }};
      window.fetch = (url) => {
        if (typeof url === 'string' && url.indexOf('/wallet-reserves') !== -1) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ cash: '5000', escrow: '20000', account_name: 'X' }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      };
    }
  });
  return { window: dom.window };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('a plain-object addRecords rejection surfaces the real error, never "[object Object]"', async () => {
  const { window } = makeWallet({ code: 9007, error: 'No permission to add records' });
  await tick();
  try {
    window.document.getElementById('requestedPayment').value = '100';
    window.document.getElementById('fundingMethod').value = 'ACH - $5 (Next Day)';
    window.document.getElementById('submitBtn').click();
    await tick();
    const banner = window.document.getElementById('statusBanner').textContent;
    assert.ok(!/\[object Object\]/.test(banner), 'banner must not show "[object Object]": ' + banner);
    assert.ok(/9007|No permission to add records/.test(banner), 'banner must include the real Zoho error: ' + banner);
  } finally {
    window.close();
  }
});
