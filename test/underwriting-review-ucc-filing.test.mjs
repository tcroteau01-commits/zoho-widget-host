import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

// The UCC Filing card — the UCC-1 OperFi PLACES on a carrier. Distinct from the UCC Research card
// above it, which is the opposite question (liens already filed AGAINST them). The tests that
// matter most here are the ones proving a failed filing never reads as a filed one.

const html = fs.readFileSync(path.resolve('underwriting-review.html'), 'utf8');
function boot() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  return dom.window;
}

test('the filing card is its own card, not folded into UCC Research', () => {
  const w = boot();
  const titles = Array.from(w.document.querySelectorAll('.card-title')).map((t) =>
    t.childNodes[0].textContent.trim());
  assert.ok(titles.includes('UCC Filing'), 'UCC Filing card missing');
  assert.ok(titles.includes('UCC Research'), 'UCC Research card should still exist');
});

test('the debtor form carries every field from the Middesk modal', () => {
  const w = boot();
  for (const id of ['ucfOrgName', 'ucfStreet', 'ucfApt', 'ucfCity', 'ucfState', 'ucfZip',
                    'ucfFirstName', 'ucfLastName', 'ucfFileState', 'ucfCollateral']) {
    assert.ok(w.document.getElementById(id), `${id} missing`);
  }
  const types = Array.from(w.document.querySelectorAll('input[name="ucfType"]')).map((r) => r.value);
  assert.deepEqual(types, ['ORGANIZATION', 'INDIVIDUAL']);
});

test('the card captures and records — it never files', () => {
  // Filing is manual by decision (see docs/ops/MIDDESK_LIEN_FILING_API.md). Nothing in this
  // widget may call a filing endpoint; a stray button here would place real liens.
  const w = boot();
  assert.ok(w.document.getElementById('ucfSave'), 'save missing');
  assert.ok(w.document.getElementById('ucfCopy'), 'copy-details missing');
  assert.equal(w.document.getElementById('ucfFile'), null, 'a File button must not exist');
  assert.doesNotMatch(html, /\/ucc-file/);
  assert.doesNotMatch(html, /uccFileToken/);
});

test('the filing record fields exist so a real filing can be logged', () => {
  const w = boot();
  for (const id of ['ucfFileNumber', 'ucfFiledAt', 'ucfLapseAt']) {
    assert.ok(w.document.getElementById(id), `${id} missing`);
  }
});

test('only a file number marks the filing as real', () => {
  // Dates alone must not turn the card green — someone typing the date they intend to file on
  // would otherwise read as perfected.
  const w = boot();
  assert.equal(w.OFUW.uccIsFiled({ filedAt: '2026-08-07' }), false);
  assert.equal(w.OFUW.uccIsFiled({ fileNumber: '   ' }), false);
  assert.equal(w.OFUW.uccIsFiled({ fileNumber: 'OH-123' }), true);
  assert.equal(w.OFUW.uccIsFiled({}), false);
});

test('copy text carries every field the filing form asks for', () => {
  const w = boot();
  const txt = w.OFUW.uccCopyText({
    debtor: { type: 'ORGANIZATION', organization_name: 'SNM Logistics Group LLC',
              address: { address_line1: '1420 Industrial Pkwy', address_line2: 'Suite 200',
                         city: 'Columbus', state: 'OH', zip: '43201' } },
    states: ['OH'], collateral: 'All assets' });
  for (const bit of ['SNM Logistics Group LLC', '1420 Industrial Pkwy', 'Suite 200', 'Columbus',
                     'OH', '43201', 'All assets']) {
    assert.ok(txt.includes(bit), `copy text missing ${bit}`);
  }
});

test('copy text omits an empty apt line rather than printing a blank label', () => {
  const w = boot();
  const txt = w.OFUW.uccCopyText({ debtor: { organization_name: 'X', address: { city: 'Columbus' } }, states: ['OH'] });
  assert.ok(!txt.includes('Apt/Suite:'));
});

test('prefill splits the application address into the modal fields', () => {
  const w = boot();
  const d = w.OFUW.uccPrefillDebtor({
    application: { Business_Name: 'SNM Logistics Group LLC',
                   Physical_Address: '1420 Industrial Pkwy, Columbus, OH 43201' } });
  assert.equal(d.type, 'ORGANIZATION');
  assert.equal(d.organization_name, 'SNM Logistics Group LLC');
  assert.equal(d.address.address_line1, '1420 Industrial Pkwy');
  assert.equal(d.address.city, 'Columbus');
  assert.equal(d.address.state, 'OH');
  assert.equal(d.address.zip, '43201');
});

test('an unparseable address leaves the pieces blank rather than guessing', () => {
  // A wrong street on a UCC-1 is worse than an empty box the underwriter has to fill.
  const w = boot();
  const d = w.OFUW.uccPrefillDebtor({ application: { Business_Name: 'X', Physical_Address: 'somewhere in Ohio' } });
  assert.equal(d.address.address_line1, '');
  assert.equal(d.address.city, '');
  assert.equal(d.address.state, 'OH');   // still recovered from the free text
});

test('prefill falls back to DBA and survives a missing address', () => {
  const w = boot();
  const d = w.OFUW.uccPrefillDebtor({ application: { DBA: 'SNM' } });
  assert.equal(d.organization_name, 'SNM');
  assert.equal(d.address.address_line1, '');
  assert.equal(d.address.state, '');
});

test('debtor name resolves for both party types', () => {
  const w = boot();
  assert.equal(w.OFUW.uccDebtorName({ type: 'ORGANIZATION', organization_name: 'SNM LLC' }), 'SNM LLC');
  assert.equal(w.OFUW.uccDebtorName({ type: 'INDIVIDUAL', first_name: 'Sammy', last_name: 'Pardo' }), 'Sammy Pardo');
  assert.equal(w.OFUW.uccDebtorName({}), '');
});

// Values built inside the JSDOM realm have that realm's prototypes, so deepStrictEqual against a
// test-realm literal fails on identity alone. Compare structurally instead.
const keys = (o) => Object.keys(o).length;

test('a malformed stored blob degrades to empty instead of breaking the review', () => {
  const w = boot();
  assert.equal(keys(w.OFUW.parseUccFiling({ UCC_Filing: '{not json' })), 0);
  assert.equal(keys(w.OFUW.parseUccFiling({})), 0);
  assert.equal(keys(w.OFUW.parseUccFiling(null)), 0);
  assert.equal(w.OFUW.parseUccFiling({ UCC_Filing: '{"collateral":"All assets"}' }).collateral, 'All assets');
});

test('the review payload carries UCC_Filing separately from Manual_UCC', () => {
  // Manual_UCC is prior liens found against the carrier; UCC_Filing is ours. Same card would
  // have meant one field and a permanent ambiguity.
  const w = boot();
  const p = w.OFUW.buildReviewPayload({ uccFiling: { collateral: 'All assets' }, manualUcc: [{ securedParty: 'Other Lender' }] }, null);
  assert.equal(JSON.parse(p.UCC_Filing).collateral, 'All assets');
  assert.equal(JSON.parse(p.Manual_UCC)[0].securedParty, 'Other Lender');
});

// ── the DOM round-trip: render → type → read back ────────────────────────────────────
const MODEL = {
  application: { Business_Name: 'SNM Logistics Group LLC',
                 Physical_Address: '1420 Industrial Pkwy, Columbus, OH 43201' },
  owners: [{ First_Name1: 'Sammy', Last_Name1: 'Pardo' }],
  uccFiling: {}
};

test('rendering a blank filing prefills the form and defaults the filing state', () => {
  const w = boot();
  w.OFUW.renderUccFiling(MODEL);
  const $ = (id) => w.document.getElementById(id);
  assert.equal($('ucfOrgName').value, 'SNM Logistics Group LLC');
  assert.equal($('ucfStreet').value, '1420 Industrial Pkwy');
  assert.equal($('ucfCity').value, 'Columbus');
  assert.equal($('ucfZip').value, '43201');
  assert.equal($('ucfState').value, 'OH');
  assert.equal($('ucfFileState').value, 'OH');          // defaults to the entity's state
  assert.ok($('ucfStateLinks').innerHTML.includes('UCC Filing'), 'filing-office link missing');
  assert.equal($('uccFilingStatus').textContent, 'Not filed');
});

test('reading the form back returns what was rendered', () => {
  const w = boot();
  w.OFUW.renderUccFiling(MODEL);
  const f = w.OFUW.readUccFilingForm();
  assert.equal(f.debtor.organization_name, 'SNM Logistics Group LLC');
  assert.equal(f.debtor.address.city, 'Columbus');
  assert.deepEqual(Array.from(f.states), ['OH']);
  assert.equal(w.OFUW.uccIsFiled(f), false);
});

test('an unrelated re-render never discards unsaved typing', () => {
  // renderModel() fires on approving a document, adding an owner, running checks — each one
  // re-renders every card. This wiped a corrected legal name and a typed file number.
  const w = boot();
  const $ = (id) => w.document.getElementById(id);
  w.OFUW.renderUccFiling(MODEL);
  $('ucfOrgName').value = 'SNM LOGISTICS GROUP, LLC';   // the legal name the STATE has
  $('ucfFileNumber').value = 'OH-2026-889';
  for (let i = 0; i < 5; i++) w.OFUW.renderUccFiling(MODEL);
  assert.equal($('ucfOrgName').value, 'SNM LOGISTICS GROUP, LLC');
  assert.equal($('ucfFileNumber').value, 'OH-2026-889');
  // the pill must describe what's on screen, not the stale stored blob
  assert.equal($('uccFilingStatus').textContent, 'Filed · OH-2026-889');
});

test('an untouched card still repaints when the model changes', () => {
  // The guard must not over-correct into "never update again".
  const w = boot();
  w.OFUW.renderUccFiling(MODEL);
  w.OFUW.renderUccFiling({ ...MODEL, uccFiling: {
    debtor: { organization_name: 'Renamed LLC', address: { city: 'Columbus', state: 'OH' } }, states: ['OH'] } });
  assert.equal(w.document.getElementById('ucfOrgName').value, 'Renamed LLC');
});

test('a forced repaint (type switch / owner pick / save) does rewrite the fields', () => {
  const w = boot();
  const $ = (id) => w.document.getElementById(id);
  w.OFUW.renderUccFiling(MODEL);
  $('ucfOrgName').value = 'typed over';
  w.OFUW.renderUccFiling({ ...MODEL, uccFiling: {
    debtor: { type: 'INDIVIDUAL', first_name: 'Sammy', last_name: 'Pardo' } } }, true);
  assert.equal($('ucfIndWrap').style.display, '');
  assert.equal($('ucfOrgWrap').style.display, 'none');
  assert.equal($('ucfFirstName').value, 'Sammy');
});

test('a stored filing paints its file number and reads as filed on load', () => {
  const w = boot();
  w.OFUW.renderUccFiling({ ...MODEL, uccFiling: {
    debtor: { organization_name: 'X', address: { city: 'Columbus', state: 'OH' } },
    states: ['OH'], fileNumber: 'OH-777' } });
  assert.equal(w.document.getElementById('ucfFileNumber').value, 'OH-777');
  assert.equal(w.document.getElementById('uccFilingStatus').textContent, 'Filed · OH-777');
});

test('the filing card does not reuse the broken row2 selector', () => {
  // `.fld .row2` is a descendant rule but the markup uses `class="fld row2"` on one element, so it
  // never matches. The new card ships its own rules rather than inheriting that.
  assert.match(html, /\.ucf-row3\s*\{[^}]*display:\s*grid/);
  assert.doesNotMatch(html, /id="ucfIndWrap"[^>]*class="fld row2"/);
});
