import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

// The Decision panel's checkboxes mirror the REVIEW SECTIONS an underwriter works through, replacing
// the old Authority / Ownership / UCC trio. Nothing pinned computeGate or validateDecision before
// this file, which is why the swap could have gone out silently wrong.

const html = fs.readFileSync(path.resolve('underwriting-review.html'), 'utf8');
function boot() {
  return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true }).window;
}
const ALL = (w) => Object.fromEntries(w.OFUW.REVIEW_SECTIONS.map((s) => [s.key, true]));

test('the seven section checkboxes exist, in page order', () => {
  const w = boot();
  // join() rather than deepEqual: arrays built inside the JSDOM realm carry that realm's
  // prototypes, so deepStrictEqual fails on identity alone even when the contents match.
  const labels = w.OFUW.REVIEW_SECTIONS.map((s) => s.label).join(' | ');
  assert.equal(labels, ['Submitted Application', 'Ownership & Entity', 'Owner Details',
                        'Trusted Contacts', 'Clientele', 'Related Businesses', 'UCC Filing'].join(' | '));
  w.OFUW.REVIEW_SECTIONS.forEach((s) => {
    assert.ok(w.document.getElementById(s.toggle), `${s.toggle} missing from the DOM`);
  });
});

test('the replaced toggles are gone entirely', () => {
  // Leaving a stray tgAuthority behind would look wired but write nothing.
  const w = boot();
  for (const id of ['tgAuthority', 'tgOwnership', 'tgUcc']) {
    assert.equal(w.document.getElementById(id), null, `${id} should no longer exist`);
  }
});

test('sections gate counts only when all seven are ticked', () => {
  const w = boot();
  const ctx = { docsReceived: 5, docsRequired: 5, fraudBad: 0 };
  const base = { approvedCreditLimit: '30000' };

  const none = w.OFUW.computeGate({ ...base, sectionReview: {} }, ctx);
  assert.equal(none.sectionsReviewed, false);
  assert.equal(none.sectionsDone, 0);
  assert.equal(none.sectionsTotal, 7);

  const partial = w.OFUW.computeGate({ ...base, sectionReview: { application: true, owners: true } }, ctx);
  assert.equal(partial.sectionsReviewed, false);
  assert.equal(partial.sectionsDone, 2);

  const all = w.OFUW.computeGate({ ...base, sectionReview: ALL(w) }, ctx);
  assert.equal(all.sectionsReviewed, true);
  assert.equal(all.allPass, true);
  assert.equal(all.passedCount, 4);          // 4 gates now, not 5
});

test('the derived gates still work independently of the checkboxes', () => {
  const w = boot();
  const s = { approvedCreditLimit: '30000', sectionReview: ALL(w) };
  assert.equal(w.OFUW.computeGate(s, { docsReceived: 2, docsRequired: 5, fraudBad: 0 }).intakePacket, false);
  assert.equal(w.OFUW.computeGate(s, { docsReceived: 5, docsRequired: 5, fraudBad: 1 }).fraudClear, false);
  assert.equal(w.OFUW.computeGate({ ...s, approvedCreditLimit: '' },
                                  { docsReceived: 5, docsRequired: 5, fraudBad: 0 }).creditDocumented, false);
});

test('approving names the sections still outstanding', () => {
  // "some checkbox is unticked" would make the underwriter hunt for which one.
  const w = boot();
  const ctx = { docsReceived: 5, docsRequired: 5, fraudBad: 0 };
  const r = w.OFUW.validateDecision(
    { decision: 'Approved', approvedCreditLimit: '30000', sectionReview: { application: true } }, ctx);
  assert.equal(r.ok, false);
  const msg = r.errors.join(' ');
  assert.ok(msg.includes('Owner Details'), msg);
  assert.ok(msg.includes('Clientele'), msg);
  assert.ok(!msg.includes('Submitted Application'), 'the ticked one must not be listed');
});

test('approving passes once every section is ticked', () => {
  const w = boot();
  const r = w.OFUW.validateDecision(
    { decision: 'Approved', approvedCreditLimit: '30000', sectionReview: ALL(w) },
    { docsReceived: 5, docsRequired: 5, fraudBad: 0 });
  assert.equal(r.ok, true, r.errors.join(' '));
});

test('a stored blob is parsed back, and a malformed one degrades quietly', () => {
  const w = boot();
  assert.equal(w.OFUW.parseSectionReview({ Section_Review: '{"owners":true}' }).owners, true);
  assert.equal(Object.keys(w.OFUW.parseSectionReview({ Section_Review: '{not json' })).length, 0);
  assert.equal(Object.keys(w.OFUW.parseSectionReview({})).length, 0);
  assert.equal(Object.keys(w.OFUW.parseSectionReview(null)).length, 0);
});

test('the review payload carries Section_Review and drops the superseded booleans', () => {
  const w = boot();
  const p = w.OFUW.buildReviewPayload({ sectionReview: { owners: true, clientele: true } }, null);
  assert.equal(JSON.parse(p.Section_Review).owners, true);
  for (const dead of ['Authority_Verified', 'Ownership_Verified', 'UCC_Checked']) {
    assert.ok(!(dead in p), `${dead} should no longer be written`);
  }
});

test('an empty sectionReview still writes valid JSON, not undefined', () => {
  // A blank blob must round-trip as {} — otherwise the field stores "undefined" and the next
  // parse silently yields nothing.
  const w = boot();
  const p = w.OFUW.buildReviewPayload({}, null);
  assert.equal(p.Section_Review, '{}');
});
