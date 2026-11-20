// CUSTLINK1 (Tom, 2026-11-20): "make each customer page have a unique URL so
// when a new credit check comes in on slack the link actually takes us to the
// broker its checking instead of the Customer Approval screen."
//
// The shell frames this page as ...customer-approvals.html?customer=<id> when the
// top URL is #Page:Customer_Approvals?customer=<id>. These tests boot the page
// with that query string and drive the real load path.
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');

const RECORDS = [
  { ID: '111', Customer_Company_Name: 'Alpha Co', Credit_Decision: 'Approved' },
  { ID: '222', Customer_Company_Name: 'Winandy Greenhouse', Credit_Decision: 'Awaiting Credit Decision' }
];

function boot(query) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://brokers.operfi.com/portal/w/customer-approvals.html' + query + '#Page:Customer_Approvals'
  });
  const w = dom.window;
  w.dispatchEvent(new w.Event('load'));
  const fetched = [];
  w.fetch = function(url) { fetched.push(String(url)); return new Promise(function() {}); };
  w.OperFiCustomerProfile = { render: function() { return ''; } };
  return { w, fetched };
}

function profileShown(w) {
  return w.document.getElementById('ca-profile').style.display !== 'none';
}

test('staff: the linked customer opens straight into its full profile', () => {
  const { w, fetched } = boot('?customer=222');
  w.allClients = true;
  w.onRecordsLoaded(RECORDS);
  assert.ok(profileShown(w), 'profile view is showing');
  assert.ok(fetched.some(function(u) { return /\/customer-profile\/222$/.test(u); }),
            'fetched the linked customer, not another one');
  assert.strictEqual(w.location.hash, '#Page:Customer_Approvals?customer=222');
});

test('the link opens once: the reload after a decision does not reopen it', () => {
  const { w } = boot('?customer=222');
  w.allClients = true;
  w.onRecordsLoaded(RECORDS);
  w.document.getElementById('ca-profile').style.display = 'none';
  w.document.querySelector('.widget').style.display = '';
  w.onRecordsLoaded(RECORDS);
  assert.ok(!profileShown(w));
});

test('a customer not in this list leaves the list showing and the URL on the list', () => {
  const { w } = boot('?customer=999');
  w.allClients = true;
  w.onRecordsLoaded(RECORDS);
  assert.ok(!profileShown(w));
  assert.strictEqual(w.location.hash, '#Page:Customer_Approvals');
});

test('no customer param: the list loads as it always has', () => {
  const { w, fetched } = boot('');
  w.allClients = true;
  w.onRecordsLoaded(RECORDS);
  assert.ok(!profileShown(w));
  assert.ok(!fetched.some(function(u) { return /customer-profile/.test(u); }));
});

test('opening and closing any profile keeps the address bar on that customer', () => {
  const { w } = boot('');
  w.allClients = true;
  w.onRecordsLoaded(RECORDS);
  w.openProfile(RECORDS[0]);
  assert.strictEqual(w.location.hash, '#Page:Customer_Approvals?customer=111');
  w.closeProfile();
  assert.strictEqual(w.location.hash, '#Page:Customer_Approvals');
});

test('a broker (no full profile) gets the same customer in the drawer', () => {
  const { w, fetched } = boot('?customer=222');
  w.allClients = false;
  w.onRecordsLoaded(RECORDS);
  assert.ok(!profileShown(w));
  assert.ok(!fetched.some(function(u) { return /customer-profile/.test(u); }));
  assert.ok(w.document.getElementById('panel').classList.contains('show'), 'drawer is open');
});
