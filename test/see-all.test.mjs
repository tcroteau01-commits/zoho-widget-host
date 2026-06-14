import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

function load(file){
  const html = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  return dom.window;
}

test('history brokerName reads Contact.Account_Name (the report\'s broker field)', () => {
  const w = load('history.html');
  assert.equal(typeof w.brokerName, 'function');
  // real shape from All_Funding_Portals: dotted traversal lookup object
  assert.equal(w.brokerName({ 'Contact.Account_Name': { zc_display_value: 'NXTDAY LOGISTICS LLC', Account_Name: 'NXTDAY LOGISTICS LLC' } }), 'NXTDAY LOGISTICS LLC');
  assert.equal(w.brokerName({ Account_Name: 'Marek LLC' }), 'Marek LLC');   // direct fallback
  assert.equal(w.brokerName({}), '');
});

test('customer-approvals brokerName reads Contact.Account_Name, not the debtor', () => {
  const w = load('customer-approvals.html');
  assert.equal(typeof w.brokerName, 'function');
  // real shape from All_Customer_Submissions: broker is Contact.Account_Name, debtor is Customer_Company_Name
  assert.equal(
    w.brokerName({ 'Contact.Account_Name': { zc_display_value: 'VETERANS TRANSPORT BROKERAGE LLC' }, Customer_Company_Name: 'ATKORE' }),
    'VETERANS TRANSPORT BROKERAGE LLC'
  );
});

test('customer-approvals urlVal extracts the URL from a Creator url-field object', () => {
  const w = load('customer-approvals.html');
  assert.equal(typeof w.urlVal, 'function');
  assert.equal(w.urlVal({ value: 'globaltoolandtechnology.com', url: 'https://globaltoolandtechnology.com' }), 'https://globaltoolandtechnology.com');
  assert.equal(w.urlVal({ value: 'acme.com' }), 'acme.com');
  assert.equal(w.urlVal('plain.com'), 'plain.com');
  assert.equal(w.urlVal(null), '');
  assert.notEqual(w.urlVal({ value: 'x.com' }), '[object Object]');
});

test('customer-approvals renderFraudCheck shows risk badge + reasons (CC2)', () => {
  const w = load('customer-approvals.html');
  assert.equal(typeof w.renderFraudCheck, 'function');
  const d = w.document;
  const sec = d.createElement('div'); sec.id = 'ca-fraud'; sec.style.display = 'none';
  const badge = d.createElement('span'); badge.id = 'ca-fraud-badge';
  const body = d.createElement('div'); body.id = 'ca-fraud-body';
  sec.appendChild(badge); sec.appendChild(body); d.body.appendChild(sec);

  w.renderFraudCheck({
    risk: 'high',
    reasons: ["Email domain (lilly.usatransport.com) doesn't match the website (lilly.com)"],
    email_domain: 'lilly.usatransport.com', website_domain: 'lilly.com', domain_mismatch: true,
  });
  assert.equal(sec.style.display, '');                 // revealed
  assert.match(badge.textContent, /High risk/);
  assert.match(badge.className, /\bhigh\b/);
  assert.match(body.innerHTML, /doesn.t match/);
});
