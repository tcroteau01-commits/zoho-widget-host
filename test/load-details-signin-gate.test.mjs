// The sign-in gate on the Submit Load widget.
//
// app.operfi.com serves index.html at its bare root, so typing the domain lands
// a stranger on a Submit Load form. The form was already inert for them --
// brokerEmail comes only from the Creator SDK, and /tms-customers 401s without a
// resolvable broker -- but a form that silently does nothing is the wrong thing
// to show, both to a stranger and to a broker whose identity call just failed.
//
// The gate is an OVERLAY, not a replacement: the form stays in the DOM so no
// other test or code path has to care whether it rendered.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function boot(zoho) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  if (zoho !== undefined) { dom.window.ZOHO = zoho; }
  // jsdom has no fetch. The happy path calls onReady(), which immediately loads
  // customers and carriers -- without this every signed-in case fails on the
  // network call rather than on what it is actually asserting.
  dom.window.fetch = () => Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve({ customers: [], carriers: [], drafts: [] }),
  });
  return dom.window;
}

const gate = (w) => w.document.getElementById('signin-gate');
const shown = (w) => gate(w).className.includes('show');

function sdk(getInitParams) {
  return { CREATOR: { UTIL: { getInitParams }, init: () => {} } };
}

// --- when the gate SHOWS ----------------------------------------------------

test('no Creator SDK at all shows the gate', async () => {
  // This is the app.operfi.com case: ZOHO is undefined, so getInitParams throws.
  const w = boot();
  w.resolveEmail();
  assert.ok(shown(w));
});

test('the SDK resolving with no email shows the gate', async () => {
  const w = boot(sdk(() => Promise.resolve({})));
  w.resolveEmail();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(shown(w));
});

test('the SDK rejecting shows the gate', async () => {
  // Under the portal shell this is /portal/api/me failing.
  const w = boot(sdk(() => Promise.reject(new Error('no session'))));
  w.resolveEmail();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(shown(w));
});

test('a synchronous SDK returning no params shows the gate', () => {
  const w = boot(sdk(() => null));
  w.resolveEmail();
  assert.ok(shown(w));
});

// --- when the gate MUST NOT show -------------------------------------------

test('a resolved broker never sees the gate', async () => {
  const w = boot(sdk(() => Promise.resolve({ loginUser: 'broker@acme.com' })));
  w.resolveEmail();
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(shown(w), false);
  assert.strictEqual(w.brokerEmail, 'broker@acme.com');
});

test('each of the three identity aliases counts as signed in', async () => {
  for (const key of ['loginUser', 'login_user', 'email']) {
    const w = boot(sdk(() => Promise.resolve({ [key]: 'broker@acme.com' })));
    w.resolveEmail();
    await new Promise((r) => setTimeout(r, 0));
    assert.strictEqual(shown(w), false, key);
  }
});

test('the gate is hidden before anything resolves', () => {
  // Guards against shipping it visible, which would black out the real widget
  // for every broker at once.
  const w = boot(sdk(() => new Promise(() => {})));
  assert.strictEqual(shown(w), false);
});

test('a bug inside our own render path does not become a login screen', () => {
  // A throw AFTER identity resolved is our fault, not the user's. Sending a
  // signed-in broker to "sign in to continue" would be a lie about the failure.
  //
  // This is exactly why resolveEmail uses two-argument then() rather than
  // .catch(): with .catch() the throw below WOULD reach the gate, because
  // .catch() also sees rejections produced by the success handler itself.
  //
  // Driven through a hand-rolled thenable so the two handlers can be invoked
  // directly. Using a real promise here would make the throw an unhandled
  // rejection -- true to production, but it tells the test runner the test
  // failed rather than letting it assert what it came to assert.
  const w = boot();
  let ok = null;
  let err = null;
  w.ZOHO = sdk(() => ({ then: (onOk, onErr) => { ok = onOk; err = onErr; } }));

  w.resolveEmail();
  assert.strictEqual(typeof ok, 'function');
  assert.strictEqual(typeof err, 'function', 'must pass a rejection handler to then()');

  w.onReady = () => { throw new Error('render bug'); };
  assert.throws(() => ok({ loginUser: 'broker@acme.com' }), /render bug/);
  assert.strictEqual(shown(w), false);

  // The rejection handler, by contrast, is exactly what should gate.
  err(new Error('no session'));
  assert.ok(shown(w));
});

// --- the gate's own content -------------------------------------------------

test('the gate leaves the form in the DOM', () => {
  const w = boot();
  w.resolveEmail();
  assert.ok(w.document.querySelector('.page'));
  assert.ok(w.document.getElementById('submit-btn'));
});

test('the gate points at the portal and at support', () => {
  const w = boot();
  w.resolveEmail();
  const text = gate(w).innerHTML;
  assert.ok(text.includes('brokerhub.operfi.com'));
  assert.ok(text.includes('brokersupport@operfi.com'));
});

test('the gate names no vendor and no internal host', () => {
  const w = boot();
  w.resolveEmail();
  const text = gate(w).textContent.toLowerCase();
  for (const vendor of ['zoho', 'creator', 'render', 'onrender', 'workos']) {
    assert.ok(!text.includes(vendor), vendor);
  }
});
