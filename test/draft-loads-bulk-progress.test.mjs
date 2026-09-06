// FANOUT2. Progress readouts for the now-throttled bulk actions.
//
// Bounding concurrency did not make these operations slower in real terms --
// the old all-at-once version spent the same wall clock with requests queued up
// to 40s each. It made them HONEST about it. Honest and silent is worse than
// fast-looking: a 50-row import is ~25s of nothing, and a user who sees nothing
// clicks Create again. That second click is exactly what the re-entry guard now
// has to catch, so showing the count is what stops the problem at the source.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../draft-loads.html', import.meta.url), 'utf8');

function boot() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  dom.window.brokerEmail = 'broker@acme.com';
  return dom.window;
}

const range = (n) => Array.from({ length: n }, (_, i) => i);

function host(w, id) {
  const el = w.document.createElement('div');
  el.id = id;
  w.document.body.appendChild(el);
  return el;
}

// --- mapLimit reports progress ----------------------------------------------

test('progress is reported once per completed item, in order', async () => {
  const w = boot();
  const seen = [];
  await w.mapLimit(range(6), 2, (i) => i, (done, total) => seen.push([done, total]));
  assert.deepStrictEqual(seen.map((s) => s[0]), [1, 2, 3, 4, 5, 6]);
  assert.ok(seen.every((s) => s[1] === 6));
});

test('the final callback says done === total', async () => {
  const w = boot();
  let last = null;
  await w.mapLimit(range(9), 4, (i) => i, (done, total) => { last = [done, total]; });
  assert.deepStrictEqual(last, [9, 9]);
});

test('a throwing progress callback cannot fail the batch', async () => {
  // Progress is decoration. A bad selector in the reporter must never lose a
  // broker's import.
  const w = boot();
  const out = await w.mapLimit(range(4), 2, (i) => 'r' + i, () => { throw new Error('bad'); });
  assert.deepStrictEqual(Array.from(out), ['r0', 'r1', 'r2', 'r3']);
});

test('omitting the callback still works', async () => {
  const w = boot();
  assert.strictEqual((await w.mapLimit(range(3), 2, (i) => i)).length, 3);
});

// --- the readout itself ------------------------------------------------------

test('renders the count and advances the bar', () => {
  const w = boot();
  host(w, 'x');
  w.renderBulkProgress('x', 'Creating', 12, 50);
  const el = w.document.getElementById('x');
  assert.match(el.textContent, /Creating\s*12 of 50/);
  assert.strictEqual(el.querySelector('.bar').style.width, '24%');
});

test('the bar element is reused, not rebuilt, between ticks', () => {
  // Rewriting innerHTML each tick restarts the CSS width transition, so the bar
  // never actually animates -- it just snaps, or sits at zero.
  const w = boot();
  host(w, 'x');
  w.renderBulkProgress('x', 'Creating', 1, 50);
  const first = w.document.getElementById('x').querySelector('.bar');
  w.renderBulkProgress('x', 'Creating', 2, 50);
  assert.strictEqual(w.document.getElementById('x').querySelector('.bar'), first);
});

test('a small batch stays silent', () => {
  // Below the threshold the work finishes about as fast as the bar renders, and
  // the flicker reads as a glitch.
  const w = boot();
  host(w, 'x');
  w.renderBulkProgress('x', 'Creating', 1, 3);
  assert.strictEqual(w.document.getElementById('x').innerHTML, '');
  assert.strictEqual(w.bulkProgress('x', 'Creating', 3), null);
});

test('a batch at the threshold does report', () => {
  const w = boot();
  host(w, 'x');
  const fn = w.bulkProgress('x', 'Creating', w.BULK_PROGRESS_MIN);
  assert.strictEqual(typeof fn, 'function');
  assert.match(w.document.getElementById('x').textContent, /0 of 5/);
});

test('a missing element is not an error', () => {
  const w = boot();
  w.renderBulkProgress('nope', 'Creating', 1, 50);
  assert.strictEqual(w.bulkProgress('nope', 'Creating', 50).length, 2);
});

test('the verb is escaped, not injected', () => {
  const w = boot();
  host(w, 'x');
  w.renderBulkProgress('x', '<img src=x onerror=alert(1)>', 1, 50);
  assert.strictEqual(w.document.getElementById('x').querySelector('img'), null);
});

// --- the import button -------------------------------------------------------

test('the create button is disabled and relabelled while it runs', async () => {
  const w = boot();
  const btn = w.document.createElement('button');
  btn.id = 'imp-create';
  btn.textContent = 'Create 40 drafts';
  w.document.body.appendChild(btn);
  host(w, 'imp-summary');

  w.creatableRows = () => range(40).map((i) => ({ mapped: { customer_reference_number: 'R' + i } }));
  // EVERY in-flight request needs its own resolver. Keeping only the last one
  // leaves BULK_WRITE_CONCURRENCY-1 promises pending forever and the test hangs
  // rather than fails -- which is exactly what it did the first time.
  const pending = [];
  w.fetch = () => new Promise((res) => { pending.push(res); });
  w.closeModal = () => {};
  w.openPaperwork = () => {};
  w.showToast = () => {};

  const running = w.createDraftsFromPreview();
  await new Promise((r) => w.setTimeout(r, 0));
  assert.strictEqual(btn.disabled, true, 'button stayed clickable during the run');
  assert.match(btn.textContent, /Creating/);

  // Drain: each resolution frees a slot, which starts another request.
  for (let i = 0; i < 200 && pending.length; i++) {
    pending.splice(0).forEach((res) => res({ ok: false }));
    await new Promise((r) => w.setTimeout(r, 0));
  }
  await running;
});

test('the button label is restored, not left saying Creating', async () => {
  const w = boot();
  const btn = w.document.createElement('button');
  btn.id = 'imp-create';
  btn.textContent = 'Create 6 drafts';
  w.document.body.appendChild(btn);
  host(w, 'imp-summary');

  w.creatableRows = () => range(6).map((i) => ({ mapped: {} }));
  w.fetch = () => Promise.resolve({ ok: false });
  w.closeModal = () => {};
  w.openPaperwork = () => {};
  w.showToast = () => {};

  await w.createDraftsFromPreview();
  assert.strictEqual(btn.textContent, 'Create 6 drafts');
  assert.strictEqual(btn.disabled, false);
  assert.strictEqual(w.__creatingDrafts, false, 'the re-entry guard was never released');
});

// --- every throttled site reports --------------------------------------------

test('each mapLimit call site passes a progress reporter', () => {
  // A throttled action with no readout is the silent wait this exists to remove.
  // This caught the inline "apply to all matching rows" path, which was
  // throttled with the other six and reported nothing.
  const callSites = html.replace(/function mapLimit\([^)]*\)/, '');
  const calls = [...callSites.matchAll(/mapLimit\(/g)];
  const reported = [...callSites.matchAll(
    /(?:\}|\)),\s*\n?\s*(?:onProg|bulkProgress\(|toastProgress\()/g)];
  assert.strictEqual(reported.length, calls.length,
    `${calls.length} throttled sites but ${reported.length} report progress`);
});

test('the toast reporter suppresses its auto-hide while work is in flight', () => {
  // showToast hides after 3s. A 25s run driving it would go blank two thirds of
  // the way through, which looks exactly like a page that gave up.
  const w = boot();
  // The page ships its own #toast. Appending another with the same id is
  // pointless -- getElementById returns the first, so the code under test would
  // be driving the real one while the test inspected a decoy.
  const t = w.document.getElementById('toast');
  t.classList.add('hidden');

  const fn = w.toastProgress('Assigning', 40);
  assert.strictEqual(typeof fn, 'function');
  assert.ok(!t.className.includes('hidden'));
  assert.match(t.textContent, /Assigning 0 of 40/);

  w.showToast('something else');          // arms the 3s timer
  fn(7, 40);                              // must clear it again
  assert.match(t.textContent, /Assigning 7 of 40/);
});

test('the toast reporter stays silent for a single row', () => {
  // The common case here is one row, where "Assigning 1 of 1" is noise.
  const w = boot();
  const t = w.document.getElementById('toast');
  t.textContent = '';
  assert.strictEqual(w.toastProgress('Assigning', 1), null);
  assert.strictEqual(t.textContent, '');
});
