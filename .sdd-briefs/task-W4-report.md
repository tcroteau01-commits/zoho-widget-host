# Task W4 Report — Prominent Invoice Field + Full-Width Amber Submit

## Status
DONE. Committed `5f488cb` on `feat/tms-submit-library-packet`.

## TDD Evidence

**RED:** 3 new tests written in `test/tms-load-detail-submit.test.mjs` before any implementation:
- `W4: invoice input is wrapped in a .field div with label` → FAIL
- `W4: submit button has btn and primary classes` → FAIL
- `W4: .ready amber behavior still composes with .btn.primary` → FAIL

Existing 447 tests: all pass (confirmed before touching implementation).

**GREEN:** After implementation, `npm test` → **450/450 pass, 0 fail**.

## Files Changed

### `tms-load-detail.html`

**Markup** (`renderSubmitPanel`, ~line 1155):
```html
<!-- BEFORE -->
'<label>Carrier / Factoring Invoice # ' +
'<input type="text" id="f-factoring-invoice" placeholder="from carrier or factoring co."></label>' +
'<button id="btn-submit-factoring" disabled>Submit for Factoring</button>' +

<!-- AFTER -->
'<div class="field"><label>Carrier / Factoring Invoice #</label>' +
'<input type="text" id="f-factoring-invoice" placeholder="from carrier or factoring co."></div>' +
'<button id="btn-submit-factoring" class="btn primary" disabled>Submit for Factoring</button>' +
```

**CSS** (outside media query, replaces the scoped min-height):
```css
/* ADDED outside media query */
#btn-submit-factoring { width:100%; min-height:44px; }
#btn-submit-factoring.ready { background:#e8a020; color:#fff; border-color:#e8a020; }
```

**CSS cleanup** (inside `@media (max-width:640px)`):
- Removed `#btn-submit-factoring { min-height: 44px; }` — now redundant; the global rule above covers it.
- The `#submit-panel input[type="text"], #submit-panel button { width: 100%; }` mobile rule kept as belt-and-suspenders.

### `test/tms-load-detail-submit.test.mjs`
Added 3 tests under `// ── W4` comment block at end of file.

## .ready + .btn.primary Composition

`.btn.primary` sets `background:#e8a020; color:#fff; border-color:#e8a020;` — same amber as `.ready`.

When gates pass, `_refreshGates` adds `.ready` which also sets `background:#e8a020; color:#fff; border-color:#e8a020;` — no conflict, they agree. When gates fail, `.ready` is removed and the button is `disabled`. The `.btn.primary` visual is visible even disabled (expected — disabled state gives opacity feedback from the browser default). `id`, `disabled` default, and the `.ready` toggle in `_refreshGates` are unchanged. Confirmed by the `W4: .ready amber behavior still composes with .btn.primary` test.

## Self-Review

- `#f-factoring-invoice` id preserved — gate check and submit function unchanged.
- `#btn-submit-factoring` id preserved — `_refreshGates` and `submitForFactoring` read it by id.
- `disabled` default preserved — button starts locked.
- `_refreshGates`, `submitForFactoring`, gate list, override checkbox: zero changes.
- `.field` pattern matches lines 146-161 in the form (label above input, flex-column, uppercase small label).
- No behavior changes — pure markup/CSS restyle as specified.

## Concerns
None. Straightforward restyle. The `.btn.primary` color (amber) and `.ready` color (amber) are identical, so the composition is visually seamless regardless of which class wins specificity.

---

## Fix: Grey Disabled Submit Button (review finding)

### What changed

**`tms-load-detail.html`**

- Added `#btn-submit-factoring:disabled { background:#d8d8d8; color:#888; border-color:#d8d8d8; opacity:1; cursor:not-allowed; }` directly after the `#btn-submit-factoring { width:100%; min-height:44px; }` rule. The `#id:disabled` selector outspecifies `.btn.primary`, so the amber from `.btn.primary` applies only when the button is enabled; disabled state renders a deliberate grey.
- Removed the now-redundant `#btn-submit-factoring.ready { background:#e8a020; color:#fff; border-color:#e8a020; }` rule. The `.ready` class no longer carries any color responsibility (`.btn.primary` already supplies amber); the JS in `_refreshGates` that adds/removes `.ready` and sets `btn.disabled` is untouched.

**`test/tms-load-detail-submit.test.mjs`**

- Added `W4: disabled attr present when gates fail, absent when gates pass; btn+primary always present` — asserts `btn.disabled === true` on gate failure and `btn.disabled === false` on gate pass, and confirms `.btn` + `.primary` classes are present in both states. CSS computed values are not checked (jsdom limitation); the `disabled` attribute is the correct hook since `#id:disabled` in CSS keys off it.

### Test run
`npm test` → **451/451 pass, 0 fail** (+1 vs pre-fix 450).
