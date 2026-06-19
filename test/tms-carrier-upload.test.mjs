import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../tms-carrier-upload.html', import.meta.url), 'utf8');

const SUMMARY = { load_number: 'L-1', status: 'Covered', broker_company: 'Marek LLC',
  carrier_name: 'ROADWAY', lane: 'Dallas, TX → Atlanta, GA',
  stops: [{ type: 'Pickup', sequence: 1, company_name: 'Ship Co', address: '9 B St', appointment: '', reference_no: 'R1' }],
  upload_doc_types: ['BOL', 'Carrier Invoice', 'Lumper Receipt', 'Other', 'POD', 'Signed Rate Con'] };

function makeWidget(token) {
  const calls = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/tms-carrier-upload.html?token=' + (token === undefined ? '1001.abc' : token),
    beforeParse(window) {
      window.fetch = function(url, init){
        calls.push({ url: url, init: init || {} });
        if (String(url).indexOf('/tms-public/load') !== -1) return Promise.resolve({ json: () => Promise.resolve(SUMMARY) });
        if (String(url).indexOf('/tms-public/upload') !== -1) return Promise.resolve({ json: () => Promise.resolve({ ok: true, document_id: 'doc_1' }) });
        return Promise.resolve({ json: () => Promise.resolve({}) });
      };
    }
  });
  return { window: dom.window, calls };
}

test('renderSummary shows load + lane and no financials', () => {
  const { window } = makeWidget();
  window.renderSummary(SUMMARY);
  const txt = window.document.getElementById('summary').textContent;
  assert.match(txt, /L-1/);
  assert.match(txt, /Marek LLC/);
  assert.match(txt, /Dallas, TX → Atlanta, GA/);
  // doc-type options populated
  assert.equal(window.document.querySelectorAll('#ctype option').length, 6);
});

test('getToken reads the token from the URL', () => {
  const { window } = makeWidget('9999.zzz');
  assert.equal(window.getToken(), '9999.zzz');
});

test('uploadFile posts to /tms-public/upload with the token', async () => {
  const { window, calls } = makeWidget('1001.abc');
  const file = new window.File([new Uint8Array([1])], 'pod.pdf', { type: 'application/pdf' });
  await window.uploadFile('POD', file);
  const up = calls.find(c => String(c.url).indexOf('/tms-public/upload') !== -1);
  assert.ok(up);
  assert.match(up.url, /token=1001\.abc/);
  assert.ok(up.init.body instanceof window.FormData);
});

test('missing token shows an error state', () => {
  const { window } = makeWidget('');
  window.boot();
  assert.match(window.document.body.textContent, /link/i);
});

test('dropping a file on the carrier page shows it staged', () => {
  const { window } = makeWidget();
  const f = new window.File([new Uint8Array([1,2,3])], 'pod.pdf', { type: 'application/pdf' });
  window.setCarrierStagedFile(f);
  const dz = window.document.getElementById('cdropzone');
  assert.match(dz.textContent, /pod\.pdf/);
  assert.match(dz.textContent, /ready|attached/i);
});
