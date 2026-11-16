// tests/profile-submitted-from.test.js
// SENDIP3 (Tom, 2026-11-16): the client's IP on every credit check it submits,
// red when it came from outside the US or through a VPN.
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../customer-profile.js');

const BASE = {
  submission_id: '4455', customer_name: 'BUY USED PALLET RACKING', broker: 'AGILE FREIGHT BROKERS, LLC',
  submitted_by: { name: 'Isabell', email: 'isabell@agile.test' },
  status: 'Awaiting Credit Decision', contacts: {}, engine: null, identity: null, summary: null,
  fv_debtor: null, fv_candidates: [], priors: [], priors_unavailable: false,
  submitted: { credit_limit: 5000, documents: [] }, can_act: true, boosts: []
};

function from(o) { return P.render(Object.assign({}, BASE, { submitted_from: o })); }

test('a check submitted from abroad is red and names the country and ISP', () => {
  const html = from({ ip: '72.255.34.72', country: 'PK', isp: 'Cybernet', hidden: [], flag: 'abroad' });
  assert.ok(html.includes('cp-origin cp-origin-flag'));
  assert.ok(html.includes('<strong>Outside the US:</strong> Submitted from 72.255.34.72 (Cybernet, PK)'));
});

test('a check submitted through a VPN is red and says so', () => {
  const html = from({ ip: '187.40.234.182', country: 'US', isp: 'PacketHub', hidden: ['proxy', 'vpn'], flag: 'hidden' });
  assert.ok(html.includes('<strong>VPN or proxy:</strong> Submitted from 187.40.234.182 (PacketHub, US) through proxy, VPN'));
});

test('a plain US check shows the IP quietly', () => {
  const html = from({ ip: '73.1.1.1', country: 'US', isp: 'Comcast', hidden: [], flag: '' });
  assert.ok(html.includes('<div class="cp-origin">Submitted from 73.1.1.1 (Comcast, US)</div>'));
});

test('a check with no recorded origin shows no line', () => {
  assert.ok(!from(null).includes('cp-origin'));
});
