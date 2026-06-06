import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
const js = fs.readFileSync(new URL('../operfi-impersonate.js', import.meta.url), 'utf8');

function boot(){
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://x.github.io/' });
  const w = dom.window;
  w.localStorage.clear();
  return { dom, w };
}

test('fetch wrapper appends impersonate to backend calls when set', () => {
  const { w } = boot();
  const seen = [];
  w.fetch = (u) => { seen.push(u); return Promise.resolve({ json: () => Promise.resolve({}) }); };
  w.eval(js);                          // installs OPERFI_IMP + wraps fetch
  w.localStorage.setItem('operfiImpersonate', 'client@x.com');
  w.fetch('https://operfi-broker-api.onrender.com/tms-loads?email=a@op.com');
  w.fetch('https://other.com/x');
  assert.ok(seen[0].includes('impersonate=client%40x.com'));
  assert.ok(!seen[1].includes('impersonate'));   // non-backend untouched
});

test('renderAdminBar shows picker for admin payload', () => {
  const { w } = boot();
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
  w.eval(js);
  w.OPERFI_IMP.renderAdminBar({ is_admin: true, name: 'Tom C',
    clients: [{ account_id: 'a2', name: 'Marek LLC', contact_email: 'p@m.com' }] });
  const bar = w.document.getElementById('operfi-admin-bar');
  assert.ok(bar);
  assert.match(bar.textContent, /OPERFI ADMIN/);
  assert.ok(bar.querySelector('[data-email="p@m.com"]'));
});

test('non-admin payload renders no bar', () => {
  const { w } = boot();
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
  w.eval(js);
  w.OPERFI_IMP.renderAdminBar({ is_admin: false });
  assert.equal(w.document.getElementById('operfi-admin-bar'), null);
});

test('esc escapes & < > " correctly', () => {
  const { w } = boot();
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
  w.eval(js);
  assert.equal(w.OPERFI_IMP.esc('a&b<c>d"e'), 'a&amp;b&lt;c&gt;d&quot;e');
});
