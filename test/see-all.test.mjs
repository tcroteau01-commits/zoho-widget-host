import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

function load(file){
  const html = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  return dom.window;
}

test('history exposes a broker-name helper that flattens Account_Name', () => {
  const w = load('history.html');
  assert.equal(typeof w.brokerName, 'function');
  assert.equal(w.brokerName({ Account_Name: 'Marek LLC' }), 'Marek LLC');
  assert.equal(w.brokerName({ Account_Name: { display_value: 'Marek LLC' } }), 'Marek LLC');
  assert.equal(w.brokerName({}), '');
});

test('customer-approvals exposes the same broker-name helper', () => {
  const w = load('customer-approvals.html');
  assert.equal(typeof w.brokerName, 'function');
  assert.equal(w.brokerName({ Account_Name: { zc_display_value: 'Loyal Brokerage LLC' } }), 'Loyal Brokerage LLC');
});
