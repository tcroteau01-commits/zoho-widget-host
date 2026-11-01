// tests/profile-financials.test.js
// CREDITINT1: a customer's financials live on the customer profile, for broker
// customers and carrier clients' customers alike. Pure render, so every state
// and the escaping are checked without a browser.
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../customer-profile.js');

const BASE = {
  submission_id: '4455', customer_name: 'HOGAN EQUIPMENT', broker: 'Marek LLC',
  status: 'Awaiting Credit Decision', contacts: {}, engine: null, identity: null,
  summary: null, fv_debtor: null, fv_candidates: [], priors: [],
  priors_unavailable: false, can_act: true, api_base: 'https://api.example'
};

function withFin(fin, over) {
  return P.render(Object.assign({}, BASE, { financials: fin }, over || {}));
}

const RECEIVED = {
  state: 'received', application_id: 'app77',
  requests: [
    { id: 'r1', status: 'superseded', at: '2026-10-01T10:00:00Z', sent_to: 'd***@hogan.com',
      note: 'first ask', files: [] },
    { id: 'r2', status: 'completed', at: '2026-10-20T15:30:00Z', sent_to: 'd***@hogan.com',
      note: 'Last two years please', files: [
        { id: 'f1', name: '2025 P&L.pdf', size: 20480 },
        { id: 'f2', name: 'balance.xlsx', size: 900 }] }
  ]
};

test('no financials key renders nothing, not an error', () => {
  const html = P.render(BASE);
  assert.ok(!html.includes('cp-financials'));
});

test('each state reads in plain words', () => {
  assert.ok(withFin({ state: 'none', application_id: null, requests: [] }).includes('None requested'));
  assert.ok(withFin({ state: 'waiting', application_id: 'a', requests: [] }).includes('Waiting on financials'));
  assert.ok(withFin(RECEIVED).includes('Financials received'));
});

test('each request shows its date, masked recipient, status and note', () => {
  const html = withFin(RECEIVED);
  assert.ok(html.includes('2026-10-20 15:30 UTC'));
  assert.ok(html.includes('d***@hogan.com'));
  assert.ok(html.includes('Last two years please'));
  assert.ok(html.includes('Received'));
  assert.ok(html.includes('Replaced by a newer request'));
});

test('a recipient the payload sent unmasked is masked on screen', () => {
  const html = withFin({ state: 'waiting', application_id: 'a', requests: [
    { id: 'r', status: 'sent', at: '2026-10-20T15:30:00Z', sent_to: 'dana@hogan.com', files: [] }] });
  assert.ok(html.includes('d***@hogan.com'));
  assert.ok(!html.includes('dana@hogan.com'));
});

test('files are download links to the financials-file route, never the inline viewer', () => {
  const html = withFin(RECEIVED);
  assert.ok(html.includes('href="https://api.example/credit-app/financials-file/app77/f1"'));
  assert.ok(html.includes('2025 P&amp;L.pdf'));
  assert.ok(html.includes('download'));
  assert.ok(html.includes('target="_blank"'));
  const fin = html.slice(html.indexOf('cp-financials'));
  assert.ok(!/cp-doc-view/.test(fin.slice(0, fin.indexOf('</ul>') + 5)),
    'a financials file must not open in the shared inline viewer');
});

test('every server value is escaped', () => {
  const html = withFin({ state: 'waiting', application_id: 'a"b', requests: [
    { id: 'r', status: 'sent', at: '2026-10-20T15:30:00Z', sent_to: 'x***@y.com',
      note: '<img src=x onerror=alert(1)>', files: [{ id: 'f"1', name: '<b>x</b>.pdf', size: 1 }] }] });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<b>x</b>'));
  assert.ok(html.includes('a%22b/f%221'));
});

test('staff who can act get the Request financials control; view-only staff do not', () => {
  const fin = { state: 'none', application_id: null, requests: [] };
  assert.ok(withFin(fin).includes('data-fin-open'));
  assert.ok(withFin(fin).includes('id="cp-fin-form"'));
  const viewOnly = withFin(fin, { can_act: false });
  assert.ok(!viewOnly.includes('data-fin-open'));
  assert.ok(!viewOnly.includes('cp-fin-form'));
});

test('the note box says who reads the note', () => {
  const html = withFin({ state: 'none', application_id: null, requests: [] });
  assert.ok(/customer and the client both see/i.test(html));
});

test('a financials-only app status reads as Financials requested, never App sent', () => {
  const html = P.render(Object.assign({}, BASE, { credit_app: { status: 'financials_only',
    customer: null, references: [] } }));
  assert.ok(html.includes('Financials requested'));
  assert.ok(!html.includes('financials_only'));
});

test('no em or en dashes in the financials section copy', () => {
  [RECEIVED, { state: 'none', application_id: null, requests: [] },
   { state: 'waiting', application_id: 'a', requests: [{ id: 'r', status: 'sent', files: [] }] }]
    .forEach((fin) => {
      const html = P.renderFinancials(Object.assign({}, BASE, { financials: fin }));
      assert.ok(html.length > 0);
      assert.ok(!/[–—]/.test(html), html);
    });
});
