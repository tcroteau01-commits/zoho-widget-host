// RCSTOPS1: River's End RIV-1001 printed city/state only because the stops on
// screen were never saved. Generate reads the SAVED load, so it must save first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../tms-load-detail.html', import.meta.url), 'utf8');

const LOAD = { id: '1001', load_number: 'RIV-1001', status: 'Covered', customer_id: 'cu_1',
  carrier_id: '', origin: 'Port Wentworth, GA', destination: 'St. Augustine, FL',
  stops: [{ stop_type: 'Pickup', company_name: 'SLG', address: '250 Grange Rd, Savannah, GA 31407' },
          { stop_type: 'Delivery', company_name: 'TMS', address: '390 Industrial Dr, St. Augustine, FL 32092' }] };

function makeWidget(saveReply) {
  const posts = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/tms-load-detail.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = function (url, init) {
        if (init && init.method === 'POST') {
          const body = JSON.parse(init.body);
          posts.push({ url: String(url), body });
          if (/\/tms-load$/.test(String(url))) {
            return Promise.resolve({ json: () => Promise.resolve(saveReply || { ok: true, id: '1001' }) });
          }
          return Promise.resolve({ json: () => Promise.resolve({ ok: true, document_id: 'd', pdf_base64: 'JVBERi0=' }) });
        }
        return Promise.resolve({ json: () => Promise.resolve({ documents: [], carriers: [], customers: [], templates: [] }) });
      };
    }
  });
  const w = dom.window;
  w.brokerEmail = 'b@op.com';
  // the page loads customers before it hydrates (loadRefData), so the option exists
  w.document.getElementById('f-customer_id').innerHTML = '<option value=""></option><option value="cu_1">PROMAX</option>';
  w._downloadPdf = function () {};
  return { w, posts };
}

function stopRows(w) { return w.document.querySelectorAll('.stop-row'); }

test('re-hydrating (as every save does) does not duplicate stop rows', () => {
  const { w } = makeWidget();
  w.hydrate(LOAD);
  w.hydrate(LOAD);
  assert.equal(stopRows(w).length, 2);
});

test('generate with no unsaved changes does not save first', async () => {
  const { w, posts } = makeWidget();
  w.hydrate(LOAD);
  w.markCarriersReady();
  await w.generateDoc('rate_con', false);
  assert.deepEqual(posts.map(p => p.url.replace(/.*\//, '')), ['generate']);
});

test('generate saves unsaved stops before rendering the RC', async () => {
  const { w, posts } = makeWidget();
  w.hydrate(Object.assign({}, LOAD, { stops: [] }));
  w.markCarriersReady();
  w.addStop('Pickup');
  stopRows(w)[0].querySelector('[data-k="address"]').value = '250 Grange Rd, Savannah, GA 31407';
  await w.generateDoc('rate_con', false);
  assert.deepEqual(posts.map(p => p.url.replace(/.*\//, '')), ['tms-load', 'generate']);
  assert.equal(posts[0].body.stops[0].address, '250 Grange Rd, Savannah, GA 31407');
});

test('a failed save blocks generation and shows the save error', async () => {
  const { w, posts } = makeWidget({ ok: false, id: '1001', error: 'Load saved, but 1 of 1 stops did not save.' });
  w.hydrate(LOAD);
  w.markCarriersReady();
  w.document.getElementById('f-commodity').value = 'glass beads';
  await w.generateDoc('bol', false);
  assert.equal(posts.filter(p => /generate$/.test(p.url)).length, 0);
  assert.match(w.document.getElementById('form-error').textContent, /1 of 1 stops/);
});

test('generate will not auto-save before the carrier list has loaded', async () => {
  const { w, posts } = makeWidget();
  w.hydrate(LOAD);
  w.document.getElementById('f-commodity').value = 'glass beads';
  await w.generateDoc('rate_con', false);
  assert.equal(posts.length, 0);
  assert.match(w.document.getElementById('doc-status').textContent, /loading/i);
});

test('a partial-failure save still adopts the new load id so a retry updates, not duplicates', async () => {
  const { w } = makeWidget({ ok: false, id: '2002', error: 'Load saved, but 1 of 1 stops did not save.' });
  w.loadId = '';
  w.document.getElementById('f-customer_id').value = 'cu_1';
  const ok = await w.saveLoad();
  assert.equal(ok, false);
  assert.equal(w.loadId, '2002');
});
