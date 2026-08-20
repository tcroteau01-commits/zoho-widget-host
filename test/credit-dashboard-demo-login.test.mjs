import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../credit-dashboard.html', import.meta.url), 'utf8');
const IMP = readFileSync(new URL('../operfi-impersonate.js', import.meta.url), 'utf8');
const LEDGER = readFileSync(new URL('../demo-ledger.js', import.meta.url), 'utf8');
const DATA = readFileSync(new URL('../demo-data.js', import.meta.url), 'utf8');

// credit-dashboard is the odd one out among the 7 fixture widgets. The other six
// consult isDemo() inside the function that fetches, which runs after ready().
// This one consulted it once at the TOP of bootApp(), before the SDK path was
// entered, to seed window.__PREVIEW_DATA__. On the admin-impersonation path that
// works, because localStorage makes isDemo() true synchronously at page load. On
// the DIRECT-LOGIN path the flag is not known that early, so the fixture branch
// was skipped and control fell through to loadDashboard() -- which has no demo
// branch at all -- and an invited demo user got
// "Could not load credit data: Unauthorized".

// jsdom does not fetch external scripts. Rather than inline them into the HTML
// (demo-data.js and operfi-impersonate.js both contain a literal "</script" in
// their header comments, which closes the tag early and leaves OPERFI_DEMO
// undefined -- indistinguishable from the bug under test), strip the tags and
// eval the sources into the window before the page's own scripts parse.
const STRIPPED = HTML.replace(
  /[ \t]*<script src="https:\/\/app\.operfi\.com\/(operfi-impersonate|demo-ledger|demo-data)\.js[^"]*"><\/script>\r?\n/g,
  ''
);

function boot(opts) {
  const calls = [];
  const charts = [];
  const dom = new JSDOM(STRIPPED, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/credit-dashboard.html',
    beforeParse(window) {
      // Chart.js is another CDN script jsdom will not fetch, and renderCharts()
      // calls `new Chart(...)` unguarded.
      window.Chart = function (el) { charts.push(el); return { destroy() {} }; };
      window.ZOHO = { CREATOR: { UTIL: {
        getInitParams: () => Promise.resolve({ loginUser: opts.email })
      } } };
      window.fetch = function (url) {
        calls.push(String(url));
        if (String(url).indexOf('/whoami') !== -1) {
          return Promise.resolve({ ok: true,
            json: () => Promise.resolve({ is_admin: false, is_demo: opts.isDemo }) });
        }
        return Promise.resolve({ ok: false, status: 401,
          json: () => Promise.resolve({ error: 'Unauthorized' }) });
      };
      // Order matters: operfi-impersonate.js wraps window.fetch at eval time.
      window.eval(IMP);
      if (opts.impersonate) window.localStorage.setItem('operfiImpersonate', opts.impersonate);
      window.eval(LEDGER);
      window.eval(DATA);
    },
  });
  return { w: dom.window, calls, charts };
}

const settle = () => new Promise((r) => setTimeout(r, 0));
async function drain() { for (let i = 0; i < 8; i++) await settle(); }

const apiCalls = (calls) => calls.filter((u) => u.indexOf('/credit-dashboard?') !== -1);

// Guards the harness itself. Without it, a silently broken setup leaves
// OPERFI_DEMO undefined and every assertion below passes or fails for the wrong
// reason -- which is exactly what happened on the first attempt at this file.
test('harness sanity: the demo scripts are actually in the page', async () => {
  const { w } = boot({ email: 'broker@marek.com', isDemo: false });
  await drain();
  assert.ok(w.OPERFI_IMP, 'operfi-impersonate.js did not evaluate');
  assert.ok(w.OPERFI_DEMO_LEDGER, 'demo-ledger.js did not evaluate');
  assert.equal(typeof (w.OPERFI_DEMO || {}).ready, 'function', 'demo-data.js did not evaluate');
});

test('a demo user logging in directly renders the fixture, not an Unauthorized error', async () => {
  const { w, calls } = boot({ email: 'newdemo@x.com', isDemo: true });
  await drain();
  assert.ok(w.__PREVIEW_DATA__,
    'the fixture was never seeded, so bootApp fell through to the real API');
  assert.equal(apiCalls(calls).length, 0,
    'called the real /credit-dashboard for an account with no FVClientID');
  // The KPI nodes are static in the HTML, seeded with an em dash. Rendering is
  // what replaces that, so assert on content rather than existence.
  assert.notEqual(w.document.getElementById('kpi-risk').textContent.trim(), '—',
    'the KPI tiles were never populated');
});

test('an admin impersonating a demo contact still gets the fixture at page load', async () => {
  // The legacy path, which worked before and must keep working: isDemo() is true
  // synchronously, so bootApp's own renderEmbedded() call handles it and the
  // second one never runs.
  const { w, calls } = boot({ email: 'admin@operfi.com', isDemo: false, impersonate: 'demo@operfi.com' });
  await drain();
  assert.ok(w.__PREVIEW_DATA__);
  assert.equal(apiCalls(calls).length, 0);
});

test('a real broker still goes to the backend and is never given fixture data', async () => {
  const { w, calls } = boot({ email: 'broker@marek.com', isDemo: false });
  await drain();
  assert.equal(w.__PREVIEW_DATA__, undefined,
    'a real client was seeded with fabricated credit data');
  assert.equal(apiCalls(calls).length, 1);
});

test('the fixture renders exactly once, not twice', async () => {
  // renderEmbedded() is called from two places by design. __PREVIEW_DATA__ gates
  // the second, but if bootApp ever stops returning early both would run. Chart
  // constructions are the observable: renderCharts() builds exactly 3, and a
  // double render would leak a second set onto the same canvases.
  const direct = boot({ email: 'newdemo@x.com', isDemo: true });
  await drain();
  assert.equal(direct.charts.length, 3);

  const impersonated = boot({ email: 'admin@operfi.com', isDemo: false, impersonate: 'demo@operfi.com' });
  await drain();
  assert.equal(impersonated.charts.length, 3);
});
