import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../invoice-request.html', import.meta.url), 'utf8');

test('page does not use the Creator SDK (public no-login page)', () => {
  assert.doesNotMatch(HTML, /ZOHO\.CREATOR/);
  assert.match(HTML, /operfi-broker-api\.onrender\.com/);
});

function makeDom(fetchImpl, url) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: url || 'https://app.operfi.com/invoice-request.html?token=a.b.c.d'
  });
  dom.window.fetch = fetchImpl;
  return dom;
}

function infoOk() {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(
    { broker_company: 'Marek LLC', carrier_name: 'ACME TRUCKING' }) });
}

async function settle(w, ms = 50) {
  await new Promise(r => setTimeout(r, ms));
}

test('renders broker and carrier names from /invoice-request/info', async () => {
  const dom = makeDom((u) => {
    if (String(u).includes('/invoice-request/info')) return infoOk();
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  const w = dom.window;
  w.dispatchEvent(new w.Event('load'));
  await settle(w);
  const text = w.document.getElementById('summary').textContent;
  assert.match(text, /Marek LLC/);
  assert.match(text, /ACME TRUCKING/);
  assert.ok(!w.document.getElementById('upload-card').classList.contains('hidden'));
});

test('invalid token shows the invalid-link state and hides the upload card', async () => {
  const dom = makeDom((u) => {
    if (String(u).includes('/invoice-request/info'))
      return Promise.resolve({ ok: false, status: 403,
        json: () => Promise.resolve({ error: 'Invalid or expired link' }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  const w = dom.window;
  w.dispatchEvent(new w.Event('load'));
  await settle(w);
  assert.match(w.document.getElementById('summary').textContent, /no longer valid/i);
  assert.ok(w.document.getElementById('upload-card').classList.contains('hidden'));
});

test('missing token shows a clear message without calling the API', async () => {
  let called = 0;
  const dom = makeDom(() => { called++; return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); },
    'https://app.operfi.com/invoice-request.html');
  const w = dom.window;
  w.dispatchEvent(new w.Event('load'));
  await settle(w);
  assert.match(w.document.getElementById('summary').textContent, /link/i);
  assert.equal(called, 0);
});

test('submitInvoice posts the staged file and shows the success state', async () => {
  const seen = [];
  const dom = makeDom((u, opts) => {
    seen.push({ u: String(u), opts });
    if (String(u).includes('/invoice-request/info')) return infoOk();
    if (String(u).includes('/invoice-request/upload'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  const w = dom.window;
  w.dispatchEvent(new w.Event('load'));
  await settle(w);
  w.stageFile(new w.File(['pdf-bytes'], 'inv.pdf', { type: 'application/pdf' }));
  await w.submitInvoice();
  const up = seen.find(s => s.u.includes('/invoice-request/upload'));
  assert.ok(up, 'upload endpoint was called');
  assert.equal(up.opts.method, 'POST');
  assert.match(up.u, /token=a\.b\.c\.d/);
  assert.match(w.document.getElementById('cstatus').textContent, /thank/i);
});

test('submitInvoice without a staged file shows an inline error and does not POST', async () => {
  const seen = [];
  const dom = makeDom((u) => {
    seen.push(String(u));
    if (String(u).includes('/invoice-request/info')) return infoOk();
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  const w = dom.window;
  w.dispatchEvent(new w.Event('load'));
  await settle(w);
  await w.submitInvoice();
  assert.ok(!seen.some(u => u.includes('/invoice-request/upload')));
  assert.match(w.document.getElementById('cstatus').textContent, /choose|select|file/i);
});

test('upload failure shows a visible error, never silent', async () => {
  const dom = makeDom((u) => {
    if (String(u).includes('/invoice-request/info')) return infoOk();
    if (String(u).includes('/invoice-request/upload'))
      return Promise.resolve({ ok: false, status: 502,
        json: () => Promise.resolve({ error: 'Upload failed. Please try again.' }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  const w = dom.window;
  w.dispatchEvent(new w.Event('load'));
  await settle(w);
  w.stageFile(new w.File(['x'], 'inv.pdf', { type: 'application/pdf' }));
  await w.submitInvoice();
  const st = w.document.getElementById('cstatus');
  assert.match(st.textContent, /failed/i);
  assert.match(st.className, /err/);
});
