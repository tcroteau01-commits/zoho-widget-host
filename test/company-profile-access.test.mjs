// The Access tab. The UI HIDES what a user cannot do; the backend REFUSES it.
// Every assertion here is about clarity for the admin, not about security --
// the security tests live in tests/test_permissions_admin_api.py.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../company-profile.html', import.meta.url), 'utf8');

function boot() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  dom.window.brokerEmail = 'boss@acme.com';
  dom.window.BROKER_API_BASE = 'http://api';
  return dom.window;
}

const CATALOG = { groups: [
  { group: 'Operations', capabilities: [
    { key: 'page.tms_load_board', label: 'TMS Load Board', sensitive: false },
    { key: 'action.load.submit', label: 'Submit a Load for Factoring', sensitive: true },
  ]},
  { group: 'Financials', capabilities: [
    { key: 'page.loads_margins', label: 'Loads & Margins', sensitive: true },
  ]},
]};

const TEMPLATES = [
  { template_id: 't_ops', name: 'Operations', is_system: true,
    capabilities: ['page.tms_load_board'], user_count: 3 },
];

test('renders a row per user showing the template name', () => {
  const w = boot();
  w.renderAccessTab([
    { portal_user_id: 'u1', name: 'Jane Doe', email: 'jane@acme.com', status: 'active',
      template_name: 'Operations', is_owner: false,
      delta: { template_count: 1, added: [], removed: [] } },
  ], TEMPLATES);
  const rows = w.document.querySelectorAll('[data-access-row]');
  assert.strictEqual(rows.length, 1);
  assert.ok(rows[0].textContent.includes('Operations'));
});

test('a user with overrides shows the delta, not just the template', () => {
  const w = boot();
  w.renderAccessTab([
    { portal_user_id: 'u1', name: 'Jane Doe', email: 'jane@acme.com', status: 'active',
      template_name: 'Operations', is_owner: false,
      delta: { template_count: 4, added: ['page.loads_margins'], removed: ['action.load.submit'] } },
  ], TEMPLATES);
  const txt = w.document.querySelector('[data-access-row]').textContent;
  assert.ok(txt.includes('+1'), 'shows added count');
  assert.ok(txt.includes('-1'), 'shows removed count');
});

test('capabilities above the admin ceiling render disabled with a reason', () => {
  const w = boot();
  const tree = w.buildCapabilityTree(CATALOG, ['page.tms_load_board'],
                                     ['page.tms_load_board', 'action.load.submit']);
  const margins = tree.querySelector('[data-cap="page.loads_margins"]');
  assert.strictEqual(margins.disabled, true, 'outside the ceiling is disabled');
  assert.ok(margins.closest('[data-cap-row]').getAttribute('title'),
            'a reason is shown rather than the control vanishing');
  const board = tree.querySelector('[data-cap="page.tms_load_board"]');
  assert.strictEqual(board.disabled, false);
  assert.strictEqual(board.checked, true);
});

test('the owner row offers no access editing', () => {
  const w = boot();
  w.renderAccessTab([
    { portal_user_id: 'u1', name: 'Owner', email: 'boss@acme.com', status: 'active',
      template_name: 'Owner / Full Access', is_owner: true,
      delta: { template_count: 30, added: [], removed: [] } },
  ], TEMPLATES);
  const row = w.document.querySelector('[data-access-row]');
  assert.ok(!row.querySelector('[data-act="edit-access"]'), 'no edit control for the owner');
});

test('collectDrawerSelection returns added and removed relative to the template', () => {
  const w = boot();
  w.currentDrawerTemplate = { template_id: 't_ops', capabilities: ['page.tms_load_board'] };
  const tree = w.buildCapabilityTree(CATALOG, ['page.loads_margins'],
    ['page.tms_load_board', 'action.load.submit', 'page.loads_margins']);
  w.document.body.appendChild(tree);
  const raw = w.collectDrawerSelection();
  // Rehydrate cross-realm arrays into host-realm plain arrays so deepStrictEqual
  // (which checks [[Prototype]] identity) works against host-realm literals --
  // same fix as draft-loads.test.mjs's mk() helper for Task 20.
  const sel = { grants_added: Array.from(raw.grants_added), grants_removed: Array.from(raw.grants_removed) };
  assert.deepStrictEqual(sel.grants_added, ['page.loads_margins']);
  assert.deepStrictEqual(sel.grants_removed, ['page.tms_load_board']);
});

test('a disabled user is shown as disabled rather than hidden', () => {
  const w = boot();
  w.renderAccessTab([
    { portal_user_id: 'u1', name: 'Gone', email: 'gone@acme.com', status: 'disabled',
      template_name: 'Operations', is_owner: false,
      delta: { template_count: 1, added: [], removed: [] } },
  ], TEMPLATES);
  const row = w.document.querySelector('[data-access-row]');
  assert.ok(row.textContent.toLowerCase().includes('disabled'));
});
