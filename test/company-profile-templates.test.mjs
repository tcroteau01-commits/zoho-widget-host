// Templates tab, invite picker, disable control, activity list.
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

const TEMPLATES = [
  { template_id: 'sys_ops', name: 'Operations', is_system: true,
    description: 'Book loads and submit for factoring.',
    capabilities: ['page.tms_load_board'], user_count: 4 },
  { template_id: 'mine', name: 'Night Dispatch', is_system: false,
    description: 'Ours', capabilities: ['page.tms_load_board'], user_count: 0 },
];

test('starter templates offer Clone but not Edit or Delete', () => {
  const w = boot();
  w.renderTemplatesTab(TEMPLATES);
  const row = w.document.querySelector('[data-template-row="sys_ops"]');
  assert.ok(row.querySelector('[data-act="clone-template"]'), 'Clone offered');
  assert.ok(!row.querySelector('[data-act="edit-template"]'), 'no Edit on a starter');
  assert.ok(!row.querySelector('[data-act="delete-template"]'), 'no Delete on a starter');
});

test('an account template in use cannot be deleted from the UI', () => {
  const w = boot();
  w.renderTemplatesTab([Object.assign({}, TEMPLATES[1], { user_count: 3 })]);
  const row = w.document.querySelector('[data-template-row="mine"]');
  const del = row.querySelector('[data-act="delete-template"]');
  assert.strictEqual(del.disabled, true);
  assert.ok(del.getAttribute('title').includes('3'), 'says how many users block it');
});

test('template rows show their user count', () => {
  const w = boot();
  w.renderTemplatesTab(TEMPLATES);
  const row = w.document.querySelector('[data-template-row="sys_ops"]');
  assert.ok(row.textContent.includes('4'));
});

test('the invite modal requires a template choice', () => {
  const w = boot();
  w.renderInviteTemplatePicker(TEMPLATES);
  const picker = w.document.getElementById('invite-template');
  assert.ok(picker, 'picker rendered');
  assert.strictEqual(picker.value, '', 'no template preselected');
  assert.strictEqual(picker.required, true);
});

test('activity renders impersonation as done on behalf of someone', () => {
  const w = boot();
  w.renderActivity([{ at: '2026-08-09T00:00:00Z', action: 'set_access',
                      subject_email: 'jane@acme.com', actor_portal_user_id: 'operfi1',
                      acting_as_portal_user_id: 'admin1' }]);
  const txt = w.document.getElementById('activity-list').textContent;
  assert.ok(txt.includes('jane@acme.com'));
  assert.ok(txt.toLowerCase().includes('on behalf of'));
});

test('a disabled user offers Enable rather than Disable', () => {
  const w = boot();
  w.renderAccessTab([
    { portal_user_id: 'u1', name: 'Gone', email: 'g@acme.com', status: 'disabled',
      template_name: 'Operations', is_owner: false,
      delta: { template_count: 1, added: [], removed: [] } },
  ], TEMPLATES);
  const btn = w.document.querySelector('[data-access-row] [data-act="toggle-status"]');
  assert.strictEqual(btn.textContent, 'Enable');
});

test('saving a cloned template posts to /permissions/template with no template_id', () => {
  const w = boot();
  w.accessCatalog = { groups: [] };
  w.adminCeiling = [];
  w.openTemplateEditor({ name: 'Operations (copy)', description: 'Book loads and submit for factoring.',
                         capabilities: ['page.tms_load_board'] });
  // Capture only the save itself: on a 200 saveTemplate calls loadAccess(),
  // which fires several more fetches synchronously and would otherwise
  // overwrite this before the assertions below run.
  let captured = null;
  w.fetch = (url, opts) => {
    if (!captured) captured = { url, opts };
    return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, template_id: 'new_1' }) });
  };
  return w.saveTemplate().then(() => {
    assert.ok(captured, 'fetch was called');
    assert.ok(captured.url.indexOf('/permissions/template') !== -1, 'hits the template endpoint');
    const sent = JSON.parse(captured.opts.body);
    assert.strictEqual(sent.template_id, undefined, 'a clone mints a new id server-side');
    assert.strictEqual(sent.name, 'Operations (copy)');
  });
});

test('saving an edit posts with the template_id', () => {
  const w = boot();
  w.accessCatalog = { groups: [] };
  w.adminCeiling = [];
  w.openTemplateEditor(Object.assign({}, TEMPLATES[1]));
  let captured = null;
  w.fetch = (url, opts) => {
    if (!captured) captured = { url, opts };
    return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, template_id: 'mine' }) });
  };
  return w.saveTemplate().then(() => {
    const sent = JSON.parse(captured.opts.body);
    assert.strictEqual(sent.template_id, 'mine');
  });
});

test('a 409 from saving a template surfaces the server message rather than failing silently', () => {
  const w = boot();
  w.accessCatalog = { groups: [] };
  w.adminCeiling = [];
  w.openTemplateEditor(Object.assign({}, TEMPLATES[1]));
  const serverMsg = 'Removing users.manage from this template would leave the account '
    + 'with nobody who can manage users. Give someone else that access first.';
  w.fetch = () => Promise.resolve({ status: 409, json: () => Promise.resolve({ error: serverMsg }) });
  return w.saveTemplate().then(() => {
    const shown = w.document.getElementById('company-body').textContent;
    assert.ok(shown.includes('nobody who can manage users'), 'surfaces the real server message, got: ' + shown);
  });
});
