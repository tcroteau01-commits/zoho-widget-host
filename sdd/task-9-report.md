# Task 9 Report: Fix the invisible "Generating..." cue

## Status: DONE

## Changes Made

### `tms-load-detail.html`

**CSS added** (after `.doc-item.voided > span` rule, line ~51):
```css
.doc-status.busy { color: #b45309; font-weight: 700; }
.doc-status.busy::before { content: '⏳ '; }
```

**`_docStatus` updated** (line ~798):
- Signature changed from `_docStatus(msg)` to `_docStatus(msg, busy)`
- When `busy` is truthy: `el.className = 'doc-status busy'` (amber bold, spinner prefix)
- When `busy` is falsy (terminal calls): `el.className = 'muted'` (reverts to gray, unchanged UX)

**Two busy callers updated:**
- `generateDoc`: `_docStatus(send ? 'Sending…' : 'Generating…', true)` (line ~807)
- `uploadBrokerDoc`: `_docStatus('Uploading…', true)` (line ~833)

**Terminal calls left unchanged (one-arg = muted):**
- `'Save the load first.'`, `'Generated.'`, `'Sent.'`, `'Network error.'`, `'Uploaded.'`, `'Upload failed.'`, `'Network error uploading.'`, error strings

### `test/tms-load-detail-docs.test.mjs`

Added test (Step 1 of TDD):
```js
test('generating cue is visibly busy, not muted gray', async () => {
  const { window } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.loadId = '1001';
  window._docStatus('Generating…', true);
  const el = window.document.getElementById('doc-status');
  assert.equal(el.classList.contains('busy'), true);
  assert.equal(el.classList.contains('muted'), false);
  assert.match(el.textContent, /Generating/);
});
```

## TDD RED/GREEN Evidence

### RED (before changes):
```
node --test test/tms-load-detail-docs.test.mjs
  pass 5 / fail 1
  AssertionError: false !== true  (el.classList.contains('busy') was false)
```

### GREEN (after changes):
```
node --test test/tms-load-detail-docs.test.mjs
  tests 6 / pass 6 / fail 0
  duration_ms 1111.9562
```

All 6 tests pass, no regressions.

## Commit

```
2613a4c  fix(tms-detail): make the document generating cue visible (amber + spinner)
```

Branch: `feat/tms-detail-phase2`

## Self-Review

- No em dashes or en dashes introduced.
- `_docStatus` remains exposed on `window` (unchanged exposure pattern at bottom of file).
- Terminal status calls (`'Generated.'`, `'Sent.'`, errors, `'Save the load first.'`) all remain one-arg and revert to `.muted` correctly.
- The `#doc-status` element starts with class `muted` in HTML; the new function always sets `el.className` explicitly, so no residual class state issues.
- CSS is scoped to `.doc-status.busy` (double-class selector), so it cannot bleed to other `.busy` elements if any exist.
- `fetchCarrierLink` also calls `_docStatus('Save the load first.')` with one arg -- confirmed still correct.
