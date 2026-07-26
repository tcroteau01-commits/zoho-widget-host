import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('carrier-profile.html'), 'utf8');
function boot() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  return dom.window;
}

test('decision boxes no longer render a description line', () => {
  const w = boot();
  const descs = w.document.querySelectorAll('#cp-decision-options .decision-option-desc');
  assert.equal(descs.length, 0);
});

test('decision boxes still expose an icon + name for all four decisions, in order', () => {
  const w = boot();
  const opts = w.document.querySelectorAll('#cp-decision-options .decision-option');
  assert.equal(opts.length, 4);
  const names = Array.from(opts).map((o) => o.querySelector('.decision-option-name').textContent);
  assert.deepEqual(names, ['Approve', 'Approve with Caution', 'Hold', 'Decline']);
  opts.forEach((o) => assert.ok(o.querySelector('.decision-option-icon'), 'icon missing'));
});

test('each decision box keeps its data-decision attribute for click wiring', () => {
  const w = boot();
  const opts = w.document.querySelectorAll('#cp-decision-options .decision-option');
  const decisions = Array.from(opts).map((o) => o.getAttribute('data-decision'));
  assert.deepEqual(decisions, ['Approve', 'Approve with Caution', 'Hold', 'Decline']);
});

test('.decision-option-desc CSS rule is removed and remaining boxes get more vertical padding', () => {
  assert.doesNotMatch(html, /\.decision-option-desc\s*\{/);
  assert.match(html, /\.decision-option\s*\{[^}]*padding:\s*20px 10px;/);
  assert.match(html, /\.decision-option-name\s*\{[^}]*font-size:\s*14px;/);
});

test('.decision-option top-aligns its content instead of vertically centering, so a wrapped title (e.g. "Approve with Caution") cannot push its icon out of line with the other boxes', () => {
  assert.match(html, /\.decision-option\s*\{[^}]*align-items:\s*center;/);
  assert.doesNotMatch(html, /\.decision-option\s*\{[^}]*justify-content:\s*center;/);
});

test('.decision-option sets min-width: 0 so its longest label (e.g. "Approve with Caution") cannot force its grid column wider than the other three equal 1fr columns', () => {
  assert.match(html, /\.decision-option\s*\{[^}]*min-width:\s*0;/);
});

test('each decision box carries its removed explanation as a data-tooltip and a title attribute (hover bubble + mobile/screen-reader fallback)', () => {
  const w = boot();
  const opts = w.document.querySelectorAll('#cp-decision-options .decision-option');
  const expected = [
    'Clean profile, normal use.',
    'Saw flags, accepting risk. Notes required.',
    'Need more info. Pauses use.',
    "Won't use. Adds to your DNU list.",
  ];
  const tooltips = Array.from(opts).map((o) => o.getAttribute('data-tooltip'));
  const titles = Array.from(opts).map((o) => o.getAttribute('title'));
  assert.deepEqual(tooltips, expected);
  assert.deepEqual(titles, expected);
});

test('the hover tooltip bubble is CSS-only: hidden by default, revealed on :hover, sourced from data-tooltip', () => {
  assert.match(html, /\.decision-option::after\s*\{[^}]*content:\s*attr\(data-tooltip\);/);
  assert.match(html, /\.decision-option::after\s*\{[^}]*opacity:\s*0;/);
  assert.match(html, /\.decision-option:hover::after,\s*\.decision-option:hover::before\s*\{[^}]*opacity:\s*1;/);
});

// ── CAVRA3 Phase 2C: forced doc-view gate ──────────────────────────────────
function _p(overrides) {
  return Object.assign({ account_vendor: { av_id: '1' }, vendor: {}, bank: { has_bank_info: false } }, overrides || {});
}

test('COI item is locked while a COI is on file but unopened', () => {
  const w = boot();
  w.profilePayload = { account_vendor: { av_id: '1' } };
  w.renderChecklist(_p());
  w.cpDocTypesOnFile = { coi: true };
  w.cpViewedTypes = {};
  w.cpApplyForcedGates();
  const coi = w.document.querySelector('.cp-check-item[data-key="Checklist_COI_Truck_Driver"]');
  assert.equal(coi.disabled, true);
  const hint = w.document.querySelector('.cp-check-hint[data-hint-for="Checklist_COI_Truck_Driver"]');
  assert.match(hint.textContent, /open the coi/i);
});

test('opening the COI (viewed) releases the lock', () => {
  const w = boot();
  w.profilePayload = { account_vendor: { av_id: '1' } };
  w.renderChecklist(_p());
  w.cpDocTypesOnFile = { coi: true };
  w.cpViewedTypes = { coi: true };
  w.cpApplyForcedGates();
  const coi = w.document.querySelector('.cp-check-item[data-key="Checklist_COI_Truck_Driver"]');
  assert.equal(coi.disabled, false);
  const hint = w.document.querySelector('.cp-check-hint[data-hint-for="Checklist_COI_Truck_Driver"]');
  assert.equal(hint.textContent.trim(), '');
});

test('no COI on file leaves the item checkable (attest, never blocks)', () => {
  const w = boot();
  w.profilePayload = { account_vendor: { av_id: '1' } };
  w.renderChecklist(_p());
  w.cpDocTypesOnFile = {};   // nothing on file
  w.cpViewedTypes = {};
  w.cpApplyForcedGates();
  const coi = w.document.querySelector('.cp-check-item[data-key="Checklist_COI_Truck_Driver"]');
  assert.equal(coi.disabled, false);
});

test('bank item gate applies only when the bank item is shown', () => {
  const w = boot();
  w.profilePayload = { account_vendor: { av_id: '1' } };
  // _checklistApplies true (no bank info) → bank item present
  w.renderChecklist(_p({ bank: { has_bank_info: false } }));
  w.cpDocTypesOnFile = { banking: true };
  w.cpViewedTypes = {};
  w.cpApplyForcedGates();
  const bank = w.document.querySelector('.cp-check-item[data-key="Checklist_Bank_Letter_Verified"]');
  assert.ok(bank, 'bank item shown when _checklistApplies');
  assert.equal(bank.disabled, true);
});

test('Select-All does not tick a locked item', () => {
  const w = boot();
  w.profilePayload = { account_vendor: { av_id: '1' } };
  w.renderChecklist(_p());
  w.cpDocTypesOnFile = { coi: true };
  w.cpViewedTypes = {};
  w.cpApplyForcedGates();
  const all = w.document.getElementById('cp-check-all');
  all.checked = true;
  all.onchange();
  const coi = w.document.querySelector('.cp-check-item[data-key="Checklist_COI_Truck_Driver"]');
  assert.equal(coi.checked, false, 'locked COI item stays unchecked under Select-All');
  // a non-gated item does get ticked
  const auth = w.document.querySelector('.cp-check-item[data-key="Checklist_Authority_Active"]');
  assert.equal(auth.checked, true);
});

test('a locked COI keeps the checklist incomplete (decision stays gated)', () => {
  const w = boot();
  w.profilePayload = { account_vendor: { av_id: '1' } };
  w.renderChecklist(_p());
  w.cpDocTypesOnFile = { coi: true };
  w.cpViewedTypes = {};
  w.cpApplyForcedGates();
  // tick every ENABLED item via Select-All
  const all = w.document.getElementById('cp-check-all'); all.checked = true; all.onchange();
  assert.equal(w.checklistComplete(), false, 'cannot complete while COI locked');
});
