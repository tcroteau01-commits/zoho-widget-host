import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../tms-load-board.html', import.meta.url), 'utf8');

function boot() {
  const d = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  d.window.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
  return d.window;
}

const LOAD = {
  id: '77', load_number: 'OPE-1042', status: 'In Transit', customer_name: 'ACF WEST INC.',
  customer_reference: 'PO 1234', invoice_amount: '2000', carrier_pay: '1200',
  carrier_name: '1 ABOVE ALL TOWING LLC', carrier_mc: '1764856', origin: 'LA', destination: 'Cleveland',
  equipment: 'Reefer', stops: [], funding_portal_link: ''
};

test('slideout opens and closes', () => {
  const w = boot();
  const panel = w.document.getElementById('tms-slideout');
  assert.ok(panel);
  w.showSlideout(true);
  assert.ok(panel.classList.contains('open'));
  w.showSlideout(false);
  assert.ok(!panel.classList.contains('open'));
});

test('openSlideout fetches the load and renders cards + stepper', async () => {
  const w = boot();
  w.brokerEmail = 'b@op.com';
  w.fetch = (u) => Promise.resolve({ json: () => Promise.resolve(u.includes('/tms-load?') ? { load: LOAD } : {}) });
  await w.openSlideout('77');
  const body = w.document.getElementById('tms-slideout-body').textContent;
  assert.match(body, /OPE-1042/);
  assert.match(body, /1 ABOVE ALL TOWING/);
  assert.ok(w.document.querySelector('#tms-slideout-body .chip.current').textContent.includes('In Transit'));
  assert.ok(w.document.getElementById('tms-slideout').classList.contains('open'));
});

test('row click opens slideout; chip click posts status', async () => {
  const w = boot();
  w.brokerEmail = 'b@op.com';
  const calls = [];
  w.fetch = (u, o) => {
    if (u.includes('/tms-status')) { calls.push(JSON.parse(o.body)); return Promise.resolve({ json: () => Promise.resolve({ ok: true, status: JSON.parse(o.body).status }) }); }
    return Promise.resolve({ json: () => Promise.resolve(u.includes('/tms-load?') ? { load: LOAD } : {}) });
  };
  await w.selectLoad('77');               // row click handler
  assert.ok(w.document.getElementById('tms-slideout').classList.contains('open'));
  w.document.querySelector('#tms-slideout-body .chip[data-status="Delivered"]').click();
  await new Promise(r => setTimeout(r, 0));
  assert.ok(calls.some(c => c.status === 'Delivered' && c.load_id === '77'));
});
