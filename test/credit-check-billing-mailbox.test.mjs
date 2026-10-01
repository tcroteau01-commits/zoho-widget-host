// BILLERR1 (Tom, 2026-10-01): the same mailbox for contact and billing must say
// so, not "Billing email format is invalid" about a valid address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../credit-check.html', import.meta.url), 'utf8');

async function boot() {
  const posts = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', url: 'https://tcroteau01-commits.github.io/credit-check.html',
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => Promise.resolve({ loginUser: 'broker@op.com' }) } } };
      window.fetch = (url, opts) => {
        if (opts && opts.body) posts.push(url);
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ drafts: [] }) });
      };
    }
  });
  await new Promise(r => setTimeout(r, 20));
  const d = dom.window.document;
  const set = (id, v) => { d.getElementById(id).value = v; };
  d.getElementById('ctype-shipper').click();
  set('Customer_Company_Name', 'UNIFIED GROCERS'); set('address_line_1', '1 Main St');
  set('district_city', 'Los Angeles'); set('state_province', 'CA'); set('postal_Code', '90001');
  set('Phone_Number', '323-206-3426'); set('Company_Website', 'unifiedgrocer.com');
  set('Customer_Point_of_Contact', 'Tom Nasman'); set('Phone_Number1', '323-206-3426');
  set('Email', 'info@unifiedgrocer.com');
  set('Billing_Point_of_Contact', 'Tom Nasman'); set('Billing_AP_Contact_Number', '323-206-3426');
  return { d, posts, set };
}
const errText = (d) => d.querySelector('[data-err-for="Billing_Email"]').textContent;

test('the same mailbox on both sides says that, and nothing is sent', async () => {
  const { d, posts, set } = await boot();
  set('Billing_Email', 'INFO@unifiedgrocer.com ');
  d.getElementById('submitBtn').click();
  await new Promise(r => setTimeout(r, 0));
  assert.match(errText(d), /Billing needs its own email/);
  assert.doesNotMatch(errText(d), /format is invalid/);
  assert.equal(posts.length, 0);
});

test('a badly formed billing email still says format is invalid', async () => {
  const { d, set } = await boot();
  set('Billing_Email', 'info@unifiedgrocer.com');
  d.getElementById('submitBtn').click();                  // same mailbox first
  set('Billing_Email', 'ap@nowhere');
  d.getElementById('submitBtn').click();                  // then a real format error
  await new Promise(r => setTimeout(r, 0));
  assert.equal(errText(d), 'Billing email format is invalid.');
});
