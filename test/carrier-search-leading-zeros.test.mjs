// LEADZERO1: brokers paste MC/DOT numbers with leading zeros (FMCSA displays
// them padded, e.g. 04556426). Every broker-facing carrier search must find the
// carrier whether or not the zeros are typed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

function boot(file) {
  const html = fs.readFileSync(path.resolve(file), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  dom.window.fetch = async () => ({ ok: true, json: async () => ({}) });
  return dom.window;
}

const CARRIER = { vendor_id: '1', carrier_name: 'Acme Trucking', mc: '123456', dot: '4556426' };

test('carrier-profile switch: padded DOT and MC find the carrier', () => {
  const w = boot('carrier-profile.html');
  w._cpCarriers = [CARRIER];
  assert.equal(w.cpFilterCarriers('04556426').length, 1);
  assert.equal(w.cpFilterCarriers('000123456').length, 1);
  assert.equal(w.cpFilterCarriers('4556426').length, 1);
});

test('load page carrier combobox: padded DOT matches', () => {
  const w = boot('index.html');
  assert.equal(w._carrierMatch(CARRIER, '04556426'), true);
  assert.equal(w._carrierMatch(CARRIER, '0123456'), true);
});

test('NOA carrier picker: padded DOT matches', () => {
  const w = boot('noa-management.html');
  assert.equal(w._noaCarrierMatch(CARRIER, '04556426'), true);
});

test('a lone zero or a name containing digits is not mangled', () => {
  const w = boot('carrier-profile.html');
  const zeroName = { vendor_id: '2', carrier_name: '007 Freight', mc: '', dot: '' };
  w._cpCarriers = [CARRIER, zeroName];
  // A query with letters is left alone, so "007 f" still finds the name.
  assert.equal(w.cpFilterCarriers('007 f').length, 1);
  // All zeros collapses to "0", not the empty string (which would match everything).
  assert.equal(w.cpFilterCarriers('000').length, 1);
});

// The vendors widget is an IIFE, so drive it through the DOM: boot with a
// stubbed SDK and /broker-report, then type into the search box.
test('vendors list: padded DOT search finds the vendor', async () => {
  const html = fs.readFileSync(path.resolve('view-vendors.html'), 'utf8');
  const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true }).window;
  w.ZOHO = { CREATOR: { UTIL: { getInitParams: () => ({ loginUser: 'broker@test.com' }) }, init: () => Promise.resolve() } };
  w.OperFiAV = { carrierBadge: () => {}, customerCredit: () => {} };
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ records: [
    { ID: 'V1', Vendor_Name: 'Acme Trucking', Vendor_Status: 'Approved', MC: '123456', USDOT: '4556426' },
    { ID: 'V2', Vendor_Name: 'Other Freight', Vendor_Status: 'Approved', MC: '999999', USDOT: '8888888' },
  ] }) });
  w.dispatchEvent(new w.Event('load'));
  const deadline = Date.now() + 500;
  while (!w.document.querySelector('.row') && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));

  const input = w.document.getElementById('search-input');
  input.value = '04556426';
  input.dispatchEvent(new w.Event('input'));
  const rows = w.document.querySelectorAll('.row');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /Acme Trucking/);
});
