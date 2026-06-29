import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../wallet.html', import.meta.url), 'utf8');

// Boot the wallet via the ?email= override path (no ZOHO needed for data load),
// mock /wallet-reserves so state.cash/state.loaded populate, then drive the real
// submit through the DOM and capture the ZOHO.CREATOR.DATA.addRecords config.
function makeWallet() {
  const addCalls = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/wallet.html?email=broker@op.com',
    beforeParse(window) {
      window.scrollTo = () => {};
      window.ZOHO = { CREATOR: {
        UTIL: { getInitParams: () => new Promise(() => {}) },
        DATA: { addRecords: (a) => { addCalls.push(a); return Promise.resolve({ code: 3000, result: [{ ID: 'rec_1' }] }); } },
      }};
      window.fetch = (url) => {
        if (typeof url === 'string' && url.indexOf('/wallet-reserves') !== -1) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ cash: '5000', escrow: '20000', account_name: 'GOOD MANNERS FREIGHT COMPANY LLC' }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      };
    }
  });
  return { window: dom.window, addCalls };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('reserve-release submit targets the funding-portal app (addRecords includes app_link_name)', async () => {
  const { window, addCalls } = makeWallet();
  await tick(); // let fetchReserves resolve and populate state

  window.document.getElementById('requestedPayment').value = '100';
  window.document.getElementById('fundingMethod').value = 'ACH - $5 (Next Day)';
  window.document.getElementById('submitBtn').click();
  await tick(); // let the addRecords promise settle

  try {
    assert.equal(addCalls.length, 1, 'addRecords should be called exactly once');
    assert.equal(addCalls[0].app_link_name, 'funding-portal', 'addRecords must specify the funding-portal app or Creator rejects the call client-side');
    assert.equal(addCalls[0].form_name, 'Reserve_Request');
    const d = addCalls[0].payload.data;
    assert.equal(d.Requested_Payment, 100);
    assert.equal(d.Funding_Method, 'ACH - $5 (Next Day)');
  } finally {
    window.close(); // clear the wallet's setInterval cutoff clock so the runner exits
  }
});
