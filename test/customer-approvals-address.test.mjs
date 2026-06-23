import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');

test('addressFieldHtml wraps the shipper address in a Maps link; plain when empty', () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  const linked = w.addressFieldHtml('1 Industrial Rd, Dallas, TX 75201');
  assert.match(linked, /class="field-label">Address</);
  assert.match(linked, /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=/);
  assert.match(linked, /target="_blank"/);
  assert.ok(!/href=/.test(w.addressFieldHtml('')));
});
