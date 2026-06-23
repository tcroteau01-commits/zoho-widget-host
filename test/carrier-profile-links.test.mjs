import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('carrier-profile.html'), 'utf8');
function boot() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  return dom.window;
}

test('mapsHref builds an encoded Google Maps deep-link, "" when empty', () => {
  const w = boot();
  assert.match(w.mapsHref('123 Main St, Phoenix, AZ 85001'), /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  assert.ok(w.mapsHref('123 Main St, Phoenix, AZ').includes(encodeURIComponent('123 Main St, Phoenix, AZ')));
  assert.strictEqual(w.mapsHref(''), '');
  assert.strictEqual(w.mapsHref('   '), '');
});

test('saferHref deep-links by DOT, "" when no DOT', () => {
  const w = boot();
  const u = w.saferHref('3455916');
  assert.match(u, /safer\.fmcsa\.dot\.gov\/query\.asp/);
  assert.ok(u.includes('query_string=3455916'));
  assert.strictEqual(w.saferHref(''), '');
});
