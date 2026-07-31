import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../carrier-profile.html', import.meta.url), 'utf8');

// Mirrors the boot helper in carrier-profile-authority.test.mjs
function bootCarrierProfile() {
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

function boot() {
  return bootCarrierProfile();
}

test('_checkRow renders a neutral no-data state (na), not green', () => {
  const w = boot();
  // na must not use the good/✓ styling
  const html = w._checkRow('X', 'no info', 'src', 'na');
  assert.match(html, /check-pill na/);
  assert.doesNotMatch(html, /check-pill good/);
});

test('unverified factor (blank Factor_Status) is NOT shown as Approved/green', () => {
  const w = boot();
  w.renderBankChecklist({ vendor: { Factoring_Company: { ID: 'F1' } }, bank: { has_bank_info: false } });
  const html = w.document.getElementById('cp-bank-checklist').innerHTML;
  assert.match(html, /Not Verified/);
  assert.doesNotMatch(html, /Factor status:\s*<strong>Approved/);
  // the factor row must not be green
  assert.match(html, /Factoring Company Status[\s\S]*?check-pill (warn|na)/);
});

test('a genuinely Approved factor still shows Approved/green', () => {
  const w = boot();
  w.renderBankChecklist({ vendor: { Factoring_Company: { ID: 'F1' }, Factor_Status: 'Approved' }, bank: { has_bank_info: false } });
  assert.match(w.document.getElementById('cp-bank-checklist').innerHTML, /Approved/);
});

test('no bank on file is neutral, not a green OK', () => {
  const w = boot();
  w.renderBankChecklist({ vendor: {}, bank: { has_bank_info: false } });
  const row = w.document.getElementById('cp-bank-checklist').innerHTML;
  // Carrier-Bank State Match with no bank → na, not good
  assert.match(row, /Carrier-Bank State Match[\s\S]*?check-pill na/);
});

test('NOT RATED safety rating is neutral, not green', () => {
  const w = boot();
  w.renderSafetyChecklist({ carrierok: {} });   // no safety_rating_desc
  assert.match(w.document.getElementById('cp-safety-checklist').innerHTML,
    /FMCSA Safety Rating[\s\S]*?check-pill na/);
});

test('authority-active carrier with a vehicle OOS alert does NOT show a Federal OOS Order', () => {
  const w = boot();
  // authority active (no out_of_service_flag), but a vehicle CSA OOS alert is on
  w.renderSafetyChecklist({ carrierok: { out_of_service_flag: false, oos_alert_vehicle: true } });
  const html = w.document.getElementById('cp-safety-checklist').innerHTML;
  // the authority OOS row must be "None active"/na — authority is NOT out of service
  assert.match(html, /Federal Out-of-Service Order[\s\S]*?check-pill na/);
  // but the vehicle alert is surfaced separately as a caution/flag
  assert.match(html, /Vehicle\/Driver OOS Alert[\s\S]*?check-pill (warn|bad)/);
});

test('a real USDOT out-of-service DOES flag the Federal OOS Order row', () => {
  const w = boot();
  w.renderSafetyChecklist({ carrierok: { out_of_service_flag: true } });
  assert.match(w.document.getElementById('cp-safety-checklist').innerHTML,
    /Federal Out-of-Service Order[\s\S]*?check-pill bad/);
});

test('factored carrier does not flag bank-carrier state mismatch as fraud', () => {
  const w = boot();
  w.renderBankRouting({ vendor: { Factoring_Company: { ID: 'F1' } },
    bank: { has_bank_info: true, state_mismatch: true, carrier_state: 'OH', routing_region: 'CA', fedach_bank_name: 'JPMORGAN CHASE' } });
  // bank pill should NOT be Flag for a factored carrier's factor-lockbox mismatch
  const pill = w.document.getElementById('cp-acc-bank-pill');
  assert.doesNotMatch(pill.className, /flag/);
  // and the card explains it's the factor's account
  assert.match(w.document.getElementById('cp-bank-routing').innerHTML, /factor/i);
});

test('factored carrier: Bank section header pill is neutral (not green Clean, not Flag)', () => {
  const w = boot();
  w.renderBankRouting({ vendor: { Factoring_Company: { ID: 'F1' } },
    bank: { has_bank_info: true, is_factor_account: true, fedach_bank_name: 'JPMORGAN CHASE',
            state_mismatch: false, bad_actor: false, fingerprint_count: 64 } });
  const pill = w.document.getElementById('cp-acc-bank-pill');
  assert.doesNotMatch(pill.className, /flag/);
  assert.doesNotMatch(pill.className, /clean/);   // not green "Clean"
  assert.match(pill.textContent, /Factored/i);
});

test('direct-pay carrier with a real problem still flags the Bank header', () => {
  const w = boot();
  w.renderBankRouting({ vendor: {},
    bank: { has_bank_info: true, bad_actor: true, routing_present: true, routing_valid: true } });
  assert.match(w.document.getElementById('cp-acc-bank-pill').className, /flag/);
});

test('clean direct-pay carrier bank still shows green Clean', () => {
  const w = boot();
  w.renderBankRouting({ vendor: {},
    bank: { has_bank_info: true, bad_actor: false, state_mismatch: false, routing_present: true, routing_valid: true } });
  assert.match(w.document.getElementById('cp-acc-bank-pill').className, /clean/);
});

function _dfp(ipqs) {
  return { ipqs: Object.assign({ risk_level: 'High' }, ipqs), vendor: { Phone_Number: '+1', Email: 'x@y.com' } };
}

test('VOIP renders RED (bad), not amber, in the footprint', () => {
  const w = boot();
  w.renderDigitalFootprint(_dfp({ voip_number: true }));
  const html = w.document.getElementById('cp-digital-footprint').innerHTML;
  // the VOIP indicator pill is bad (red), never warn
  assert.match(html, /VOIP Number[\s\S]*?ind-pill bad/);
});

test('VPN/proxy and Tor at signup render red', () => {
  const w = boot();
  w.renderDigitalFootprint(_dfp({ vpn_detected: true }));
  assert.match(w.document.getElementById('cp-digital-footprint').innerHTML, /VPN[\s\S]*?ind-pill bad/i);
});

test('foreign signup IP renders red', () => {
  const w = boot();
  w.renderDigitalFootprint(_dfp({ ip_country: 'RS' }));   // Serbia, not US
  assert.match(w.document.getElementById('cp-digital-footprint').innerHTML, /IP Country[\s\S]*?ind-pill bad/);
});

test('every key signal has a hover tooltip (title)', () => {
  const w = boot();
  w.renderDigitalFootprint(_dfp({ voip_number: true }));
  const html = w.document.getElementById('cp-digital-footprint').innerHTML;
  // the ⓘ info marker carries a title explaining the signal
  assert.match(html, /class="ind-info" title="[^"]{20,}"/);
});

test('secondary signals are behind a Show-all expander, not front-loaded', () => {
  const w = boot();
  w.renderDigitalFootprint(_dfp({ ip_recent_abuse: true }));
  const el = w.document.getElementById('cp-digital-footprint');
  // a <details> expander exists
  assert.ok(el.querySelector('details'), 'show-all expander present');
  // "Recent IP Abuse" lives inside the expander, not the always-visible block
  assert.ok(el.querySelector('details').innerHTML.includes('Recent IP Abuse'));
});

test('clean footprint shows green, no red', () => {
  const w = boot();
  w.renderDigitalFootprint(_dfp({ voip_number: false, vpn_detected: false, ip_country: 'US', email_disposable: false, email_leaked: false }));
  const keyBlock = w.document.getElementById('cp-digital-footprint').querySelector('.indicators').innerHTML;
  assert.doesNotMatch(keyBlock, /ind-pill bad/);
});

test('authority age colors: <6mo red, 6-24mo amber, 24mo+ green', () => {
  const w = boot();
  function ageCls(days){
    w.renderAuthority({ carrierok: { authority_age_common_active: String(days), authority_common: 'Active' } });
    const m = w.document.getElementById('cp-authority').innerHTML.match(/Authority Age[\s\S]*?ind-pill (\w+)/);
    return m && m[1];
  }
  assert.equal(ageCls(120), 'bad');    // ~4 months
  assert.equal(ageCls(400), 'warn');   // ~13 months
  assert.equal(ageCls(1200), 'good');  // ~39 months
});

test('authority age neutral when no numeric age', () => {
  const w = boot();
  w.renderAuthority({ carrierok: { authority_common: 'Active' } });
  assert.match(w.document.getElementById('cp-authority').innerHTML, /Authority Age[\s\S]*?ind-pill neutral/);
});
