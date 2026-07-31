import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../tms-settings.html', import.meta.url), 'utf8');

const CLAUSES = [
  { id: 'double_broker', title: 'No Double Brokering', enabled: true, body: 'No re-brokering.', vars: {}, custom: false },
  { id: 'detention', title: 'Detention', enabled: true, body: 'Detention at {rate} per hour.', vars: { rate: '$50.00' }, custom: false },
  { id: 'tonu', title: 'Truck Ordered Not Used', enabled: false, body: 'TONU is {fee}.', vars: { fee: '$150.00' }, custom: false },
];

function makeWidget(opts) {
  opts = opts || {};
  const posts = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/tms-settings.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = function (url, init) {
        if (init && init.method === 'POST') {
          posts.push({ url: url, body: JSON.parse(init.body) });
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({
          clauses: JSON.parse(JSON.stringify(CLAUSES)),
          updated_at: '2026-07-30T09:00:00', updated_by: 'T. Croteau',
          seeded: false, can_edit: opts.canEdit !== false,
        }) });
      };
    }
  });
  return { window: dom.window, posts };
}

function hydrate(window, canEdit) {
  window.applySettings({
    clauses: JSON.parse(JSON.stringify(CLAUSES)),
    updated_at: '2026-07-30T09:00:00', updated_by: 'T. Croteau',
    seeded: false, can_edit: canEdit !== false,
  });
}

test('renders one row per clause with the enabled state reflected', () => {
  const { window } = makeWidget();
  hydrate(window);
  const rows = window.document.querySelectorAll('.clause');
  assert.equal(rows.length, 3);
  assert.equal(window.document.querySelectorAll('.clause input[type=checkbox]:checked').length, 2);
  assert.ok(rows[2].classList.contains('off'));
});

test('substitutes vars into the previewed body', () => {
  const { window } = makeWidget();
  hydrate(window);
  const body = window.document.querySelectorAll('.clause .cl-body')[1];
  assert.match(body.textContent, /Detention at \$50\.00 per hour\./);
});

test('toggling a clause updates the collected set', () => {
  const { window } = makeWidget();
  hydrate(window);
  window.toggleClause(2, true);
  const out = window.collectClauses();
  assert.equal(out[2].enabled, true);
});

test('editing a var value is collected', () => {
  const { window } = makeWidget();
  hydrate(window);
  const input = window.document.getElementById('v-detention-rate');
  input.value = '$75.00';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(window.collectClauses()[1].vars.rate, '$75.00');
});

test('a custom clause can be added and removed', () => {
  const { window } = makeWidget();
  hydrate(window);
  window.addCustomClause('Reefer Continuous Run', 'Unit must run continuous.');
  let out = window.collectClauses();
  assert.equal(out.length, 4);
  assert.equal(out[3].custom, true);
  window.removeClause(3);
  assert.equal(window.collectClauses().length, 3);
});

test('a built-in clause cannot be removed', () => {
  const { window } = makeWidget();
  hydrate(window);
  window.removeClause(0);
  assert.equal(window.collectClauses().length, 3);
});

test('clauses can be reordered', () => {
  const { window } = makeWidget();
  hydrate(window);
  window.moveClause(0, 1);
  assert.equal(window.collectClauses()[0].id, 'detention');
});

test('save posts the normalized set to /tms-settings', async () => {
  const { window, posts } = makeWidget();
  hydrate(window);
  window.brokerEmail = 't@x.com';
  await window.saveSettings();
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /\/tms-settings$/);
  assert.equal(posts[0].body.email, 't@x.com');
  assert.equal(posts[0].body.clauses.length, 3);
});

test('read-only mode renders no inputs, no save, and a banner', () => {
  const { window } = makeWidget({ canEdit: false });
  hydrate(window, false);
  const doc = window.document;
  assert.equal(doc.querySelectorAll('.clause input').length, 0);
  assert.equal(doc.getElementById('btn-save').style.display, 'none');
  assert.match(doc.getElementById('readonly-banner').textContent, /Full Access/);
});

test('custom clause ids stay unique across add, add, remove-the-first, add', () => {
  const { window } = makeWidget();
  hydrate(window);
  window.addCustomClause('Custom A', 'Body A');
  window.addCustomClause('Custom B', 'Body B');
  // remove the first custom clause (index 3: 3 built-ins + the first custom)
  window.removeClause(3);
  window.addCustomClause('Custom C', 'Body C');
  const ids = window.collectClauses().filter((c) => c.custom).map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('a var edit does not substitute into the body that gets posted', async () => {
  const { window, posts } = makeWidget();
  hydrate(window);
  window.brokerEmail = 't@x.com';
  const input = window.document.getElementById('v-detention-rate');
  input.value = '$75.00';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await window.saveSettings();
  const sent = posts[0].body.clauses.find((c) => c.id === 'detention');
  assert.match(sent.body, /\{rate\}/);
  assert.doesNotMatch(sent.body, /\$75\.00/);
  assert.equal(sent.vars.rate, '$75.00');
});

test('editing a body through the editor stores the raw text, not the substituted preview', async () => {
  const { window, posts } = makeWidget();
  hydrate(window);
  window.brokerEmail = 't@x.com';
  window.editBody(1);
  const ta = window.document.querySelector('#body-detention textarea');
  assert.match(ta.value, /\{rate\}/); // editor seeds RAW text, not the preview
  ta.value = 'Detention is now {rate} per hour, flat.';
  ta.dispatchEvent(new window.Event('blur', { bubbles: true }));
  await window.saveSettings();
  const sent = posts[0].body.clauses.find((c) => c.id === 'detention');
  assert.equal(sent.body, 'Detention is now {rate} per hour, flat.');
});

test('clearing a clause body on blur restores the previous body instead of deleting it', async () => {
  const { window, posts } = makeWidget();
  hydrate(window);
  window.brokerEmail = 't@x.com';
  window.editBody(1);
  const ta = window.document.querySelector('#body-detention textarea');
  ta.value = '   ';
  ta.dispatchEvent(new window.Event('blur', { bubbles: true }));
  await window.saveSettings();
  assert.equal(posts[0].body.clauses.length, 3, 'no clause should have been dropped');
  const sent = posts[0].body.clauses.find((c) => c.id === 'detention');
  assert.equal(sent.body, 'Detention at {rate} per hour.', 'original body preserved');
});

test('loadSettings routes a non-2xx response to the same failure path as a network error', async () => {
  const { window } = makeWidget();
  window.fetch = function () {
    return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'Unauthorized' }) });
  };
  window.brokerEmail = 't@x.com';
  await window.loadSettings();
  assert.match(window.document.getElementById('clause-list').textContent, /Could not load terms/);
  // must NOT have rendered an empty clause list with a live save button
  assert.equal(window.document.querySelectorAll('.clause').length, 0);
});

test('boot() does not throw when getInitParams returns a plain object instead of a Promise', () => {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/tms-settings.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => ({ loginUser: 'b@op.com' }) } } };
      window.fetch = function () { return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); };
    }
  });
  assert.doesNotThrow(() => { dom.window.boot(); });
});

test('boot() reads login_user and email aliases, matching the sibling TMS widgets', async () => {
  for (const alias of ['login_user', 'email']) {
    let capturedEmail = '';
    const params = {}; params[alias] = 'b2@op.com';
    const dom = new JSDOM(HTML, {
      runScripts: 'dangerously',
      url: 'https://tcroteau01-commits.github.io/tms-settings.html',
      beforeParse(window) {
        window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => Promise.resolve(params) } } };
        window.fetch = function (url) {
          capturedEmail = new URL(url, 'https://x').searchParams.get('email');
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ clauses: [] }) });
        };
      }
    });
    dom.window.boot();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(capturedEmail, 'b2@op.com', 'alias "' + alias + '" should be picked up');
  }
});

test('the impersonation script is included, matching the sibling TMS widgets', () => {
  assert.match(HTML, /operfi-impersonate\.js/);
});
