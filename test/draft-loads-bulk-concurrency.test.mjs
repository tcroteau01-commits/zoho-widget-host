// FANOUT1. Bulk actions on Draft Loads used to be
// Promise.all(items.map(... fetch ...)) -- one request per item, all at once.
//
// The API runs `gunicorn --workers 2` and each of these writes is a 1.5-2s
// Creator round trip. On 2026-09-04 23:52-23:54 a CSV import produced a
// sustained ~2 POST/second storm for 90+ seconds; requests logged their own
// start at 23:52:14 and did not reach the access log until 23:52:56. Every one
// returned 200 -- they were queued, not broken. GET /portal/ 502'd alongside
// them, in front of a live demo. The page was DDoSing its own API.
//
// What these tests actually protect:
//   1. the peak number of simultaneous in-flight requests is bounded;
//   2. mapLimit keeps Promise.all's contract (order, first rejection) so the
//      seven call sites did not quietly change behaviour;
//   3. the work is passed as a FUNCTION. A limiter handed already-started
//      promises limits nothing, and two call sites were written that way.
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

/** A task factory that records how many run at once. */
function tracker(w, { failAt = -1, delay = 1 } = {}) {
  const state = { active: 0, peak: 0, started: [], order: [] };
  const fn = (item, i) => {
    state.active++;
    state.peak = Math.max(state.peak, state.active);
    state.started.push(item);
    return new Promise((resolve, reject) => {
      w.setTimeout(() => {
        state.active--;
        state.order.push(item);
        if (i === failAt) reject(new Error('task ' + i + ' failed'));
        else resolve('r' + item);
      }, delay);
    });
  };
  return { state, fn };
}

const range = (n) => Array.from({ length: n }, (_, i) => i);

// --- 1. the bound itself ----------------------------------------------------

test('never exceeds the limit, however many items', async () => {
  const w = boot();
  const { state, fn } = tracker(w);
  await w.mapLimit(range(50), 4, fn);
  assert.strictEqual(state.peak, 4);
  assert.strictEqual(state.started.length, 50);
});

test('a 50-row import no longer opens 50 connections', async () => {
  // The regression in one line. Before: peak 50. After: peak 4.
  const w = boot();
  const { state, fn } = tracker(w);
  await w.mapLimit(range(50), w.BULK_WRITE_CONCURRENCY, fn);
  assert.ok(state.peak <= 4, `peak was ${state.peak}`);
});

test('uploads are held tighter than json writes', () => {
  const w = boot();
  assert.ok(w.BULK_UPLOAD_CONCURRENCY < w.BULK_WRITE_CONCURRENCY);
});

test('fewer items than the limit still runs them all', async () => {
  const w = boot();
  const { state, fn } = tracker(w);
  const out = await w.mapLimit(range(2), 8, fn);
  // Array.from: jsdom builds the result inside its own realm, so the array's
  // prototype is not Node's and deepStrictEqual fails on identical contents.
  assert.deepStrictEqual(Array.from(out), ['r0', 'r1']);
  assert.strictEqual(state.peak, 2);
});

test('an empty list resolves without calling the worker', async () => {
  const w = boot();
  let calls = 0;
  assert.deepStrictEqual(Array.from(await w.mapLimit([], 4, () => { calls++; })), []);
  assert.strictEqual(calls, 0);
});

test('a limit of zero or missing still makes progress', async () => {
  // A limit of 0 that was honoured literally would hang forever.
  const w = boot();
  const { fn } = tracker(w);
  assert.strictEqual((await w.mapLimit(range(3), 0, fn)).length, 3);
  assert.strictEqual((await w.mapLimit(range(3), undefined, fn)).length, 3);
});

// --- 2. it keeps Promise.all's contract -------------------------------------

test('results come back in INPUT order, not completion order', async () => {
  // Completion order is scrambled on purpose. createDraftsFromPreview renders
  // the created loads from this array.
  const w = boot();
  const delays = [30, 1, 20, 2, 10];
  const out = await w.mapLimit(range(5), 2, (i) =>
    new Promise((res) => w.setTimeout(() => res('r' + i), delays[i])));
  assert.deepStrictEqual(Array.from(out), ['r0', 'r1', 'r2', 'r3', 'r4']);
});

test('rejects on the first rejection, like Promise.all', async () => {
  const w = boot();
  const { fn } = tracker(w, { failAt: 3 });
  await assert.rejects(() => w.mapLimit(range(10), 2, fn), /task 3 failed/);
});

test('a rejection STOPS launching further work', async () => {
  // The one deliberate difference from Promise.all, which cannot do this
  // because map() already started everything. Continuing to hammer an API that
  // just failed is how a bad import becomes an outage.
  const w = boot();
  const { state, fn } = tracker(w, { failAt: 1 });
  await assert.rejects(() => w.mapLimit(range(40), 2, fn));
  await new Promise((r) => w.setTimeout(r, 30));
  assert.ok(state.started.length < 10,
    `kept launching after a failure: ${state.started.length} of 40 started`);
});

test('a synchronous throw is a rejection, not a crash', async () => {
  const w = boot();
  await assert.rejects(() => w.mapLimit(range(3), 2, () => { throw new Error('boom'); }),
    /boom/);
});

test('a non-promise return value is accepted', async () => {
  const w = boot();
  assert.deepStrictEqual(Array.from(await w.mapLimit(range(3), 2, (i) => i * 2)), [0, 2, 4]);
});

// --- 3. the call sites -------------------------------------------------------

test('every bulk write site goes through mapLimit', () => {
  // Guards the actual regression: someone reintroducing Promise.all(x.map(fetch)).
  const body = html.slice(html.indexOf('function createDraftsFromPreview'));
  const offenders = [...body.matchAll(/Promise\.all\(([^)]*)\)/g)]
    .map((m) => m[1])
    .filter((arg) => /\.map\(|jobs/.test(arg));
  assert.deepStrictEqual(offenders, [], `unthrottled fan-out: ${offenders}`);
});

test('mapLimit is called with a function, never with started promises', () => {
  // applyGroup and commitPaperwork were both written as ids.map(startWork).
  // Handing those results to a limiter would limit nothing at all.
  // Drop the definition itself -- `function mapLimit(items, limit, fn){` matches
  // the same shape as a call and is not one.
  const callSites = html.replace(/function mapLimit\([^)]*\)/, '');
  const args = [...callSites.matchAll(/mapLimit\([^,]+,[^,]+,\s*([^\n]*)/g)];
  assert.ok(args.length >= 7, `expected 7 call sites, found ${args.length}`);
  for (const m of args) {
    assert.match(m[1].trim(), /^function\s*\(/,
      `mapLimit given a non-function: ${m[1].trim().slice(0, 60)}`);
  }
});

test('the paperwork commit collects descriptors instead of starting uploads', () => {
  const fn = html.slice(html.indexOf('function commitPaperwork'),
                        html.indexOf('function commitPaperwork') + 1400);
  assert.ok(!/jobs\.push\(uploadSlot\(/.test(fn),
    'uploads start at push() time, before the limiter sees them');
  assert.ok(/jobs\.push\(\{/.test(fn));
});

test('the import button cannot start a second run beside the first', async () => {
  // Throttling one run is pointless if a second click starts another. The
  // button had no guard, and the throttled import takes visibly longer, which
  // makes a second click MORE likely.
  const w = boot();
  let calls = 0;
  w.creatableRows = () => { calls++; return []; };
  w.__creatingDrafts = true;
  await w.createDraftsFromPreview();
  assert.strictEqual(calls, 0, 're-entered while a run was in flight');
});
