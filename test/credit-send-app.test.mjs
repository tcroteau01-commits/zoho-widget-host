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
