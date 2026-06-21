import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../company-profile.html', import.meta.url), 'utf8');

function boot({ canManage }) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  dom.window.brokerEmail = 'broker@x.com';
  dom.window.BROKER_API_BASE = 'https://api.test';
  dom.window.canManage = canManage;
  return dom.window;
}

test('validateLogoFile rejects non png/jpg', () => {
  const w = boot({ canManage: true });
  const bad = { type: 'application/pdf', size: 1000, name: 'x.pdf' };
  assert.ok(w.validateLogoFile(bad));               // returns an error string
});

test('validateLogoFile rejects > 3MB', () => {
  const w = boot({ canManage: true });
  const big = { type: 'image/png', size: 3 * 1024 * 1024 + 1, name: 'big.png' };
  assert.ok(w.validateLogoFile(big));
});

test('validateLogoFile accepts a small png', () => {
  const w = boot({ canManage: true });
  const ok = { type: 'image/png', size: 50000, name: 'logo.png' };
  assert.equal(w.validateLogoFile(ok), null);
});

test('renderLogoSection hides controls for non-managers', () => {
  const w = boot({ canManage: false });
  w.renderLogoSection('data:image/png;base64,AAA');
  const sec = w.document.getElementById('logo-section');
  assert.ok(sec.querySelector('img'));              // current logo shown
  assert.equal(sec.querySelector('[data-act="upload-logo"]'), null);  // no upload control
});

test('renderLogoSection shows upload control for managers', () => {
  const w = boot({ canManage: true });
  w.renderLogoSection('');
  const sec = w.document.getElementById('logo-section');
  assert.ok(sec.querySelector('[data-act="upload-logo"]'));
});

test('uploadLogo posts FormData to /broker-logo', async () => {
  const w = boot({ canManage: true });
  let calls = [];
  w.fetch = (url, opts) => {
    calls.push({ url, opts });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
  };
  await w.uploadLogo({ type: 'image/png', size: 1000, name: 'logo.png' });
  // First call must be the logo upload; subsequent calls may be loadAccount refresh
  const first = calls[0];
  assert.ok(first && first.url.endsWith('/broker-logo'));
  assert.equal(first.opts.method, 'POST');
  assert.ok(first.opts.body instanceof w.FormData);
});
