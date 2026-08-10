import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

// The address is four boxes at intake now, but what SHIPS is still the single joined string —
// Physical_Address / Mailing_Address / the owner's Address, in the exact shape the backend's
// _agr_split_address, _split_us_address, the UCC card regex and the sales pipeline already parse.
// Nothing in Creator changed, so the join is the whole contract. That is what this file pins.

const html = fs.readFileSync(path.resolve('client-onboarding.html'), 'utf8');
function boot() {
  return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true }).window;
}
// initDom() runs on 'load', so anything driven by a listener (Add another owner, the
// same-as-physical chip) needs the booted window, not the freshly parsed one.
function booted() {
  const w = boot();
  return new Promise((res) => w.addEventListener('load', () => res(w)));
}
// readState drops owners with no name, so an owner under test needs one.
function nameOwner(blk, first = 'Test', last = 'Owner') {
  blk.querySelector('[data-of="first"]').value = first;
  blk.querySelector('[data-of="last"]').value = last;
  return blk;
}
function fill(w, sel, vals) {
  const g = w.document.querySelector(sel);
  Object.entries(vals).forEach(([k, v]) => {
    const e = g.querySelector(`[data-addr-part="${k}"]`);
    assert.ok(e, `${sel} has no ${k} box`);
    e.value = v;
  });
  return g;
}

test('the join reproduces the one-line shape the backend parses', () => {
  const w = boot();
  assert.equal(w.OF.joinAddressParts('123 Main St', 'Glendale', 'AZ', '85301'),
               '123 Main St, Glendale, AZ 85301');
});

test('the join skips missing parts instead of leaving stray commas', () => {
  // A dangling ", ," would be parsed downstream as a real (empty) city.
  const w = boot();
  assert.equal(w.OF.joinAddressParts('123 Main St', '', '', ''), '123 Main St');
  assert.equal(w.OF.joinAddressParts('123 Main St', 'Glendale', '', ''), '123 Main St, Glendale');
  assert.equal(w.OF.joinAddressParts('123 Main St', 'Glendale', 'AZ', ''), '123 Main St, Glendale, AZ');
  assert.equal(w.OF.joinAddressParts('', '', '', ''), '');
});

test('the join trims and upper-cases the state', () => {
  const w = boot();
  assert.equal(w.OF.joinAddressParts('  123 Main St ', ' Glendale ', ' az ', ' 85301 '),
               '123 Main St, Glendale, AZ 85301');
});

test('reading a group returns the parts AND the joined string', () => {
  const w = boot();
  fill(w, '[data-addr="physical"]',
       { street: '123 Main St', city: 'Glendale', state: 'AZ', zip: '85301' });
  const g = w.OF.readAddressGroup(w.document.querySelector('[data-addr="physical"]'));
  assert.equal(g.city, 'Glendale');
  assert.equal(g.joined, '123 Main St, Glendale, AZ 85301');
});

test('a missing container reads as empty rather than throwing', () => {
  const w = boot();
  const g = w.OF.readAddressGroup(null);
  assert.equal(g.joined, '');
  assert.equal(w.OF.addressGroupEmpty(g), true);
});

test('complete means all four, empty means none — half is neither', () => {
  const w = boot();
  const half = { street: '123 Main St', city: 'Glendale', state: '', zip: '' };
  assert.equal(w.OF.addressGroupComplete(half), false);
  assert.equal(w.OF.addressGroupEmpty(half), false, 'a half address must not read as "not entered"');
  assert.equal(w.OF.addressGroupComplete({ street: 'a', city: 'b', state: 'c', zip: 'd' }), true);
  assert.equal(w.OF.addressGroupEmpty({ street: '', city: '', state: '', zip: '' }), true);
});

test('the owner group spans the whole block, not just the street row', () => {
  // city/state/zip sit in a SIBLING row of the street field. Marking only the street's field div
  // would make closest('[data-addr]') find a group of one, and the other three would be invisible
  // to both the autocomplete fan-out and the step gate.
  const w = boot();
  const street = w.document.querySelector('#ownerList .owner-block [data-of="address"]');
  const grp = street.closest('[data-addr]');
  ['street', 'city', 'state', 'zip'].forEach((n) => {
    assert.ok(grp.querySelector(`[data-addr-part="${n}"]`), `${n} outside the owner group`);
  });
});

test('an owner added on the fly gets the same group marker as owner 1', async () => {
  const w = await booted();
  w.document.getElementById('addOwner').click();
  const blocks = w.document.querySelectorAll('#ownerList .owner-block');
  assert.ok(blocks.length > 1, 'no owner was added');
  const added = blocks[blocks.length - 1];
  assert.equal(added.getAttribute('data-addr'), 'owner');
  ['street', 'city', 'state', 'zip'].forEach((n) => {
    assert.ok(added.querySelector(`[data-addr-part="${n}"]`), `${n} missing on the added owner`);
  });
});

test('the payload still carries one joined string per address', () => {
  // The point of the whole change: four boxes for the applicant, unchanged data for Creator.
  const w = boot();
  fill(w, '[data-addr="physical"]',
       { street: '123 Main St', city: 'Glendale', state: 'AZ', zip: '85301' });
  const blk = nameOwner(w.document.querySelector('#ownerList .owner-block'));
  ['street', 'city', 'state', 'zip'].forEach((n, i) => {
    blk.querySelector(`[data-addr-part="${n}"]`).value = ['9 Elm Ave', 'Phoenix', 'AZ', '85004'][i];
  });
  const s = w.OF.readState();
  assert.equal(s.physicalAddress, '123 Main St, Glendale, AZ 85301');
  assert.equal(s.mailingAddress, s.physicalAddress, 'the "same as physical" chip starts selected');
  assert.equal(s.owners[0].address, '9 Elm Ave, Phoenix, AZ 85004');

  const p = w.OF.buildApplicationPayload(s);
  assert.equal(p.Physical_Address, '123 Main St, Glendale, AZ 85301');
  assert.equal(p.Mailing_Address, '123 Main St, Glendale, AZ 85301');
});

test('a separate mailing address is read from its own group', async () => {
  const w = await booted();
  fill(w, '[data-addr="physical"]',
       { street: '123 Main St', city: 'Glendale', state: 'AZ', zip: '85301' });
  fill(w, '[data-addr="mailing"]',
       { street: 'PO Box 7', city: 'Phoenix', state: 'AZ', zip: '85004' });
  w.document.getElementById('sameAddrChip').click();   // un-select "same as physical"
  const s = w.OF.readState();
  assert.equal(s.sameAddress, false);
  assert.equal(s.mailingAddress, 'PO Box 7, Phoenix, AZ 85004');
});

test('validation rejects a half address and names the field', () => {
  const w = boot();
  fill(w, '[data-addr="physical"]', { street: '123 Main St', city: '', state: '', zip: '' });
  const errs = w.OF.validateAll(w.OF.readState()).errors.filter((e) => e.field === 'opPhysical');
  assert.equal(errs.length, 1, JSON.stringify(errs));
  assert.match(errs[0].msg, /street, city, state and ZIP/);
});

test('an empty physical address is still "required", not "incomplete"', () => {
  const w = boot();
  const errs = w.OF.validateAll(w.OF.readState()).errors.filter((e) => e.field === 'opPhysical');
  assert.equal(errs.length, 1);
  assert.match(errs[0].msg, /required/);
});

test('a completely blank owner address is allowed — it is optional', () => {
  const w = boot();
  fill(w, '[data-addr="physical"]',
       { street: '123 Main St', city: 'Glendale', state: 'AZ', zip: '85301' });
  nameOwner(w.document.querySelector('#ownerList .owner-block'));
  const errs = w.OF.validateAll(w.OF.readState()).errors.filter((e) => e.field === 'owner');
  assert.equal(errs.filter((e) => /address/i.test(e.msg)).length, 0);
});

test('a HALF owner address is rejected — it prints blank in the guaranty block', () => {
  const w = boot();
  const blk = nameOwner(w.document.querySelector('#ownerList .owner-block'));
  blk.querySelector('[data-addr-part="street"]').value = '9 Elm Ave';
  const s = w.OF.readState();
  assert.equal(w.OF.addressGroupComplete(s.owners[0].addressParts), false);
  const msgs = w.OF.validateAll(s).errors.map((e) => e.msg).join(' ');
  assert.match(msgs, /Owner 1's address: enter street, city, state and ZIP\./);
});

// ── Places autocomplete ──────────────────────────────────────────────────────────────
// The proxy has always returned {street, city, state, zip}; the widget used to join them and throw
// the parts away. Now they fan out to the four boxes, which is the whole reason the split is free.
function withPlaces(detail) {
  const w = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.fetch = (url) => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(String(url).includes('place-details')
          ? detail
          : { predictions: [{ place_id: 'p1', description: '123 Main St, Glendale, AZ, USA' }] })
      });
    }
  }).window;
  return new Promise((res) => w.addEventListener('load', () => res(w)));
}
async function pick(w, id) {
  const input = w.document.getElementById(id);
  input.value = '123 Main';
  input.dispatchEvent(new w.Event('input'));
  await new Promise((r) => setTimeout(r, 350));          // the query is debounced
  const opt = input.closest('.field').querySelector('.ac-menu div');
  assert.ok(opt, 'no prediction rendered');
  opt.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 50));
}

test('picking a prediction fills all four boxes, not just the street', async () => {
  const w = await withPlaces({ street: '123 Main St', city: 'Glendale', state: 'az', zip: '85301' });
  await pick(w, 'opPhysical');
  const g = w.OF.readAddressGroup(w.document.querySelector('[data-addr="physical"]'));
  assert.equal(g.street, '123 Main St');
  assert.equal(g.city, 'Glendale');
  assert.equal(g.state, 'AZ', 'the state box is two upper-case letters');
  assert.equal(g.zip, '85301');
  assert.equal(g.joined, '123 Main St, Glendale, AZ 85301');
});

test('a pick clears parts the new place does not have', async () => {
  // Otherwise the previous address's ZIP survives under the new street and nothing looks wrong.
  const w = await withPlaces({ street: '9 Elm Ave', city: 'Phoenix', state: 'AZ', zip: '' });
  fill(w, '[data-addr="physical"]',
       { street: 'old', city: 'Glendale', state: 'AZ', zip: '85301' });
  await pick(w, 'opPhysical');
  const g = w.OF.readAddressGroup(w.document.querySelector('[data-addr="physical"]'));
  assert.equal(g.street, '9 Elm Ave');
  assert.equal(g.zip, '', 'the stale ZIP should be gone');
});

test('a details response with no parts falls back to the single-line text', async () => {
  const w = await withPlaces({ formatted: '123 Main St, Glendale, AZ 85301' });
  await pick(w, 'opPhysical');
  assert.equal(w.document.getElementById('opPhysical').value, '123 Main St, Glendale, AZ 85301');
});
