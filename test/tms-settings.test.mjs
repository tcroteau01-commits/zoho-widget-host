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
    url: opts.noServiceOrigin
      ? 'https://tcroteau01-commits.github.io/tms-settings.html'
      : 'https://tcroteau01-commits.github.io/tms-settings.html?serviceOrigin=https%3A%2F%2Fbrokerhub.operfi.com',
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
  window.document.querySelector('#body-detention .ed-save').click();
  await window.saveSettings();
  const sent = posts[0].body.clauses.find((c) => c.id === 'detention');
  assert.equal(sent.body, 'Detention is now {rate} per hour, flat.');
});

test('blur no longer commits an edit; only Done does (TMSFB1)', () => {
  const { window } = makeWidget();
  hydrate(window);
  window.editBody(1);
  const ta = window.document.querySelector('#body-detention textarea');
  ta.value = 'Changed.';
  ta.dispatchEvent(new window.Event('blur', { bubbles: true }));
  assert.ok(window.document.querySelector('#body-detention textarea'), 'editor stays open');
  assert.equal(window.collectClauses()[1].body, 'Detention at {rate} per hour.');
  assert.match(window.document.querySelector('#body-detention .ed-save').textContent, /Done/);
});

test('Cancel discards an edit and restores the preview', () => {
  const { window } = makeWidget();
  hydrate(window);
  window.editBody(1);
  window.document.querySelector('#body-detention textarea').value = 'Changed.';
  window.document.querySelector('#body-detention .ed-cancel').click();
  assert.equal(window.document.querySelector('#body-detention textarea'), null);
  assert.equal(window.collectClauses()[1].body, 'Detention at {rate} per hour.');
});

test('an empty body on Done shows an inline error and keeps the old body', async () => {
  const { window, posts } = makeWidget();
  hydrate(window);
  window.brokerEmail = 't@x.com';
  window.editBody(1);
  window.document.querySelector('#body-detention textarea').value = '   ';
  window.document.querySelector('#body-detention .ed-save').click();
  assert.match(window.document.querySelector('#body-detention .ed-err').textContent, /empty/);
  await window.saveSettings();
  assert.equal(posts[0].body.clauses.length, 3, 'no clause should have been dropped');
  const sent = posts[0].body.clauses.find((c) => c.id === 'detention');
  assert.equal(sent.body, 'Detention at {rate} per hour.', 'original body preserved');
});

test('a custom clause title is editable; a built-in title is not', () => {
  const { window } = makeWidget();
  hydrate(window);
  window.addCustomClause('Reefer', 'Run continuous.');
  window.editBody(1);
  assert.equal(window.document.querySelector('#body-detention .ed-title'), null);
  window.document.querySelector('#body-detention .ed-cancel').click();
  window.editBody(3);
  const ti = window.document.querySelector('#body-custom_1 .ed-title');
  assert.ok(ti, 'custom clause shows a title input');
  ti.value = 'Reefer Continuous Run';
  window.document.querySelector('#body-custom_1 .ed-save').click();
  assert.equal(window.collectClauses()[3].title, 'Reefer Continuous Run');
});

const loaded = (window) => new Promise((r) => {
  if (window.document.readyState === 'complete') { setTimeout(r, 0); } else { window.addEventListener('load', () => setTimeout(r, 0)); }
});

test('+ Add custom clause opens an in-page editor and never calls prompt()', async () => {
  const { window } = makeWidget();
  await loaded(window);
  hydrate(window);
  let prompted = 0;
  window.prompt = () => { prompted++; return 'x'; };
  window.document.getElementById('btn-add').click();
  const host = window.document.getElementById('add-editor-host');
  const ti = host.querySelector('.ed-title');
  const ta = host.querySelector('textarea');
  assert.ok(ti && ta, 'title input + textarea rendered in the page');
  assert.ok(ta.rows >= 6, 'tall textarea');
  ti.value = 'Reefer Continuous Run';
  ta.value = 'Line one.\r\n\r\n\r\n\r\nLine\u00A0two.   ';
  host.querySelector('.ed-save').click();
  assert.equal(prompted, 0);
  const out = window.collectClauses();
  assert.equal(out.length, 4);
  assert.equal(out[3].title, 'Reefer Continuous Run');
  assert.equal(out[3].body, 'Line one.\n\nLine two.');
  assert.equal(host.children.length, 0, 'editor closes after save');
});

test('add editor Cancel adds nothing; a missing title is refused inline', () => {
  const { window } = makeWidget();
  hydrate(window);
  window.openAddClause();
  const host = window.document.getElementById('add-editor-host');
  host.querySelector('textarea').value = 'Body only';
  host.querySelector('.ed-save').click();
  assert.match(host.querySelector('.ed-err').textContent, /title/);
  host.querySelector('.ed-cancel').click();
  assert.equal(window.collectClauses().length, 3);
  assert.equal(host.children.length, 0);
});

test('the source has no window.prompt clause flow left', () => {
  assert.doesNotMatch(HTML, /window\.prompt\(/);
  assert.doesNotMatch(HTML, /promptCustomClause/);
});

test('cleanClauseText applies the shared paste-cleanup rules', () => {
  const { window } = makeWidget();
  const c = window.cleanClauseText;
  assert.equal(c('a\r\nb\rc'), 'a\nb\nc');
  assert.equal(c('a\u00A0b\u2003c\u202Fd'), 'a b c d');
  assert.equal(c('a\u200Bb\uFEFFc\u200Dd'), 'abcd');
  assert.equal(c('a\tb'), 'a b');
  assert.equal(c('line one   \nline two \t'), 'line one\nline two');
  assert.equal(c('p1\n\n\n\n\np2'), 'p1\n\np2');
  assert.equal(c('keep  two  spaces\nand single break'), 'keep  two  spaces\nand single break');
});

test('pasting into the clause editor inserts cleaned text', () => {
  const { window } = makeWidget();
  hydrate(window);
  window.openAddClause();
  const ta = window.document.querySelector('#add-editor-host textarea');
  ta.value = 'Start: ';
  ta.selectionStart = ta.selectionEnd = ta.value.length;
  const ev = new window.Event('paste', { bubbles: true, cancelable: true });
  ev.clipboardData = { getData: () => 'Para\u00A0one.\r\n\r\n\r\nPara two.\u200B' };
  ta.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(ta.value, 'Start: Para one.\n\nPara two.');
});

test('clause body preview keeps line breaks (white-space: pre-line)', () => {
  assert.match(HTML, /\.cl-body \{[^}]*white-space:pre-line/);
});

// ---- Load Settings card (TMSFB1) ----
const DS = { load_prefix: 'ACME', load_prefix_default: 'ACME', load_start: null,
             pod_alert_hours: 48, next_load_number: 'ACME-1043', can_edit: true };

test('Load Settings card renders the GET values and the server next load #', () => {
  const { window } = makeWidget();
  window.applyDispatchSettings(JSON.parse(JSON.stringify(DS)));
  const doc = window.document;
  assert.equal(doc.getElementById('load-settings-card').style.display, '');
  assert.equal(doc.getElementById('ls-prefix').value, 'ACME');
  assert.equal(doc.getElementById('ls-start').value, '');
  assert.equal(doc.getElementById('ls-pod-hours').value, '48');
  assert.equal(doc.getElementById('ls-next').textContent, 'ACME-1043');
  // card sits above Rate Confirmation Terms
  const cards = [...doc.querySelectorAll('.card')];
  assert.equal(cards[0].id, 'load-settings-card');
});

test('the next load # preview reacts to a raised start and a new prefix', async () => {
  const { window } = makeWidget();
  await loaded(window);
  window.applyDispatchSettings(JSON.parse(JSON.stringify(DS)));
  const doc = window.document;
  const start = doc.getElementById('ls-start');
  start.value = '5001';
  start.dispatchEvent(new window.Event('input'));
  assert.equal(doc.getElementById('ls-next').textContent, 'ACME-5001');
  start.value = '10';
  start.dispatchEvent(new window.Event('input'));
  assert.equal(doc.getElementById('ls-next').textContent, 'ACME-1043', 'never moves backward');
  const pf = doc.getElementById('ls-prefix');
  pf.value = 'xy9';
  pf.dispatchEvent(new window.Event('input'));
  assert.equal(pf.value, 'XY9', 'uppercased');
  assert.equal(doc.getElementById('ls-next').textContent, 'XY9-10');
});

test('Load Settings save posts the three fields to /tms-dispatch-settings', async () => {
  const { window, posts } = makeWidget();
  window.brokerEmail = 't@x.com';
  window.applyDispatchSettings(JSON.parse(JSON.stringify(DS)));
  const doc = window.document;
  doc.getElementById('ls-start').value = '5001';
  doc.getElementById('ls-pod-hours').value = '24';
  await window.saveDispatchSettings();
  const p = posts.find((x) => /\/tms-dispatch-settings$/.test(x.url));
  assert.ok(p, 'posted');
  assert.deepEqual(p.body, { email: 't@x.com', load_prefix: 'ACME', load_start: 5001, pod_alert_hours: 24 });
  assert.equal(posts.filter((x) => /\/tms-settings$/.test(x.url)).length, 0, 'terms not re-saved');
});

test('Load Settings validation blocks a bad prefix or hours without posting', async () => {
  const { window, posts } = makeWidget();
  window.applyDispatchSettings(JSON.parse(JSON.stringify(DS)));
  const doc = window.document;
  doc.getElementById('ls-prefix').value = 'TOOLONG1';
  await window.saveDispatchSettings();
  assert.match(doc.getElementById('ls-err').textContent, /1 to 6/);
  doc.getElementById('ls-prefix').value = 'ACME';
  doc.getElementById('ls-pod-hours').value = '0';
  await window.saveDispatchSettings();
  assert.match(doc.getElementById('ls-err').textContent, /720/);
  assert.equal(posts.length, 0);
});

test('Load Settings is read-only when can_edit is false', () => {
  const { window } = makeWidget();
  window.applyDispatchSettings(Object.assign({}, DS, { can_edit: false }));
  const doc = window.document;
  assert.equal(doc.getElementById('ls-prefix').disabled, true);
  assert.equal(doc.getElementById('ls-pod-hours').disabled, true);
  assert.equal(doc.getElementById('btn-ls-save').style.display, 'none');
  assert.equal(doc.getElementById('ls-readonly-banner').style.display, 'block');
});

test('an old API (no dispatch-settings fields, or a failed GET) hides the card', async () => {
  const { window } = makeWidget();
  window.brokerEmail = 't@x.com';
  await window.loadDispatchSettings(); // mock returns the clauses payload, no new keys
  assert.equal(window.document.getElementById('load-settings-card').style.display, 'none');
  window.fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'Not Found' }) });
  await window.loadDispatchSettings();
  assert.equal(window.document.getElementById('load-settings-card').style.display, 'none');
  window.fetch = () => Promise.reject(new Error('net'));
  await window.loadDispatchSettings();
  assert.equal(window.document.getElementById('load-settings-card').style.display, 'none');
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

test('a back button returns to the Dispatch Board via serviceOrigin', () => {
  const { window } = makeWidget();
  const btn = window.document.getElementById('back-btn');
  assert.ok(btn, 'expected a back button');
  assert.match(btn.textContent, /Dispatch Board/);
  // Settings is hidden from the sidebar, so this link is the only way back.
  assert.equal(window.portalPageUrl('TMS_Dispatch_Board'),
               'https://brokerhub.operfi.com/#Page:TMS_Dispatch_Board');
});

test('portalPageUrl degrades to a bare hash when serviceOrigin is absent', () => {
  const { window } = makeWidget({ noServiceOrigin: true });
  assert.equal(window.portalPageUrl('TMS_Dispatch_Board'), '/#Page:TMS_Dispatch_Board');
});
