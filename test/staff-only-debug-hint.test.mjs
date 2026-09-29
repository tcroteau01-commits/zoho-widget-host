// Tom, 2026-09-29: during the Creator token outage every broker saw "Could not
// load customer approvals. Open DevTools console (F12) for the error." The F12
// pointer is for OperFi staff; a client gets a support line instead.
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const impJs = fs.readFileSync(path.resolve('operfi-impersonate.js'), 'utf8');
const approvals = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');
const WIDGETS = ['aging.html', 'company-profile.html', 'credit-dashboard.html',
                 'customer-approvals.html', 'history.html', 'view-vendors.html', 'wallet.html'];
function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// Boot the impersonation script with a stubbed Creator login + /whoami answer.
async function bootImp(isAdmin) {
  const w = new JSDOM('<!doctype html><body></body>',
                      { runScripts: 'outside-only', url: 'https://x.github.io/' }).window;
  w.ZOHO = { CREATOR: { UTIL: { getInitParams: () => Promise.resolve({ loginUser: 'u@x.com' }) } } };
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({ is_admin: isAdmin, clients: [] }) });
  w.eval(impJs);
  await wait(20);
  return w;
}

test('hint: staff get the DevTools text, clients get the support line', async () => {
  const staff = await bootImp(true);
  assert.strictEqual(staff.OPERFI_IMP.isStaff(), true);
  assert.match(staff.OPERFI_IMP.hint('Open DevTools console (F12).'), /F12/);

  const client = await bootImp(false);
  assert.strictEqual(client.OPERFI_IMP.isStaff(), false);
  assert.doesNotMatch(client.OPERFI_IMP.hint('Open DevTools console (F12).'), /DevTools|F12/);
  assert.match(client.OPERFI_IMP.hint('x'), /contact OperFi support/);
});

// Boot the widget as a logged-in broker whose /broker-report 502s (the outage).
async function failedApprovalsText(imp) {
  const w = new JSDOM(approvals, { runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://x.github.io/',
    beforeParse(win) {
      win.ZOHO = { CREATOR: { init: () => Promise.resolve(),
        UTIL: { getInitParams: () => Promise.resolve({ loginUser: 'broker@test.com' }) } } };
      if (imp) win.OPERFI_IMP = imp;
      win.fetch = () => Promise.resolve({ ok: false, status: 502,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('{"error":"Upstream error"}') });
    } }).window;
  for (let i = 0; i < 50; i++) {
    const t = w.document.getElementById('results').textContent;
    if (/Could not load customer approvals/.test(t)) return t;
    await wait(10);
  }
  return w.document.getElementById('results').textContent;
}

test('Customer Approvals load failure: client sees the support line, not F12', async () => {
  const txt = await failedApprovalsText({ hint: () => 'If this keeps happening, contact OperFi support.' });
  assert.match(txt, /Could not load customer approvals/);
  assert.match(txt, /contact OperFi support/);
  assert.doesNotMatch(txt, /DevTools|F12/);
});

test('Customer Approvals load failure: no impersonation script means client text', async () => {
  const txt = await failedApprovalsText(null);
  assert.doesNotMatch(txt, /DevTools|F12/);
  assert.match(txt, /contact OperFi support/);
});

test('Customer Approvals load failure: staff still see the F12 pointer', async () => {
  const txt = await failedApprovalsText({ hint: (t) => t });
  assert.match(txt, /F12/);
});

test('no client widget hard-codes a DevTools/F12 hint outside debugHint()', () => {
  for (const f of WIDGETS) {
    const lines = fs.readFileSync(path.resolve(f), 'utf8').split('\n');
    lines.forEach(function(line, i) {
      if (!/\(F12\)/.test(line)) return;
      if (/^\s*\/\//.test(line)) return;               // comment
      assert.match(line, /debugHint\('[^']*\(F12\)/, f + ':' + (i + 1) + ' shows F12 to clients');
    });
  }
});
