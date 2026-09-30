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

test('portal-served copy never decorates a blob: or data: URL (page origin IS the API host)', () => {
  // On /portal/w/ the proxy swaps API_HOST for the portal's own host, so a blob
  // URL minted by the page ("blob:https://<portal>/uuid") contains API_HOST.
  // Appending ?impersonate= to it breaks the blob lookup (doc viewer fails).
  const { w } = boot();
  const seen = [];
  w.fetch = (u) => { seen.push(u); return Promise.resolve({ json: () => Promise.resolve({}) }); };
  w.eval(js.replace(/operfi-broker-api\.onrender\.com/g, 'brokers.operfi.com'));
  w.localStorage.setItem('operfiImpersonate', 'client@x.com');
  w.fetch('blob:https://brokers.operfi.com/6f1c-uuid');
  w.fetch('data:application/pdf;base64,JVBERi0=');
  w.fetch('https://brokers.operfi.com/tms-loads?email=a@op.com');
  w.fetch('/tms-loads?email=a@op.com');
  assert.strictEqual(seen[0], 'blob:https://brokers.operfi.com/6f1c-uuid');
  assert.strictEqual(seen[1], 'data:application/pdf;base64,JVBERi0=');
  assert.ok(seen[2].includes('impersonate=client%40x.com'), 'real API call still decorated');
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

function openPicker(){
  const { w } = boot();
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
  w.eval(js);
  w.OPERFI_IMP.renderAdminBar({ is_admin: true, clients: [{ name: 'Marek LLC', contact_email: 'p@m.com' }] });
  const search = w.document.getElementById('operfi-imp-search');
  const list = w.document.getElementById('operfi-imp-list');
  search.focus();
  search.value = 'mar';
  search.dispatchEvent(new w.Event('input'));
  assert.equal(list.style.display, 'block');
  return { w, search, list };
}

test('clicking away closes the picker, clears the text, keeps the current client', () => {
  const { w, search, list } = openPicker();
  w.localStorage.setItem('operfiImpersonate', 'prev@x.com');
  search.blur();
  assert.equal(list.style.display, 'none');
  assert.equal(search.value, '');
  assert.equal(w.localStorage.getItem('operfiImpersonate'), 'prev@x.com');
});

test('Escape closes the picker', () => {
  const { w, search, list } = openPicker();
  search.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(list.style.display, 'none');
  assert.equal(search.value, '');
});

test('mousedown on a client row does not steal focus, so the pick still lands', () => {
  const { w, list } = openPicker();
  const ev = new w.MouseEvent('mousedown', { bubbles: true, cancelable: true });
  list.querySelector('[data-email]').dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(list.style.display, 'block');
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

test('decorate appends impersonate to backend URLs when a target is set', () => {
  const { w } = boot();
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
  w.eval(js);
  w.localStorage.setItem('operfiImpersonate', 'client@x.com');
  const out = w.OPERFI_IMP.decorate('https://operfi-broker-api.onrender.com/reserve/export/csv?email=a@op.com');
  assert.ok(out.includes('impersonate=client%40x.com'), out);
});

test('decorate uses & when the URL already has a query string', () => {
  const { w } = boot();
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
  w.eval(js);
  w.localStorage.setItem('operfiImpersonate', 'client@x.com');
  const out = w.OPERFI_IMP.decorate('https://operfi-broker-api.onrender.com/reserve/export/csv?email=a@op.com');
  assert.ok(out.includes('?email=a@op.com&impersonate='), out);
});

test('decorate leaves the URL untouched when no target is set', () => {
  const { w } = boot();
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
  w.eval(js);
  const url = 'https://operfi-broker-api.onrender.com/reserve/export/csv?email=a@op.com';
  assert.equal(w.OPERFI_IMP.decorate(url), url);
});

test('decorate leaves non-backend URLs untouched even when a target is set', () => {
  const { w } = boot();
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
  w.eval(js);
  w.localStorage.setItem('operfiImpersonate', 'client@x.com');
  const url = 'https://other.com/x?a=1';
  assert.equal(w.OPERFI_IMP.decorate(url), url);
});

test('decorate does not double-append when impersonate is already present', () => {
  const { w } = boot();
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
  w.eval(js);
  w.localStorage.setItem('operfiImpersonate', 'client@x.com');
  const url = 'https://operfi-broker-api.onrender.com/reserve/export/csv?email=a@op.com&impersonate=client%40x.com';
  const out = w.OPERFI_IMP.decorate(url);
  assert.equal(out.match(/impersonate=/g).length, 1, out);
});
