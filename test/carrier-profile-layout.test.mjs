import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const HTML = readFileSync(new URL('../carrier-profile.html', import.meta.url), 'utf8');
function boot(){ return new JSDOM(HTML, { runScripts:'dangerously', pretendToBeVisual:true }).window; }
function before(w, aId, bId){
  const a=w.document.getElementById(aId), b=w.document.getElementById(bId);
  assert.ok(a && b, aId+' and '+bId+' exist');
  return !!(a.compareDocumentPosition(b) & 4 /* DOCUMENT_POSITION_FOLLOWING */);
}

test('Documents sits above the pillar sections', () => {
  const w = boot();
  assert.ok(before(w,'cp-acc-docs','cp-acc-authority'), 'Documents before Authority');
  assert.ok(before(w,'cp-kpi-row','cp-acc-docs'), 'KPIs before Documents');
});
test('Documents accordion is auto-expanded (open)', () => {
  const w = boot();
  assert.ok(w.document.getElementById('cp-acc-docs').hasAttribute('open'));
});
test('Decision History and Your History sit below the evidence sections', () => {
  const w = boot();
  // NOTE: brief/id-anchor list referenced "cp-load-history", but the actual anchor in
  // carrier-profile.html for the "Your History With This Carrier" block is
  // "cp-acc-load-history" (matches the cp-acc-* naming convention of the other
  // accordions). Per task instructions ("Do NOT change any id="), the id was not
  // renamed to match the brief; the test targets the real id instead. Flagged in report.
  assert.ok(before(w,'cp-acc-crash','cp-acc-load-history'), 'crash before Your History');
  assert.ok(before(w,'cp-acc-authority','cp-decision-history'), 'Authority before Decision History');
});
