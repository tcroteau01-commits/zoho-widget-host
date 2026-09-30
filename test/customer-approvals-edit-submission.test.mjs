// CCEDIT1: Customer Approvals offers "Edit submission" on a check still
// Awaiting Credit Decision, and nowhere else (Tom, 2026-09-29: "Awaiting only").
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function boot() {
  const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
                              url: 'https://x.github.io/' }).window;
  await wait(50);
  w.brokerEmail = 'b@x.com';
  w.fetch = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  return w;
}
const rec = (id, name, decision) => ({ ID: id, Customer_Company_Name: name, Credit_Decision: decision });

test('only an Awaiting Credit Decision row offers Edit submission', async () => {
  const w = await boot();
  w.onRecordsLoaded([
    rec('1', 'Awaiting Co', 'Awaiting Credit Decision'),
    rec('2', 'Approved Co', 'Approved'),
    rec('3', 'Pending App Co', 'Pending Credit Application'),
    rec('4', 'Sent Co', 'Credit App Sent - Awaiting Customer')
  ]);
  await wait(20);
  const edits = [...w.document.querySelectorAll('[data-action="edit"]')];
  assert.deepStrictEqual(edits.map(b => b.getAttribute('data-recid')), ['1']);
});

test('Edit submission hands the record over in edit mode', async () => {
  const w = await boot();
  w.onRecordsLoaded([rec('1', 'Awaiting Co', 'Awaiting Credit Decision')]);
  await wait(20);
  w.document.querySelector('[data-action="edit"]').click();
  assert.strictEqual(w.sessionStorage.getItem('operfi.resumeSubmission'), '1');
  assert.strictEqual(w.sessionStorage.getItem('operfi.resumeMode'), 'edit');
  // and Add Documents afterwards must not inherit it
  w.document.querySelector('[data-action="resume"]').click();
  assert.strictEqual(w.sessionStorage.getItem('operfi.resumeMode'), null);
});

test('an edit shows up in Needs Attention with its own label', () => {
  assert.ok(/customer_details_changed: \{ one: 'edit', many: 'edits' \}/.test(html));
});
