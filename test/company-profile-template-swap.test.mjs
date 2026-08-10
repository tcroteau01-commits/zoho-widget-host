// FINDING F: the access drawer computed its delta against a STALE template.
//
// openAccessDrawer snapshots currentDrawerTemplate from the user's current
// template and renders the checkbox tree from it. The template picker had no
// change handler, so switching templates rebuilt nothing -- yet saveAccess posted
// the NEW template_id alongside deltas collectDrawerSelection had computed against
// the OLD template's capability list.
//
// The backend re-derives the prospective set and re-applies the ceiling and
// last-admin checks, so this was never a privilege escalation. It was worse in a
// different way: the save silently differed from what the admin confirmed on
// screen. In a permission UI that is a defect on its own.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../company-profile.html', import.meta.url), 'utf8');

const CATALOG = { groups: [
  { group: 'Operations', capabilities: [
    { key: 'page.tms_load_board', label: 'TMS Load Board', sensitive: false },
    { key: 'action.load.submit', label: 'Submit a Load for Factoring', sensitive: true },
  ]},
  { group: 'Credit', capabilities: [
    { key: 'page.credit_check', label: 'Credit Check', sensitive: false },
    { key: 'page.customer_approvals', label: 'Customer Approvals', sensitive: false },
  ]},
]};

const TEMPLATES = [
  { template_id: 't_ops', name: 'Operations', is_system: true,
    capabilities: ['page.tms_load_board', 'action.load.submit'], user_count: 3 },
  { template_id: 't_credit', name: 'Credit', is_system: true,
    capabilities: ['page.credit_check', 'page.customer_approvals'], user_count: 1 },
];

const CEILING = ['page.tms_load_board', 'action.load.submit',
                 'page.credit_check', 'page.customer_approvals'];

function boot() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.brokerEmail = 'boss@acme.com';
  w.BROKER_API_BASE = 'http://api';
  w.accessCatalog = CATALOG;
  w.accessTemplates = TEMPLATES;
  w.adminCeiling = CEILING;
  return w;
}

function openOnOps(w) {
  w.openAccessDrawer({ portal_user_id: 'u1', name: 'Jane Doe', email: 'jane@acme.com',
                       template_id: 't_ops', delta: { added: [], removed: [] } });
}

function swapTo(w, templateId) {
  const picker = w.document.getElementById('access-template');
  picker.value = templateId;
  picker.dispatchEvent(new w.Event('change'));
}

function checkedKeys(w) {
  return Array.from(w.document.querySelectorAll('[data-cap-tree] [data-cap]'))
    .filter((b) => b.checked)
    .map((b) => b.getAttribute('data-cap'))
    .sort();
}

test('switching the template rebuilds the tree from the newly selected template', () => {
  const w = boot();
  openOnOps(w);
  assert.deepStrictEqual(checkedKeys(w),
    ['action.load.submit', 'page.tms_load_board'],
    'starts on the Operations template');

  swapTo(w, 't_credit');
  assert.deepStrictEqual(checkedKeys(w),
    ['page.credit_check', 'page.customer_approvals'],
    'the tree now shows what the Credit template actually confers');
});

test('unticking after a swap is saved, not silently discarded', () => {
  // The exact scenario from the finding: open on Operations, switch to Credit,
  // untick Credit Check. Computed against Operations that untick produced neither
  // an added nor a removed entry, so the user was saved with Credit Check still on.
  const w = boot();
  const posted = [];
  // saveAccess reloads the tab on success, so this also serves loadAccess's
  // four plain GETs -- those carry no opts and are not what is under test.
  w.fetch = (url, opts) => {
    if (opts && opts.body) posted.push({ url, body: JSON.parse(opts.body) });
    return Promise.resolve({ status: 200, json: () => Promise.resolve(
      { ok: true, groups: [], templates: [], users: [], events: [], capabilities: [] }) });
  };

  openOnOps(w);
  swapTo(w, 't_credit');
  w.document.querySelector('[data-cap="page.credit_check"]').checked = false;

  return w.saveAccess().then(() => {
    const body = posted.find((p) => p.url.indexOf('/permissions/user') !== -1).body;
    assert.strictEqual(body.template_id, 't_credit');
    assert.deepStrictEqual(Array.from(body.grants_removed), ['page.credit_check'],
      'the untick the admin made on screen is what gets saved');
    assert.deepStrictEqual(Array.from(body.grants_added), []);
  });
});

test('ticks the admin already made survive the swap', () => {
  // A capability added before the swap is still an intentional addition after it,
  // so it is carried forward rather than silently dropped.
  const w = boot();
  openOnOps(w);
  w.document.querySelector('[data-cap="page.credit_check"]').checked = true;

  swapTo(w, 't_credit');
  // page.credit_check is now part of the template rather than an override, so it
  // stays ticked either way; the load board tick must NOT reappear.
  assert.deepStrictEqual(checkedKeys(w),
    ['page.credit_check', 'page.customer_approvals']);

  w.document.querySelector('[data-cap="page.tms_load_board"]').checked = true;
  swapTo(w, 't_ops');
  assert.deepStrictEqual(checkedKeys(w),
    ['action.load.submit', 'page.tms_load_board'],
    'back on Operations the tree shows the Operations template again');
});

test('an addition made before the swap is still posted as an addition after it', () => {
  const w = boot();
  const posted = [];
  // saveAccess reloads the tab on success, so this also serves loadAccess's
  // four plain GETs -- those carry no opts and are not what is under test.
  w.fetch = (url, opts) => {
    if (opts && opts.body) posted.push({ url, body: JSON.parse(opts.body) });
    return Promise.resolve({ status: 200, json: () => Promise.resolve(
      { ok: true, groups: [], templates: [], users: [], events: [], capabilities: [] }) });
  };

  openOnOps(w);
  // Not in Operations, so this is an override the admin deliberately added.
  w.document.querySelector('[data-cap="page.customer_approvals"]').checked = true;
  swapTo(w, 't_ops');   // re-select the SAME template: nothing should be lost

  return w.saveAccess().then(() => {
    const body = posted.find((p) => p.url.indexOf('/permissions/user') !== -1).body;
    assert.deepStrictEqual(Array.from(body.grants_added), ['page.customer_approvals']);
    assert.deepStrictEqual(Array.from(body.grants_removed), []);
  });
});

test('the swap handler does not fire while the template editor is open', () => {
  // openTemplateEditor hides the picker and reuses the same drawer. A stray
  // rebuild there would replace the template's own capability tree.
  const w = boot();
  w.openTemplateEditor({ template_id: 't_mine', name: 'Mine', description: '',
                         capabilities: ['page.credit_check'] });
  assert.deepStrictEqual(checkedKeys(w), ['page.credit_check']);
  assert.strictEqual(
    w.document.getElementById('access-template-field').style.display, 'none',
    'the picker is hidden in template mode, so it cannot be changed');
});
