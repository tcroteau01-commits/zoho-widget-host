import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../tms-load-detail.html', import.meta.url), 'utf8');

const TERMS = [
  { id: 'double_broker', title: 'No Double Brokering', enabled: true, body: 'No re-brokering.', vars: {}, custom: false },
  { id: 'detention', title: 'Detention', enabled: true, body: 'Detention at {rate} per hour.', vars: { rate: '$50.00' }, custom: false },
  { id: 'tonu', title: 'Truck Ordered Not Used', enabled: false, body: 'TONU is {fee}.', vars: { fee: '$150.00' }, custom: false },
];

function load(over) {
  return Object.assign({
    id: 'L1', load_number: 'MAR-1042', status: 'Covered', added_time: '29-Jul-2026 10:00:00',
    rate_con_terms: JSON.parse(JSON.stringify(TERMS)),
    terms_customized: false, terms_unlocked_by: '', terms_unlocked_at: '',
  }, over || {});
}

function makeWidget(opts) {
  opts = opts || {};
  const posts = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/tms-load-detail.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = function (url, init) {
        if (init && init.method === 'POST') {
          posts.push({ url: url, body: JSON.parse(init.body) });
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, terms_customized: true }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      };
    }
  });
  dom.window.canEditTerms = opts.canEdit !== false;
  return { window: dom.window, posts };
}

test('locked card lists the enabled clauses with vars substituted', () => {
  const { window } = makeWidget();
  window.renderTermsCard(load());
  const items = window.document.querySelectorAll('#terms-card ol.snap li');
  assert.equal(items.length, 2);
  assert.match(items[1].textContent, /Detention at \$50\.00 per hour\./);
  assert.equal(window.document.querySelectorAll('#terms-card .clause').length, 0);
});

test('the unlock button is hidden without Full Access', () => {
  const { window } = makeWidget({ canEdit: false });
  window.renderTermsCard(load());
  assert.equal(window.document.getElementById('terms-unlock'), null);
  assert.match(window.document.getElementById('terms-card').textContent, /Full Access/);
});

test('unlock swaps the snapshot list for the editor', () => {
  const { window } = makeWidget();
  window.renderTermsCard(load());
  window.unlockTerms();
  assert.equal(window.document.querySelectorAll('#terms-card ol.snap').length, 0);
  assert.equal(window.document.querySelectorAll('#terms-card .clause').length, 3);
});

test('a customized load shows the badge and the unlock stamp', () => {
  const { window } = makeWidget();
  window.renderTermsCard(load({
    terms_customized: true, terms_unlocked_by: 'T. Croteau',
    terms_unlocked_at: '2026-07-30T14:14:00' }));
  const txt = window.document.getElementById('terms-card').textContent;
  assert.match(txt, /Customized/);
  assert.match(txt, /T\. Croteau/);
});

test('an existing rate con triggers the regenerate warning', () => {
  const { window } = makeWidget();
  window.renderTermsCard(load(), [{ document_type: 'Rate Con', uploaded_at: '2026-07-29T11:00:00' }]);
  assert.match(window.document.getElementById('terms-card').textContent, /[Rr]egenerate/);
});

test('the card is hidden on a submitted load, with no leftover editor DOM', () => {
  const { window } = makeWidget();
  window.renderTermsCard(load());
  window.unlockTerms();
  assert.equal(window.document.querySelectorAll('#terms-card .clause').length, 3);
  window.renderTermsCard(load({ status: 'Submitted' }));
  assert.equal(window.document.getElementById('terms-card').style.display, 'none');
  assert.equal(window.document.querySelectorAll('#terms-card .clause').length, 0);
});

test('an unlocked in-progress edit survives a re-render triggered by an unrelated refresh', () => {
  const { window } = makeWidget();
  const original = load();
  window.renderTermsCard(original);
  window.unlockTerms();
  const input = window.document.getElementById('tv-detention-rate');
  input.value = '$75.00';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  // Simulate refreshDocs() re-rendering the card from the same, unmutated load object
  // after an unrelated action (uploading a doc, removing one from the packet, etc.).
  window.renderTermsCard(original);
  const after = window.document.getElementById('tv-detention-rate');
  assert.equal(after.value, '$75.00');
});

test('save posts the edited set to /tms-load-terms', async () => {
  const { window, posts } = makeWidget();
  window.brokerEmail = 't@x.com';
  window.renderTermsCard(load());
  window.unlockTerms();
  window.termsToggle(2, true);
  await window.saveLoadTerms();
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /\/tms-load-terms$/);
  assert.equal(posts[0].body.load_id, 'L1');
  assert.equal(posts[0].body.clauses[2].enabled, true);
});

test('reset posts the reset flag', async () => {
  const { window, posts } = makeWidget();
  window.brokerEmail = 't@x.com';
  window.renderTermsCard(load());
  window.unlockTerms();
  await window.resetLoadTerms();
  assert.equal(posts[0].body.reset, true);
});

test('save preserves {token} placeholders when a var is edited through the real input handler', async () => {
  const { window, posts } = makeWidget();
  window.brokerEmail = 't@x.com';
  window.renderTermsCard(load());
  window.unlockTerms();
  const input = window.document.getElementById('tv-detention-rate');
  input.value = '$75.00';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await window.saveLoadTerms();
  const sent = posts[0].body.clauses.find((c) => c.id === 'detention');
  assert.match(sent.body, /\{rate\}/);
  assert.doesNotMatch(sent.body, /\$75\.00/);
  assert.equal(sent.vars.rate, '$75.00');
});

test('save preserves the raw body text through the real body editor, not the substituted preview', async () => {
  const { window, posts } = makeWidget();
  window.brokerEmail = 't@x.com';
  window.renderTermsCard(load());
  window.unlockTerms();
  window.termsEditBody(1);
  const ta = window.document.querySelector('#tbody-detention textarea');
  assert.match(ta.value, /\{rate\}/); // seeds RAW text, not the substituted preview
  ta.value = 'Detention is now {rate} per hour, flat.';
  ta.dispatchEvent(new window.Event('blur', { bubbles: true }));
  await window.saveLoadTerms();
  const sent = posts[0].body.clauses.find((c) => c.id === 'detention');
  assert.equal(sent.body, 'Detention is now {rate} per hour, flat.');
});
