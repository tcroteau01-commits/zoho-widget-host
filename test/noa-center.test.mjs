// test/noa-center.test.mjs  CNOA Task 11: staff NOA Center screen. Made-up data only.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const H = require('../noa-center-helpers.js');
const HTML = readFileSync(new URL('../noa-center.html', import.meta.url), 'utf8');
const HELPERS = readFileSync(new URL('../noa-center-helpers.js', import.meta.url), 'utf8');

// ---- pure helpers ----------------------------------------------------------------------
test('chip labels cover every status', () => {
  assert.deepStrictEqual(
    ['not_sent', 'sent', 'viewed', 'acknowledged', 'confirmed', 'action_needed', 'grandfathered', 'released']
      .map(H.chipLabel),
    ['Not sent', 'Sent', 'Viewed', 'Acknowledged', 'Confirmed', 'Action needed', 'Grandfathered', 'Released']);
  assert.strictEqual(H.chipLabel('weird'), 'weird');
});

test('waiting-on text', () => {
  assert.strictEqual(H.waitingOnText({ waiting_on: 'ap@acmetest.com' }), 'Waiting on ap@acmetest.com');
  assert.strictEqual(H.waitingOnText({ waiting_on: 'OperFi verification' }), 'Waiting on OperFi verification');
  assert.strictEqual(H.waitingOnText({ waiting_on: null }), '');
});

test('confirm needs an independent number source', () => {
  assert.strictEqual(H.confirmAllowed('client'), false);
  assert.strictEqual(H.confirmAllowed(''), false);
  assert.strictEqual(H.confirmAllowed('creditsafe'), true);
  assert.deepStrictEqual(H.NUMBER_SOURCES.map(s => s.value),
    ['creditsafe', 'debtor_website', 'fmcsa', 'directory', 'other_independent']);
});

test('contact checks list blocks before warnings, in plain words', () => {
  const lines = H.renderChecks({ blocks: ['free_mail'], warnings: ['domain_mismatch'], positives: ['role_address'] });
  assert.deepStrictEqual(lines.map(l => l.level), ['block', 'warning', 'positive']);
  assert.match(lines[0].text, /free email/i);
  assert.strictEqual(H.renderChecks(null).length, 0);
});

test('flag labels', () => {
  assert.strictEqual(H.flagLabel('verify'), 'Needs verification call');
  assert.strictEqual(H.flagLabel('bounce'), 'Bounced');
  assert.strictEqual(H.flagLabel('new_thing'), 'new_thing');
});

test('age text', () => {
  assert.strictEqual(H.ageText(0), 'today');
  assert.strictEqual(H.ageText(1), '1 day');
  assert.strictEqual(H.ageText(9), '9 days');
});

// ---- page structure --------------------------------------------------------------------
test('tabs and endpoints', () => {
  for (const t of ['Queue', 'Clients', 'Needs a match', 'Campaigns', 'Directory']) assert.match(HTML, new RegExp(t));
  for (const p of ['/internal/noa/queue', '/internal/noa/records', '/internal/noa/inbox',
                   '/internal/noa/clients/search', '/confirm', '/evidence', '/release'])
    assert.ok(HTML.includes(p), p);
  assert.match(HTML, /credentials: 'include'/);
  assert.match(HTML, /noa-center-helpers\.js/);
});

test('never writes data through innerHTML', () => {
  for (const src of [HTML, HELPERS]) {
    const sets = src.match(/\.innerHTML\s*=\s*[^;]+;/g) || [];
    for (const s of sets) assert.match(s, /\.innerHTML\s*=\s*''\s*;/, s);
  }
});

test('never sends status or confirmed_by from the screen', () => {
  assert.doesNotMatch(HTML, /confirmed_by\s*:/);
  assert.doesNotMatch(HTML, /status\s*:\s*'confirmed'/);
});

// ---- boot under jsdom ------------------------------------------------------------------
function boot(responder) {
  const calls = [];
  const dom = new JSDOM(HTML.replace('<script src="noa-center-helpers.js"></script>',
                                     '<script>' + HELPERS + '</script>'), {
    runScripts: 'dangerously', url: 'https://app.operfi.com/noa-center.html',
    beforeParse(win) {
      win.fetch = (url, opts) => {
        calls.push({ url, opts });
        const [status, body] = responder(url, opts);
        return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
      };
    },
  });
  return { dom, calls };
}
const tick = () => new Promise(r => setTimeout(r, 30));

test('queue renders rows as text, escaped', async () => {
  const { dom, calls } = boot(url => url.includes('/internal/noa/queue')
    ? [200, { records: [{ noa_id: 'n1', client: { name: '<img src=x onerror=alert(1)>' },
                          debtor: { name: 'Acme Test Logistics' }, status: 'acknowledged',
                          queue_flags: ['verify'], age_days: 2, waiting_on: 'OperFi verification' }] }]
    : [200, { records: [], items: [] }]);
  await tick();
  const doc = dom.window.document;
  const row = doc.querySelector('#queue-body tr');
  assert.ok(row, 'a queue row');
  assert.match(row.textContent, /<img src=x/);
  assert.strictEqual(doc.querySelector('#queue-body img'), null);
  assert.match(row.textContent, /Needs verification call/);
  assert.strictEqual(calls[0].opts.credentials, 'include');
});

test('403 shows the access panel and no data', async () => {
  const { dom } = boot(() => [403, { error: 'Forbidden' }]);
  await tick();
  const doc = dom.window.document;
  assert.strictEqual(doc.getElementById('no-access').hidden, false);
  assert.strictEqual(doc.getElementById('app').hidden, true);
});
