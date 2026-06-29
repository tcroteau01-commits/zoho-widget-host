import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

function boot() {
  const html = fs.readFileSync(new URL('../customer-approvals.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x.github.io/' });
  return dom.window;
}

test('creditAppEmailWarning flags free-mail and domain mismatch, clears on match', () => {
  const w = boot();
  assert.match(w.creditAppEmailWarning('ap@gmail.com', 'https://acme.com'), /personal|free/i);
  assert.match(w.creditAppEmailWarning('ap@notacme.com', 'https://acme.com'), /match/i);
  assert.equal(w.creditAppEmailWarning('ap@acme.com', 'https://acme.com'), '');
  assert.equal(w.creditAppEmailWarning('ap@acme.com', ''), '');
});

test('sendCreditApp POSTs submission_id + email + customer_email and reports ok', async () => {
  const w = boot();
  w.brokerEmail = 'broker@op.com';
  const calls = [];
  w.fetch = (u, o) => { calls.push({ u, body: JSON.parse(o.body) }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, sent_to: 'ap@acme.com' }) }); };
  const res = await w.sendCreditApp({ ID: 'sub_9' }, 'ap@acme.com');
  assert.ok(calls[0].u.includes('/credit-send-app'));
  assert.equal(calls[0].body.submission_id, 'sub_9');
  assert.equal(calls[0].body.email, 'broker@op.com');
  assert.equal(calls[0].body.customer_email, 'ap@acme.com');
  assert.equal(res.ok, true);
});

test('actionCell renders a Send Credit Application button for eligible statuses only', () => {
  const w = boot();
  const html = w.rowHtml({ ID: 's1', Customer_Company_Name: 'ACME', Email: 'ap@acme.com',
                           Credit_Decision: 'Pending Credit Application' }, 0);
  assert.match(html, /data-action="send-credit-app"/);
  const html2 = w.rowHtml({ ID: 's2', Customer_Company_Name: 'ACME', Email: 'ap@acme.com',
                            Credit_Decision: "Credit App Rec'd - Pending Review" }, 1);
  assert.doesNotMatch(html2, /data-action="send-credit-app"/);
});
