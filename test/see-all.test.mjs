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
