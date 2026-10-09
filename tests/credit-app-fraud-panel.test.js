// tests/credit-app-fraud-panel.test.js
// CREDFRAUD1: the staff fraud panel. Pure render.
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../credit-app-fraud-panel.js');

const HIGH = {
  level: 'high',
  reasons: [
    { code: 'shared_ip', strength: 'strong', text: 'Trade 1 and Trade 3 submitted from the same IP address (176.110.219.109).' },
    { code: 'shared_user_agent', strength: 'supporting', text: 'Identical browser.' }
  ],
  parties: [
    { slot: 'trade1', label: 'Trade 1', company: 'kgmp&s llc', email: 'tomkgmps@mailfence.com',
      email_domain: 'mailfence.com', domain_age_days: 5056, opened_at: '2026-10-06T17:46:29Z',
      completed_at: '2026-10-06T17:53:05Z', minutes_open_to_submit: 6, ip: '176.110.219.109',
      ip_captured: true, network: 'Micron Hosting (AS137409)', connection_type: 'Data Center',
      browser: 'Edge on Windows', user_agent: 'UA', phone: '918 800 7187',
      phone_carrier: 'ONVOY SPECTRUM, LLC', phone_line_type: 'Wireless', level: 'review' },
    { slot: 'bank', label: 'Bank', company: 'Wells Fargo Bank', email: 'yinkoko81@outlook.com',
      email_domain: 'outlook.com', domain_age_days: null, opened_at: null, completed_at: null,
      minutes_open_to_submit: null, ip: null, ip_captured: false, network: '', connection_type: '',
      browser: '', user_agent: '', phone: '', phone_carrier: '', phone_line_type: '', level: 'review' }
  ],
  repeats: { ip: ['176.110.219.109'], network: [], user_agent: [], phone_carrier: ['ONVOY SPECTRUM, LLC'] }
};

test('nothing to show renders nothing', () => {
  assert.strictEqual(P.render(null), '');
  assert.strictEqual(P.render({}), '');
});

test('high shows the red headline and every reason', () => {
  const html = P.render(HIGH);
  assert.ok(html.includes('cfp-level-high'));
  assert.ok(html.includes('High fraud risk'));
  assert.ok(html.includes('same IP address'));
  assert.ok(html.includes('Identical browser.'));
});

test('repeated values are marked', () => {
  const html = P.render(HIGH);
  assert.ok(/class="cfp-repeat"[^>]*>176\.110\.219\.109/.test(html));
  assert.ok(/class="cfp-repeat"[^>]*>ONVOY SPECTRUM, LLC/.test(html));
});

test('an uncaptured IP says so instead of showing an address', () => {
  assert.ok(P.render(HIGH).includes('not captured (before 10-09 fix)'));
});

test('user text is escaped', () => {
  const evil = JSON.parse(JSON.stringify(HIGH));
  evil.parties[0].company = '<img src=x onerror=alert(1)>';
  assert.ok(!P.render(evil).includes('<img src=x'));
});

test('every level has a label and no dashes', () => {
  ['high', 'review', 'clean', 'unknown'].forEach(function (lvl) {
    const html = P.render({ level: lvl, reasons: [], parties: [], repeats: {} });
    assert.ok(html.includes('cfp-level-' + lvl));
    assert.ok(!/[–—]/.test(html));
  });
});

function party(over) {
  return Object.assign({ slot: 'trade1', label: 'Trade 1', company: 'Co', email_domain: 'x.com',
    ip: '1.1.1.1', ip_captured: true, network: '', connection_type: '', browser: '', user_agent: '',
    phone_carrier: '' }, over);
}

test('the same network on two parties highlights both network cells', () => {
  const html = P.render({ level: 'review', reasons: [], repeats: {}, parties: [
    party({ label: 'Trade 1', ip: '1.1.1.1', network: 'Micron Hosting (AS137409)' }),
    party({ label: 'Trade 3', ip: '2.2.2.2', network: 'Micron Hosting (AS137409)' })] });
  assert.strictEqual((html.match(/class="cfp-repeat"[^>]*>Micron Hosting \(AS137409\)/g) || []).length, 2);
});

test('a /24 listed in repeats.network highlights the network cell', () => {
  const html = P.render({ level: 'review', reasons: [], repeats: { network: ['176.110.216.0/24'] }, parties: [
    party({ ip: '176.110.216.48', network: 'Some ISP' })] });
  assert.ok(/class="cfp-repeat"[^>]*>Some ISP/.test(html));
});

test('a single party with a unique network is not highlighted', () => {
  const html = P.render({ level: 'review', reasons: [], repeats: { network: [] }, parties: [
    party({ network: 'Unique ISP' }),
    party({ label: 'Trade 2', ip: '3.3.3.3', network: 'Other ISP' })] });
  assert.ok(!/class="cfp-repeat"[^>]*>(Unique|Other) ISP/.test(html));
});

test('level and strength are escaped in attribute context', () => {
  const html = P.render({ level: 'high" onmouseover="x', reasons: [{ strength: '<b>', text: 't' }],
    parties: [], repeats: {} });
  assert.ok(!html.includes('" onmouseover="'));
  assert.ok(!html.includes('<b>'));
});

test('an uncaptured IP is never printed or highlighted', () => {
  const html = P.render({ level: 'review', reasons: [], repeats: { ip: ['9.9.9.9'] }, parties: [
    party({ ip: '9.9.9.9', ip_captured: false })] });
  assert.ok(!html.includes('9.9.9.9'));
  assert.ok(!/cfp-repeat[^>]*>not captured/.test(html));
});

test('the browser cell is never highlighted, even for an identical UA', () => {
  const html = P.render({ level: 'review', reasons: [], repeats: { user_agent: ['UA'] }, parties: [
    party({ browser: 'Chrome on Windows', user_agent: 'UA' }),
    party({ label: 'Trade 2', ip: '2.2.2.2', browser: 'Chrome on Windows', user_agent: 'UA' })] });
  assert.ok(html.includes('Chrome on Windows'));
  assert.ok(!/class="cfp-repeat"[^>]*>Chrome on Windows/.test(html));
});

test('residential and mobile networks are never highlighted; a data center pair still is', () => {
  const html = P.render({ level: 'review', reasons: [], repeats: { network: ['73.1.1.0/24'] }, parties: [
    party({ label: 'Trade 1', ip: '73.1.1.5', network: 'Comcast (AS7922)', connection_type: 'Residential' }),
    party({ label: 'Trade 2', ip: '73.1.1.9', network: 'Comcast (AS7922)', connection_type: 'residential' }),
    party({ label: 'Trade 3', ip: '8.8.8.8', network: 'T-Mobile (AS21928)', connection_type: 'MOBILE' }),
    party({ label: 'Bank', ip: '8.8.4.4', network: 'T-Mobile (AS21928)', connection_type: 'Mobile' }),
    party({ label: 'Applicant', ip: '1.1.1.1', network: 'Micron Hosting (AS137409)', connection_type: 'Data Center' }),
    party({ label: 'Trade 4', ip: '2.2.2.2', network: 'Micron Hosting (AS137409)', connection_type: 'Data Center' })] });
  assert.ok(!/class="cfp-repeat"[^>]*>Comcast/.test(html));
  assert.ok(!/class="cfp-repeat"[^>]*>T-Mobile/.test(html));
  assert.strictEqual((html.match(/class="cfp-repeat"[^>]*>Micron Hosting/g) || []).length, 2);
});
