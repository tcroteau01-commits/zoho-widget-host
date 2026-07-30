import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('carrier-profile.html'), 'utf8');
function boot() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  return dom.window;
}

test('mapsHref builds an encoded Google Maps deep-link, "" when empty', () => {
  const w = boot();
  assert.match(w.mapsHref('123 Main St, Phoenix, AZ 85001'), /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  assert.ok(w.mapsHref('123 Main St, Phoenix, AZ').includes(encodeURIComponent('123 Main St, Phoenix, AZ')));
  assert.strictEqual(w.mapsHref(''), '');
  assert.strictEqual(w.mapsHref('   '), '');
});

test('saferHref deep-links by DOT, "" when no DOT', () => {
  const w = boot();
  const u = w.saferHref('3455916');
  assert.match(u, /safer\.fmcsa\.dot\.gov\/query\.asp/);
  assert.ok(u.includes('query_string=3455916'));
  assert.strictEqual(w.saferHref(''), '');
});

// ── Carrier full-address in hero (points maps link at the real street address) ──
test('_carrierFullAddress prefers fmcsa physical_address', () => {
  const w = boot();
  assert.strictEqual(
    w._carrierFullAddress({ physical_address: '3552 GREEN AVE, LOS ALAMITOS, CA 90720-3243' }, {}),
    '3552 GREEN AVE, LOS ALAMITOS, CA 90720-3243');
});

test('_carrierFullAddress composes from parts when no assembled address', () => {
  const w = boot();
  assert.strictEqual(
    w._carrierFullAddress({ physical_address_street: '123 Main St', physical_address_city: 'Phoenix',
                            physical_address_state: 'AZ', physical_address_zip_code: '85001' }, {}),
    '123 Main St, Phoenix, AZ 85001');
});

test('_carrierFullAddress falls back to city/state (with vendor state) and returns "" when empty', () => {
  const w = boot();
  assert.strictEqual(w._carrierFullAddress({ physical_address_city: 'Dallas' }, { Physical_State: 'TX' }), 'Dallas, TX');
  assert.strictEqual(w._carrierFullAddress({}, {}), '');
});

test('renderHero shows the full street address and links maps to it', () => {
  const w = boot();
  w.renderHero({ vendor: { Vendor_Name: 'X', MC: '1', USDOT: '2' },
                 carrierok: { physical_address: '3552 GREEN AVE, LOS ALAMITOS, CA 90720-3243' } });
  const html = w.document.querySelector('#cp-hero .hero-meta').innerHTML;
  assert.ok(html.includes('3552 GREEN AVE'), 'shows the street address, not just city/state');
  assert.ok(html.includes(encodeURIComponent('3552 GREEN AVE, LOS ALAMITOS, CA 90720-3243')), 'maps link targets the full address');
});
