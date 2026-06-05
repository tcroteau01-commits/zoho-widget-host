import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../tms-load-detail.html', import.meta.url), 'utf8');

function boot(loadId) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.loadId = loadId || '';
  return w;
}

test('setMode toggles view/edit containers', () => {
  const w = boot('77');
  w.setMode('view');
  assert.ok(!w.document.getElementById('view-mode').classList.contains('hidden'));
  assert.ok(w.document.getElementById('edit-mode').classList.contains('hidden'));
  w.setMode('edit');
  assert.ok(w.document.getElementById('view-mode').classList.contains('hidden'));
  assert.ok(!w.document.getElementById('edit-mode').classList.contains('hidden'));
});

const LOAD = {
  id: '77', load_number: 'OPE-1042', status: 'In Transit',
  customer_name: 'ACF WEST INC.', customer_reference: 'PO 1234',
  customer_payment_terms: 'Net 30', invoice_amount: '2000', carrier_pay: '1200',
  carrier_name: '1 ABOVE ALL TOWING LLC', carrier_mc: '1764856',
  origin: 'Los Angeles, CA', destination: 'Cleveland, OH',
  equipment: 'Reefer', commodity: 'Ice Cream', weight: '50000',
  stops: [{ stop_type: 'Pickup', company_name: 'Dock A', address: 'LA', appointment: '' }],
  funding_portal_link: ''
};

test('renderView fills the read-only cards', () => {
  const w = boot('77');
  w.renderView(LOAD);
  const txt = w.document.getElementById('view-mode').textContent;
  assert.match(txt, /OPE-1042/);
  assert.match(txt, /ACF WEST INC\./);
  assert.match(txt, /1 ABOVE ALL TOWING LLC/);
  assert.match(txt, /\$2,000/);
  assert.match(txt, /Los Angeles, CA/);
});

test('stepper marks done/current/upcoming correctly', () => {
  const w = boot('77');
  w.renderView({ ...LOAD, status: 'In Transit' });
  const chips = [...w.document.querySelectorAll('#v-stepper .chip')];
  const byText = (t) => chips.find(c => c.textContent.includes(t));
  assert.ok(byText('Booked').classList.contains('done'));
  assert.ok(byText('In Transit').classList.contains('current'));
  assert.ok(byText('Delivered').classList.contains('upcoming'));
  assert.ok(byText('Submitted').classList.contains('locked')); // never click-to-set
});
