# Task 5 Report: Split Fast/Slow Load — Reserves from `/wallet-reserves`

## Changes Made

### `dashboard.html`
1. **`state` object**: Added `reserves: undefined` field to track the reserves response state.
2. **`renderSnapshot(s)`**: Reserves tile now renders `<span class="reserves-loading"></span>` when `s.reserves` is absent (summary no longer provides reserves), and renders the cash/escrow values when present. Added `id="kpi-reserves"` to tile and `id="reserves-body"` to the inner div.
3. **`fillReserves(reserves)`**: New function. Looks up `#reserves-body`; no-ops if absent (race guard). Renders "Reserves unavailable" on null, or cash/escrow values on a valid object.
4. **`fetchAndRender()`**: Rewritten to fire both fetches in parallel:
   - `/dashboard/summary` → `.then` sets `state.data`, calls `render()`
   - `/wallet-reserves` → `.then` sets `state.reserves = res`, calls `fillReserves(res)` / `.catch` sets `state.reserves = null`, calls `fillReserves(null)`
   - Mock path: `render()` then `fillReserves(MOCK_DASHBOARD.snapshot.reserves)`
5. **Race handling** (end of `render()`): `if (state.reserves !== undefined) fillReserves(state.reserves);` — handles the case where the reserves fetch resolved before `render()` ran.
6. **Version stamp**: Bumped from `v2026-06-16.2` to `v2026-06-23.1`.

### `test/dashboard-loading.test.mjs`
- Appended `SUMMARY` fixture and 3 new tests:
  - `summary fills tiles while reserves tile still shows a spinner` — delays: summary 10ms, reserves 200ms; waits 60ms; confirms account name rendered + `.reserves-loading` still in DOM
  - `reserves tile fills after /wallet-reserves resolves` — delays: summary 10ms, reserves 30ms; waits 150ms (was 80ms in brief; bumped for full-suite timing stability); confirms spinner gone + cash value in DOM
  - `reserves failure leaves the rest of the dashboard intact` — reserves rejects; waits 60ms; confirms account name still shows + "unavailable" text present

## TDD Evidence

### RED (before implementation)
```
✔ skeleton paints before data arrives, with live Quick Actions (103ms)
✖ summary fills tiles while reserves tile still shows a spinner (76ms)
  AssertionError: reserves spinner still showing — actual: null, expected: true
✔ reserves tile fills after /wallet-reserves resolves (91ms)   [passed by accident - error path]
✔ reserves failure leaves the rest of the dashboard intact (78ms) [passed by accident - error path]
tests 4 / pass 3 / fail 1
```

The first new test failed because `renderSnapshot` crashed on `s.reserves.cash` when summary had no reserves, producing an error div with no `.reserves-loading` element.

### GREEN (after implementation)
```
✔ skeleton paints before data arrives, with live Quick Actions (107ms)
✔ summary fills tiles while reserves tile still shows a spinner (76ms)
✔ reserves tile fills after /wallet-reserves resolves (93ms)
✔ reserves failure leaves the rest of the dashboard intact (77ms)
tests 4 / pass 4 / fail 0
```

## npm test (whole suite)
```
tests 487 / pass 487 / fail 0 / duration 14142ms
```
All dashboard-charts tests unaffected. All other widget tests pass.

## Race Handling Implementation

Two-part guard:

1. **reserves-before-render**: `fillReserves` opens with `if (!body) return;` — if `#reserves-body` doesn't exist yet (render hasn't run), it's a no-op. `state.reserves` is set to the resolved value in the `.then`/`.catch`. When `render()` runs later, it ends with `if (state.reserves !== undefined) fillReserves(state.reserves);` which applies the already-arrived reserves data.

2. **render-before-reserves** (normal case): `render()` sets `#reserves-body` with the spinner. When the reserves fetch settles, `fillReserves` finds the element and swaps in the real data (or "unavailable").

`undefined` = not yet settled; `null` = failed/unavailable; `object` = success.

## Files Changed
- `C:/Claude Code/wt-dash-w/dashboard.html`
- `C:/Claude Code/wt-dash-w/test/dashboard-loading.test.mjs`

## Self-Review

- The `wait(80)→wait(150)` bump on the "spinner gone" test deviates from the brief's verbatim value. The change is necessary: in the full-suite run, JSDOM init + getInitParams Promise chain + fetch mock overhead consumes ~60-80ms before the mocked delays even start, so 80ms was a race condition in the full suite. 150ms gives reliable headroom while the test still asserts the right thing (spinner gone after reserves land).
- The mock path in `fetchAndRender` calls `fillReserves` after `render()` — this means `state.reserves` is still `undefined` when `render()` ends (we never set it on the mock path), so the `if (state.reserves !== undefined)` guard in `render()` correctly does nothing on the mock path. `fillReserves` is called explicitly after. This is correct and consistent.
- No other tests modified. No other files touched.

## Concerns
None blocking. The timing-based test approach inherited from Task 4 will always carry some flake risk on very slow CI runners; if it becomes an issue, the delays/waits should be scaled together.

---

# FINAL-REVIEW FIX

## Summary

Applied Fix 1 (de-flake timing tests with `waitFor`) and Fix 2 (reserves-before-render race test).

## Root cause of original flakiness

`body.textContent` in JSDOM includes the raw `<script>` tag source, which already contains `"Marek LLC (mock)"` before any scripts run. The original `wait(60)` approach was also racy. The first `waitFor` attempt using `textContent.includes('Marek LLC')` returned immediately (2ms) from the script source, not from rendered DOM, so the reserves spinner check immediately followed against an un-rendered page.

**Fix:** Added `getNameEl(w)` helper (`querySelector('.header-strip .name')`) and `getReservesBody(w)` (`getElementById('reserves-body')`) to detect actual rendered DOM state rather than script source text.

## Diff of test changes

```diff
+async function waitFor(fn, { timeout = 1000, step = 10 } = {}) {
+  const start = Date.now();
+  while (Date.now() - start < timeout) { if (fn()) return true; await wait(step); }
+  return fn();
+}
+
+// Helpers to detect rendered DOM state (textContent includes raw <script> source)
+function getNameEl(w)      { return w.document.querySelector('.header-strip .name'); }
+function getReservesBody(w){ return w.document.getElementById('reserves-body'); }

 // summary fills tiles test:
-  await wait(60);
-  assert.ok(w.document.body.textContent.includes('Marek LLC'), ...)
+  await waitFor(() => getNameEl(w) && getNameEl(w).textContent.includes('Marek LLC'));
+  assert.ok(getNameEl(w).textContent.includes('Marek LLC'), ...)
   assert.ok(w.document.querySelector('.reserves-loading'), ...)
   // reservesDelay bumped 200→2000 (headroom while waitFor polls)

 // reserves tile fills test:
-  await wait(150);
+  await waitFor(() => getNameEl(w) !== null);
+  await waitFor(() => w.document.querySelector('.reserves-loading') === null);
   assert.equal(querySelector('.reserves-loading'), null, ...)
-  assert.ok(body.textContent.includes('840') || ...)
+  const rbText = getReservesBody(w).textContent;
+  assert.ok(rbText.includes('840') || rbText.includes('839'), ...)

 // reserves failure test:
-  await wait(60);
-  assert.ok(body.textContent.includes('Marek LLC'), ...)
-  assert.ok(body.textContent.toLowerCase().includes('unavailable'), ...)
+  await waitFor(() => getNameEl(w) !== null);
+  await waitFor(() => getReservesBody(w)?.textContent.toLowerCase().includes('unavailable'));
+  assert.ok(getNameEl(w).textContent.includes('Marek LLC'), ...)
+  assert.ok(getReservesBody(w).textContent.toLowerCase().includes('unavailable'), ...)

+// NEW: reserves-before-render race test
+test('reserves-before-render: data held in state and applied when summary renders', async () => {
+  const w = mountLive({ ..., reservesDelay: 10, summaryDelay: 100 });
+  await waitFor(() => getNameEl(w) && getNameEl(w).textContent.includes('Marek'));
+  await waitFor(() => w.document.querySelector('.reserves-loading') === null);
+  assert.ok(rbText.includes('839') || rbText.includes('840'), 'cash value rendered after race');
+  assert.equal(querySelector('.reserves-loading'), null, 'no reserves spinner remaining');
+});
```

## Test runs

**Run 1:** 5/5 pass (duration_ms 11313)
**Run 2:** 5/5 pass (duration_ms 11630)
**Run 3:** 5/5 pass (duration_ms 11051)
**npm test (full suite):** 488/488 pass, 0 fail (duration_ms 28438)

## Concerns

None blocking. One non-obvious gotcha documented: JSDOM `body.textContent` includes script tag source, so raw string searches on mock data strings are unreliable for detecting rendered state.
