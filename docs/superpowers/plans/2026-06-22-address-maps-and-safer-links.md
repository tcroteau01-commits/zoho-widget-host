# Clickable Address (Maps) + FMCSA SAFER Link — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make stored addresses open in Google Maps (carrier profile, View Vendors, Customer Approvals) and add a one-click FMCSA SAFER lookup link on the carrier profile.

**Architecture:** Widget-only. Each page gets a tiny pure helper that builds a key-free deep-link URL and returns "" when there's no usable input; the existing rendered address/DOT is wrapped in an anchor only when the helper returns a URL. No backend, no shared module, no new dependency.

**Tech Stack:** vanilla JS + HTML (`zoho-widget-host`), `node --test` + jsdom.

## Global Constraints

- Worktree: `C:/Claude Code/Broker Portal Load Details Page/wt-addr` on branch `feat/addr-links-safer` (off `origin/main`).
- Maps URL: `https://www.google.com/maps/search/?api=1&query=` + `encodeURIComponent(<address string>)`.
- SAFER URL: `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=` + `encodeURIComponent(<dot>)`.
- All links `target="_blank" rel="noopener"`. URL params via `encodeURIComponent`; any text rendered into the DOM stays `esc()`'d (we only wrap existing already-`esc()`'d text in an anchor — introduce no unescaped sink).
- Graceful: helper returns "" when input is empty → render plain text / omit the link, never a broken link. (The existing renders already hide the address/location entirely when empty; keep that.)
- Match each file's existing markup (its `field()` / hero-meta structure, its local `esc()`). Expose new helpers on `window` (guarded `if (typeof window !== 'undefined')`) like the files' existing test hooks so jsdom can unit-test them.
- Run tests: `npm install` once, then `node --test test/<file>.test.mjs` / `npm test`. Baseline must stay green.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Carrier profile — Maps link on location + SAFER link (ADDR1 + CP3)

**Files:**
- Modify: `carrier-profile.html` (`renderHero`, ~line 1083-1098; add two helpers near it)
- Test: `test/carrier-profile-links.test.mjs` (create)

**Interfaces:**
- Produces: `window.mapsHref(addrStr) -> url|""` and `window.saferHref(dot) -> url|""`.

- [ ] **Step 1: Write the failing test**

```javascript
// test/carrier-profile-links.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('carrier-profile.html'), 'utf8');
function boot() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  return dom.window;
}

test('mapsHref builds an encoded Google Maps deep-link, "" when empty', () => {
  const w = boot();
  assert.match(w.mapsHref('123 Main St, Phoenix, AZ 85001'), /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  assert.ok(w.mapsHref('123 Main St, Phoenix, AZ').includes(encodeURIComponent('123 Main St, Phoenix, AZ')));
  assert.strictEqual(w.mapsHref(''), '');
  assert.strictEqual(w.mapsHref('   '), '');
});

test('saferHref deep-links by DOT, "" when no DOT', () => {
  const w = boot();
  const u = w.saferHref('3455916');
  assert.match(u, /safer\.fmcsa\.dot\.gov\/query\.asp/);
  assert.ok(u.includes('query_string=3455916'));
  assert.strictEqual(w.saferHref(''), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/carrier-profile-links.test.mjs`
Expected: FAIL — `mapsHref`/`saferHref` undefined on window.

- [ ] **Step 3: Write minimal implementation**

In `carrier-profile.html`, add the two helpers (near `renderHero`, top-level in the page script):

```javascript
function mapsHref(addr){
  var s=String(addr||'').trim();
  return s ? 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(s) : '';
}
function saferHref(dot){
  var d=String(dot||'').trim();
  return d ? 'https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string='+encodeURIComponent(d) : '';
}
if (typeof window !== 'undefined') { window.mapsHref = mapsHref; window.saferHref = saferHref; }
```

Then wire them into `renderHero`. Replace the DOT line + the `loc` block:

```javascript
  var parts=[
    '<span><span class="key">MC#</span> '+esc(v.MC||'—')+'</span>',
    '<span><span class="key">DOT</span> '+esc(v.USDOT||'—')+'</span>'
  ];
  var _sh=saferHref(v.USDOT);
  if(_sh) parts.push('<span><a href="'+esc(_sh)+'" target="_blank" rel="noopener" style="color:var(--of-orange);text-decoration:underline">FMCSA SAFER ↗</a></span>');
  var authAge=_authorityAge(co); if(authAge) parts.push('<span>Authority age: '+esc(authAge)+'</span>');
  var dotAge=_years(co.dot_age); if(dotAge) parts.push('<span>DOT age: '+esc(dotAge)+'</span>');
  var loc=[co.physical_address_city||'', co.physical_address_state||v.Physical_State||'']
            .filter(function(x){return x;}).join(', ');
  if(loc){ var _mh=mapsHref(loc);
    parts.push('<span>Based in '+(_mh?'<a href="'+esc(_mh)+'" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">'+esc(loc)+'</a>':esc(loc))+'</span>'); }
```

(Leave the rest of `renderHero` unchanged: the `metaEl.innerHTML=parts.join(...)` line stays.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/carrier-profile-links.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add carrier-profile.html test/carrier-profile-links.test.mjs
git commit -m "feat(carrier-profile): Maps link on location + FMCSA SAFER link (ADDR1/CP3)"
```

---

### Task 2: View Vendors — Maps link on the Address field (ADDR1)

**Files:**
- Modify: `view-vendors.html` (add `mapsHref` + `addressFieldHtml` helpers near `formatAddress` ~line 743; change the render at line 662)
- Test: `test/view-vendors.test.mjs` (append)

**Interfaces:**
- Consumes: the file's existing `formatAddress`, `esc`, `field`.
- Produces: `window.mapsHref`, `window.addressFieldHtml(addr)`.

- [ ] **Step 1: Write the failing test**

```javascript
// append to test/view-vendors.test.mjs (it already boots view-vendors.html into jsdom — mirror that boot)
import { test as _t_addr } from 'node:test';   // if `test` already imported at top, reuse it instead of re-importing
// Use the file's existing boot helper if present; otherwise:
//   const dom = new JSDOM(html, { runScripts: 'dangerously' }); const w = dom.window;
test('addressFieldHtml wraps the address in a Maps link; plain when empty', () => {
  const w = bootViewVendors();   // reuse the existing harness boot in this file
  const linked = w.addressFieldHtml('500 W Adams St, Phoenix, AZ 85003');
  assert.match(linked, /class="field-label">Address</);
  assert.match(linked, /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  assert.match(linked, /target="_blank"/);
  const empty = w.addressFieldHtml('');
  assert.ok(!/href=/.test(empty));   // no link when empty
});
```

(If `test/view-vendors.test.mjs` has no reusable boot helper, add a local one mirroring how the file already loads `view-vendors.html` into JSDOM with `runScripts: 'dangerously'`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/view-vendors.test.mjs`
Expected: FAIL — `addressFieldHtml` undefined.

- [ ] **Step 3: Write minimal implementation**

In `view-vendors.html`, near `formatAddress` (line ~743), add:

```javascript
function mapsHref(addr){
  var s=String(addr||'').trim();
  return s ? 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(s) : '';
}
function addressFieldHtml(addr){
  var mh=mapsHref(addr);
  var val=mh ? '<a href="'+esc(mh)+'" target="_blank" rel="noopener">'+esc(addr)+'</a>' : esc(addr);
  return '<div class="field"><div class="field-label">Address</div><div class="field-val">'+val+'</div></div>';
}
if (typeof window !== 'undefined') { window.mapsHref = mapsHref; window.addressFieldHtml = addressFieldHtml; }
```

Then change the render at line 662 from:
```javascript
        (addr ? '<div style="margin-top: 14px;">' + field('Address', addr) + '</div>' : '') +
```
to:
```javascript
        (addr ? '<div style="margin-top: 14px;">' + addressFieldHtml(addr) + '</div>' : '') +
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/view-vendors.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add view-vendors.html test/view-vendors.test.mjs
git commit -m "feat(view-vendors): Maps link on the carrier address (ADDR1)"
```

---

### Task 3: Customer Approvals — Maps link on the Address field (ADDR1)

**Files:**
- Modify: `customer-approvals.html` (add `mapsHref` + `addressFieldHtml` near `formatAddress` ~line 1328; change the render at line 997)
- Test: `test/customer-approvals-address.test.mjs` (create)

**Interfaces:**
- Consumes: the file's existing `formatAddress`, `esc`, `field`.
- Produces: `window.mapsHref`, `window.addressFieldHtml(addr)`.

- [ ] **Step 1: Write the failing test**

```javascript
// test/customer-approvals-address.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');

test('addressFieldHtml wraps the shipper address in a Maps link; plain when empty', () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  const linked = w.addressFieldHtml('1 Industrial Rd, Dallas, TX 75201');
  assert.match(linked, /class="field-label">Address</);
  assert.match(linked, /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  assert.match(linked, /target="_blank"/);
  assert.ok(!/href=/.test(w.addressFieldHtml('')));
});
```

(If the page does not boot cleanly under jsdom because of an external SDK reference, report it as BLOCKED rather than weakening the test — the controller will advise. The carrier-profile and view-vendors pages do boot this way.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/customer-approvals-address.test.mjs`
Expected: FAIL — `addressFieldHtml` undefined.

- [ ] **Step 3: Write minimal implementation**

In `customer-approvals.html`, near `formatAddress` (line ~1328), add the SAME helpers as Task 2 (`mapsHref`, `addressFieldHtml`, window-expose). Then change the render at line 997 from:
```javascript
        (formatAddress(r) ? '<div style="margin-top: 14px;">' + field('Address', formatAddress(r)) + '</div>' : '') +
```
to:
```javascript
        (formatAddress(r) ? '<div style="margin-top: 14px;">' + addressFieldHtml(formatAddress(r)) + '</div>' : '') +
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/customer-approvals-address.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit + full suite**

```bash
git add customer-approvals.html test/customer-approvals-address.test.mjs
git commit -m "feat(customer-approvals): Maps link on the customer address (ADDR1)"
```
Then `npm test` — confirm the whole widget suite stays green.

---

### Task 4: Review, merge, deploy, QA

- [ ] **Step 1:** Request code review on the branch (REQUIRED SUB-SKILL: superpowers:requesting-code-review).
- [ ] **Step 2:** Open PR, address review, merge to `main` (GH Pages).
- [ ] **Step 3:** `?v=` bump the Carrier Profile, View Vendors, and Customer Approvals embeds + hard refresh.
- [ ] **Step 4:** Live QA: on a carrier with an address → "Based in …" links to Maps and the "FMCSA SAFER" link opens the carrier's snapshot by DOT (carrier with no DOT → no SAFER link); on View Vendors and Customer Approvals → the Address field links to Maps and opens the right location; a record with no address → plain text / no Address row (no broken link).

---

## Self-Review

**Spec coverage:** ADDR1 carrier profile (Task 1 loc link) + View Vendors (Task 2) + Customer Approvals (Task 3); CP3 SAFER link (Task 1); graceful empty handling (helpers return "" + existing render guards); new-tab/encoding/esc constraints (all tasks); review/merge/?v=/QA (Task 4). ✓ No gaps.

**Placeholder scan:** Concrete code in every code step; the only conditional ("if the page can't boot in jsdom, report BLOCKED") is a real fallback instruction, not a placeholder. URLs are the verified-live ones.

**Type consistency:** `mapsHref(str)->url|""` and `addressFieldHtml(addr)->html` identical across Tasks 2/3; `saferHref(dot)->url|""` only in Task 1. Each file gets its OWN copy of `mapsHref` (intentional — widget-only, no shared module per the spec); the duplication is 3 lines and avoids wiring a shared script into three embeds. Render-call edits cite the exact current lines (view-vendors:662, customer-approvals:997).
