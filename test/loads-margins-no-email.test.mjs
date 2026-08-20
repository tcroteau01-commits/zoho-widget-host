import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../loads-margins.html', import.meta.url), 'utf8');

// DEMOUSER1 regression guard. bootstrap()'s getInitParams().then() callback bails
// with a bare `return` when Creator hands back no loginUser, showing "Unable to
// identify broker". Splitting that callback in two to await OPERFI_DEMO.ready()
// turns that `return` into "resolve the chain", so the SECOND .then still runs and
// renderShell() paints over the error while fetchLoads() queries for a null broker.
// The other five chain-style widgets `throw` instead of `return`, which skips the
// rest of the chain correctly; this one is the odd man out.

function boot(params) {
  const calls = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/loads-margins.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => Promise.resolve(params) } } };
      window.fetch = (url) => { calls.push(String(url)); return new Promise(() => {}); };
    },
  });
  return { w: dom.window, calls };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test('a Creator init with no loginUser leaves the error message up and fetches nothing', async () => {
  const { w, calls } = boot({});
  await settle(); await settle();
  assert.match(w.document.getElementById('loads-margins-app').innerHTML,
    /Unable to identify broker/,
    'renderShell() painted over the "unable to identify broker" error');
  assert.equal(calls.length, 0, 'fetched the backend for a null broker: ' + calls.join(', '));
});

test('a Creator init WITH a loginUser still renders the shell', async () => {
  const { w } = boot({ loginUser: 'broker@marek.com' });
  await settle(); await settle();
  assert.doesNotMatch(w.document.getElementById('loads-margins-app').innerHTML,
    /Unable to identify broker/);
});
