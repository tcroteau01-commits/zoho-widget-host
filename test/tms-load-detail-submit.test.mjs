import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../tms-load-detail.html', import.meta.url), 'utf8');

function boot() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  dom.window.brokerEmail = 'b@x.com';
  dom.window.BROKER_API_BASE = 'http://api';
  return dom;
}

test('submit panel shows gate failures and disables submit', () => {
  const dom = boot();
  const { renderSubmitPanel } = dom.window;
  renderSubmitPanel(
    { id: '1', status: 'In Transit', vetting: {} },
    [{ document_type: 'POD' }]
  );
  const panel = dom.window.document.getElementById('submit-panel');
  assert.ok(/POD Received/.test(panel.textContent));
  assert.strictEqual(dom.window.document.getElementById('btn-submit-factoring').disabled, true);
});

test('submit panel enables submit when gates pass and invoice entered', () => {
  const dom = boot();
  const { renderSubmitPanel } = dom.window;
  renderSubmitPanel(
    { id: '1', status: 'POD Received', carrier_id: 'v1', vetting: { authority_active: true } },
    [{ document_type: 'POD' }, { document_type: 'Rate Con' }]
  );
  const inv = dom.window.document.getElementById('f-factoring-invoice');
  inv.value = 'FCT-1';
  inv.dispatchEvent(new dom.window.Event('input'));
  assert.strictEqual(dom.window.document.getElementById('btn-submit-factoring').disabled, false);
});

test('vetting warning reveals override checkbox', () => {
  const dom = boot();
  const { renderSubmitPanel } = dom.window;
  renderSubmitPanel(
    { id: '1', status: 'POD Received', vetting: { authority_active: false } },
    [{ document_type: 'POD' }, { document_type: 'Rate Con' }]
  );
  const ov = dom.window.document.getElementById('chk-override');
  assert.ok(ov, 'override checkbox present');
  assert.ok(/authority/i.test(dom.window.document.getElementById('submit-panel').textContent));
});

test('already-submitted load shows funding link and locks', () => {
  const dom = boot();
  const { renderSubmitPanel } = dom.window;
  renderSubmitPanel(
    { id: '1', status: 'Submitted', funding_portal_link: 'http://x/9', vetting: {} },
    []
  );
  const panel = dom.window.document.getElementById('submit-panel');
  assert.ok(/Submitted/.test(panel.textContent));
  assert.ok(panel.querySelector('a[href="http://x/9"]'));
});

test('submit gate fails when no carrier is assigned', () => {
  const dom = boot();
  const { renderSubmitPanel } = dom.window;
  renderSubmitPanel(
    { id: '1', status: 'POD Received', carrier_id: '', vetting: { authority_active: true } },
    [{ document_type: 'POD' }, { document_type: 'Rate Con' }]
  );
  dom.window.document.getElementById('f-factoring-invoice').value = 'FCT-1';
  dom.window.document.getElementById('f-factoring-invoice')
     .dispatchEvent(new dom.window.Event('input'));
  assert.strictEqual(dom.window.document.getElementById('btn-submit-factoring').disabled, true);
});

test('submit panel renders two document zones sorted by side', () => {
  const dom = boot();
  const w = dom.window;
  w.renderSubmitPanel(
    { id: '1', status: 'Delivered', carrier_id: 'v1', vetting: {} },
    [{ document_type: 'POD' }, { document_type: 'Carrier Invoice' }]
  );
  const cust = w.document.getElementById('zone-customer');
  const carr = w.document.getElementById('zone-carrier');
  assert.ok(cust && carr, 'both zones render');
  assert.match(cust.textContent, /POD/);
  assert.match(carr.textContent, /Carrier Invoice/);
  // POD must not appear in the carrier zone
  assert.doesNotMatch(carr.textContent, /POD/);
});

test('carrier zone upload posts the carrier doc-type via uploadBrokerDoc', async () => {
  const dom = boot();
  const w = dom.window;
  w.loadId = '1001';
  const posted = [];
  w.uploadBrokerDoc = function(docType, file){ posted.push({ docType, file }); return Promise.resolve(); };
  w.renderSubmitPanel({ id: '1', status: 'Delivered', carrier_id: 'v1', vetting: {} }, []);
  const f = new w.File([new Uint8Array([1])], 'inv.pdf', { type: 'application/pdf' });
  w.setZoneStagedFile('carrier', f);
  // trigger the carrier zone upload button
  w.document.getElementById('zone-carrier-upload-btn').click();
  await Promise.resolve();
  assert.equal(posted.length, 1);
  assert.equal(posted[0].docType, 'Carrier Invoice');
});
