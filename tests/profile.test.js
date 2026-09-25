// tests/profile.test.js
// The profile an analyst reads. Pure render, so every branch is testable
// without a browser -- and the branches that matter are the empty ones, because
// a real submission arrives with almost nothing filled in.
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../customer-profile.js');

const BASE = {
  submission_id: '4455', customer_name: 'C.H. ROBINSON', broker: 'Meridian Freight',
  status: 'Awaiting Credit Decision',
  contacts: { poc: 'Dana Reed', email: 'dana@chrobinson.com',
              billing_poc: 'Aisha Khan', billing_email: 'ap@chrobinson.com' },
  engine: null, identity: null, summary: null, fv_debtor: null,
  fv_candidates: [], priors: [], priors_unavailable: false, can_act: true
};

test('an empty profile still renders', () => {
  const html = P.render(BASE);
  assert.ok(html.includes('C.H. ROBINSON'));
  assert.ok(html.includes('Meridian Freight'));
});

test('the engine verdict and its reasons are shown', () => {
  const html = P.render(Object.assign({}, BASE, {
    engine: { suggested: 'review_required', limit: null,
              reasons: ['more than one Creditsafe match'], engine_version: 'v1' } }));
  assert.ok(html.includes('more than one Creditsafe match'));
});

test('a suggested limit is shown as money, not a raw number', () => {
  const html = P.render(Object.assign({}, BASE, {
    engine: { suggested: 'auto_approve', limit: 15000, reasons: [], engine_version: 'v1' } }));
  assert.ok(html.includes('$15,000'));
});

test('FactorView candidates render as a picker when unbound', () => {
  const html = P.render(Object.assign({}, BASE, { fv_candidates: [
    { company_id: '2030', name: 'C.H. ROBINSON', buy_limit: 397500, restricted: false,
      is_active: true, state: 'IL' } ] }));
  assert.ok(html.includes('$397,500'));
  assert.ok(html.includes('data-fv-pick="2030"'));
});

test('restricted is called out, because it is the deny signal', () => {
  const html = P.render(Object.assign({}, BASE, { fv_debtor:
    { company_id: '77', name: 'ACME', buy_limit: 5000, restricted: true,
      is_active: true, state: 'TX' } }));
  assert.ok(/[Rr]estricted/.test(html));
});

test('a viewer sees the page but no action controls', () => {
  const html = P.render(Object.assign({}, BASE, { can_act: false, fv_candidates: [
    { company_id: '2030', name: 'X', buy_limit: 0, restricted: false,
      is_active: true, state: '' } ] }));
  assert.ok(!html.includes('data-fv-pick='));
  assert.ok(!html.includes('data-cs-pick='));
});

test('other clients limits render with the broker name', () => {
  const html = P.render(Object.assign({}, BASE, { priors: [
    { submission_id: '1', broker: 'Cascade Logistics', limit: 25000, decided_at: '' } ] }));
  assert.ok(html.includes('Cascade Logistics'));
  assert.ok(html.includes('$25,000'));
});

test('an unavailable priors section says so rather than showing none', () => {
  const html = P.render(Object.assign({}, BASE, { priors_unavailable: true }));
  assert.ok(/unavailable/i.test(html));
});

test('a hostile customer name cannot inject markup', () => {
  const html = P.render(Object.assign({}, BASE, {
    customer_name: '<img src=x onerror=alert(1)>' }));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img'));
});

test('a hostile broker name and engine reason are escaped too', () => {
  const html = P.render(Object.assign({}, BASE, {
    broker: '<script>a</script>',
    engine: { suggested: 'review_required', limit: null,
              reasons: ['<script>b</script>'], engine_version: 'v1' } }));
  assert.ok(!html.includes('<script>a'));
  assert.ok(!html.includes('<script>b'));
});

test('a bound identity shows the report section instead of the picker', () => {
  const html = P.render(Object.assign({}, BASE, {
    identity: { connect_id: 'US1', fv_debtor_id: '2030', not_in_creditsafe: false },
    summary: { scored: true, score: 72, grade: 'A', recommended_limit: 1000000,
               active_trade_lines: 841, dbt: 5, established_year: 1969,
               address_type: 'Street Address' } }));
  assert.ok(!html.includes('data-cs-pick='));
  assert.ok(html.includes('841'));
});

test('a customer recorded as absent from Creditsafe says so', () => {
  const html = P.render(Object.assign({}, BASE, {
    identity: { connect_id: null, fv_debtor_id: null, not_in_creditsafe: true } }));
  assert.ok(/not in Creditsafe/i.test(html));
});

test('the decision controls are in the header for someone who may act', () => {
  const html = P.render(BASE);
  assert.ok(html.includes('data-decide="Approved"'));
  assert.ok(html.includes('data-decide="Denied"'));
  assert.ok(html.includes('id="cp-limit"'));
});

test('a viewer gets no decision controls at all', () => {
  const html = P.render(Object.assign({}, BASE, { can_act: false }));
  assert.ok(!html.includes('data-decide='));
  assert.ok(!html.includes('id="cp-limit"'));
});

test('a suggested limit becomes a one-click approve', () => {
  const html = P.render(Object.assign({}, BASE, {
    engine: { suggested: 'auto_approve', limit: 20000, reasons: [], engine_version: 'v1' } }));
  assert.ok(html.includes('Approve $20,000'));
  assert.ok(/id="cp-limit"[^>]*value="20000"/.test(html));
});

test('the creditsafe candidates render as a picker', () => {
  const html = P.render(Object.assign({}, BASE, {
    cs_total: 39,
    cs_candidates: [{ connect_id: 'US001-X-1', name: 'C.H. ROBINSON WORLDWIDE',
                      address: 'Eden Prairie, MN', status: 'Active' }] }));
  assert.ok(html.includes('data-cs-pick="US001-X-1"'));
  assert.ok(html.includes('C.H. ROBINSON WORLDWIDE'));
  assert.ok(html.includes('39'));
});

test('a failed creditsafe search does not look like no matches', () => {
  const html = P.render(Object.assign({}, BASE, { cs_search_failed: true }));
  assert.ok(/unavailable|could not|failed/i.test(html));
});

test('a viewer gets no creditsafe pick controls', () => {
  const html = P.render(Object.assign({}, BASE, {
    can_act: false, cs_total: 39,
    cs_candidates: [{ connect_id: 'US1', name: 'X', address: '', status: '' }] }));
  assert.ok(!html.includes('data-cs-pick='));
  assert.ok(!html.includes('data-cs-absent='));
});

test('a hostile candidate name cannot inject markup', () => {
  const html = P.render(Object.assign({}, BASE, {
    cs_candidates: [{ connect_id: 'US1', name: '<img src=x onerror=alert(1)>',
                      address: '', status: '' }] }));
  assert.ok(!html.includes('<img src=x'));
});
