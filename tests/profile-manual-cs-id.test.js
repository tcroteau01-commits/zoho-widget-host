// tests/profile-manual-cs-id.test.js
// CSID1: when the portal cannot identify a customer in Creditsafe, the analyst
// finds it on Creditsafe's own site and types the ID in here.
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../customer-profile.js');

const BASE = {
  submission_id: '4455', customer_name: 'C.H. ROBINSON', broker: 'Meridian Freight',
  status: 'Awaiting Credit Decision', contacts: {},
  engine: null, identity: null, summary: null, fv_debtor: null,
  fv_candidates: [], priors: [], priors_unavailable: false, can_act: true
};
const has = (html) => html.includes('data-cs-manual=');

test('no match on file: the ID box is offered', () => {
  assert.ok(has(P.render(BASE)));
});

test('search failed: the ID box is offered', () => {
  assert.ok(has(P.render(Object.assign({}, BASE, { cs_search_failed: true }))));
});

test('candidates shown but none right: the ID box is offered', () => {
  assert.ok(has(P.render(Object.assign({}, BASE, {
    cs_candidates: [{ connect_id: 'US1', name: 'X', address: '', status: '' }] }))));
});

test('marked Not in Creditsafe: the ID box is offered', () => {
  assert.ok(has(P.render(Object.assign({}, BASE, {
    identity: { not_in_creditsafe: true, bound_by: 'pat@operfi.com' } }))));
});

test('already bound: the ID box is offered to correct it', () => {
  assert.ok(has(P.render(Object.assign({}, BASE, {
    identity: { connect_id: 'US001-X-US1', bound_by: 'pat@operfi.com' } }))));
});

test('a viewer who cannot act never sees it', () => {
  assert.ok(!has(P.render(Object.assign({}, BASE, { can_act: false }))));
  assert.ok(!P.render(Object.assign({}, BASE, { can_act: false })).includes('cp-cs-manual-id'));
});

test('the box says it is a paid lookup', () => {
  assert.ok(/paid/i.test(P.render(BASE)));
});

test('the report names the company it is about', () => {
  const html = P.render(Object.assign({}, BASE, {
    identity: { connect_id: 'US001-X-US86504334' },
    summary: { scored: true, score: 72, company_name: 'CH ROBINSON WORLDWIDE INC',
               company_address: '800 WASHINGTON AVE N, MINNEAPOLIS, MN' } }));
  assert.ok(html.includes('CH ROBINSON WORLDWIDE INC'));
  assert.ok(html.includes('800 WASHINGTON AVE N'));
});
