import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../carrier-profile.html', import.meta.url), 'utf8');

function boot() {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/carrier-profile.html',
    beforeParse(window) {
      window.ZOHO = {
        CREATOR: {
          UTIL: { getInitParams: () => new Promise(() => {}) },
          DATA: {
            getRecords: () => Promise.resolve({ data: [] }),
            addRecords: () => Promise.resolve({ code: 3000, result: [{}] })
          }
        }
      };
      window.fetch = () => new Promise(() => {});
    }
  });
  return dom.window;
}

// The IP channel's location + ISP chips were hardcoded class 'good', so a signup
// out of Vranje, Serbia on Telekom Srbija rendered exactly as green as a Phoenix
// signup on Cox -- even though the signal row 30 lines below already read "⚠ RS".
// IPQS's own fraud_score_ip does not price country in (this carrier scored 0).

const SERBIA = {
  risk_level: 'Low', risk_score: 0, fraud_score_ip: 0, ip_checked: true,
  ip_location: 'Vranje, Central Serbia, RS', ip_isp: 'Telekom Srbija',
  ip_country: 'RS', vpn_detected: false, tor_detected: false
};

function ipChannelHtml(w, ipqs) {
  w.renderDigitalFootprint({ ipqs, vendor: { IP_Address: '178.220.154.3' } });
  const html = w.document.getElementById('cp-digital-footprint').innerHTML;
  // isolate the IP Address channel from the Phone/Email channels either side
  const start = html.indexOf('IP Address');
  assert.ok(start > -1, 'IP Address channel rendered');
  const next = html.indexOf('ipqs-channel-name', html.indexOf('ipqs-flags', start));
  return next > -1 ? html.slice(start, next) : html.slice(start);
}

test('a foreign signup IP does not render its location chip green', () => {
  const w = boot();
  const ip = ipChannelHtml(w, SERBIA);
  assert.match(ip, /ipqs-flag bad">Vranje, Central Serbia, RS</);
  assert.doesNotMatch(ip, /ipqs-flag good">Vranje/);
});

test('a foreign signup IP does not render its ISP chip green', () => {
  const w = boot();
  const ip = ipChannelHtml(w, SERBIA);
  assert.doesNotMatch(ip, /ipqs-flag good">Telekom Srbija</);
  assert.match(ip, /ipqs-flag bad">Telekom Srbija</);
});

test('no VPN / no Tor stay green on a foreign IP -- they are separate signals', () => {
  const w = boot();
  const ip = ipChannelHtml(w, SERBIA);
  assert.match(ip, /ipqs-flag good">No VPN</);
  assert.match(ip, /ipqs-flag good">No Tor</);
});

test('a US signup IP keeps its location chip green and its ISP neutral', () => {
  const w = boot();
  const ip = ipChannelHtml(w, {
    ...SERBIA, ip_location: 'Phoenix, AZ, US', ip_isp: 'Cox Communications',
    ip_country: 'US'
  });
  assert.match(ip, /ipqs-flag good">Phoenix, AZ, US</);
  assert.doesNotMatch(ip, /ipqs-flag bad"/);
  // an ISP name is descriptive, not a verdict -- never green on its own
  assert.match(ip, /ipqs-flag neutral">Cox Communications</);
});

test('country match is case-insensitive', () => {
  const w = boot();
  const ip = ipChannelHtml(w, { ...SERBIA, ip_location: 'Phoenix, AZ, US', ip_country: 'us' });
  assert.doesNotMatch(ip, /ipqs-flag bad"/);
});

test('an unknown country never turns a chip red', () => {
  const w = boot();
  const ip = ipChannelHtml(w, { ...SERBIA, ip_location: 'Somewhere', ip_country: '' });
  assert.doesNotMatch(ip, /ipqs-flag bad"/);
  assert.match(ip, /ipqs-flag good">Somewhere</);
});
