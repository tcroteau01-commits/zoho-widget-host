// PERMEDIT1: editing a Trusted Contact's template silently did nothing.
//
// The Add/Edit Contact modal sent template_id on ADD but never on EDIT, so an
// admin changing a user's access got a 200 and a success message while
// /broker-edit-contact wrote only Creator's User_Permissions -- a field
// nothing reads for access on a flipped (PERM3) account. See the fix in
// submitContact(): a changed template now goes to /permissions/user, the
// single gate with the ceiling and last-admin guardrails, and it goes FIRST
// so a refusal never lets a stale-name-but-changed-template save proceed.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../company-profile.html', import.meta.url), 'utf8');

function boot() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.brokerEmail = 'boss@acme.com';
  w.BROKER_API_BASE = 'http://api';
  return w;
}

// Populates the invite-template picker the way renderInviteTemplatePicker
// does: a blank placeholder plus real templates, which is what makes
// templatesGovern()/templatesAvailable read true.
function setTemplates(w, templates) {
  const picker = w.document.getElementById('invite-template');
  picker.innerHTML = '';
  const blank = w.document.createElement('option');
  blank.value = '';
  blank.textContent = 'Choose a template';
  picker.appendChild(blank);
  templates.forEach((t) => {
    const o = w.document.createElement('option');
    o.value = t.template_id;
    o.textContent = t.name;
    picker.appendChild(o);
  });
}

// The index openEditModal/submitContact read through accessFor(), populated
// exactly as renderAccessTab populates accessByEmail.
function setAccessIndex(w, users) {
  w.renderAccessTab(users, []);
}

const CONTACT = {
  ID: '900',
  Contact_Name: { first_name: 'Jane', last_name: 'Doe' },
  Email: 'jane@acme.com',
  Phone_Number: '(555) 111-2222',
  User_Permissions: ['Full Access'],
};

function editOn(w, templates, users) {
  setTemplates(w, templates);
  setAccessIndex(w, users);
  w.openEditModal(Object.assign({}, CONTACT));
}

test('editing with a changed template posts to /permissions/user with portal_user_id + template_id', () => {
  const w = boot();
  editOn(w,
    [{ template_id: 't_ops', name: 'Operations' }, { template_id: 't_credit', name: 'Credit' }],
    [{ portal_user_id: 'pu_1', email: 'jane@acme.com', template_id: 't_ops', status: 'active', is_owner: false }]);

  // Picker preselects the user's CURRENT template on open.
  assert.strictEqual(w.document.getElementById('invite-template').value, 't_ops');

  // Admin picks a different template.
  w.document.getElementById('invite-template').value = 't_credit';

  const posted = [];
  w.fetch = (url, opts) => {
    posted.push({ url, opts });
    if (url.indexOf('/permissions/user') !== -1) {
      return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true })) });
    }
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, id: '900' })) });
  };

  w.submitContact();
  const permCall = posted.find((p) => p.url.indexOf('/permissions/user') !== -1);
  assert.ok(permCall, '/permissions/user was called');
  const body = JSON.parse(permCall.opts.body);
  assert.strictEqual(body.portal_user_id, 'pu_1');
  assert.strictEqual(body.template_id, 't_credit');
});

test('editing with an unchanged template does NOT post to /permissions/user', () => {
  const w = boot();
  editOn(w,
    [{ template_id: 't_ops', name: 'Operations' }, { template_id: 't_credit', name: 'Credit' }],
    [{ portal_user_id: 'pu_1', email: 'jane@acme.com', template_id: 't_ops', status: 'active', is_owner: false }]);

  assert.strictEqual(w.document.getElementById('invite-template').value, 't_ops');
  // Admin leaves the picker alone and only edits, say, nothing -- a plain re-save.

  const posted = [];
  w.fetch = (url, opts) => {
    posted.push({ url, opts });
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, id: '900' })) });
  };

  w.submitContact();
  assert.ok(!posted.some((p) => p.url.indexOf('/permissions/user') !== -1),
    'an unchanged template must not generate a write or an audit row');
});

test('a refused /permissions/user (403 ceiling) surfaces its message and does NOT then post to /broker-edit-contact', async () => {
  const w = boot();
  editOn(w,
    [{ template_id: 't_ops', name: 'Operations' }, { template_id: 't_credit', name: 'Credit' }],
    [{ portal_user_id: 'pu_1', email: 'jane@acme.com', template_id: 't_ops', status: 'active', is_owner: false }]);

  w.document.getElementById('invite-template').value = 't_credit';
  // Also change the name, so a bug that ignores the refusal would show up as
  // a /broker-edit-contact call going out anyway.
  w.document.getElementById('m-first').value = 'Janet';

  const posted = [];
  w.fetch = (url, opts) => {
    posted.push({ url, opts });
    if (url.indexOf('/permissions/user') !== -1) {
      return Promise.resolve({ status: 403, text: () => Promise.resolve(
        JSON.stringify({ error: 'Beyond your own access', ungrantable: ['page.credit_check'] })) });
    }
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, id: '900' })) });
  };

  w.submitContact();
  await new Promise((r) => setTimeout(r, 0));

  assert.ok(!posted.some((p) => p.url.indexOf('/broker-edit-contact') !== -1),
    'a changed name must NOT be saved when the permission write was refused');
  const msg = w.document.getElementById('modal-msg').textContent;
  assert.ok(/Beyond your own access/.test(msg), 'the real server error text is shown, got: ' + msg);
});

test('changing only name or phone still posts to /broker-edit-contact', () => {
  const w = boot();
  editOn(w,
    [{ template_id: 't_ops', name: 'Operations' }, { template_id: 't_credit', name: 'Credit' }],
    [{ portal_user_id: 'pu_1', email: 'jane@acme.com', template_id: 't_ops', status: 'active', is_owner: false }]);

  // Template picker left on the user's current template -- no access change.
  w.document.getElementById('m-phone').value = '(555) 999-0000';

  const posted = [];
  w.fetch = (url, opts) => {
    posted.push({ url, opts });
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, id: '900' })) });
  };

  w.submitContact();
  assert.ok(!posted.some((p) => p.url.indexOf('/permissions/user') !== -1), 'no access change, no permission call');
  const contactCall = posted.find((p) => p.url.indexOf('/broker-edit-contact') !== -1);
  assert.ok(contactCall, '/broker-edit-contact was called for the changed phone');
  const body = JSON.parse(contactCall.opts.body);
  assert.strictEqual(body.phone, '(555) 999-0000');
  assert.strictEqual(body.contact_id, '900');
});

test('/permissions/users is refetched after a successful edit', async () => {
  const w = boot();
  editOn(w,
    [{ template_id: 't_ops', name: 'Operations' }, { template_id: 't_credit', name: 'Credit' }],
    [{ portal_user_id: 'pu_1', email: 'jane@acme.com', template_id: 't_ops', status: 'active', is_owner: false }]);

  w.document.getElementById('m-phone').value = '(555) 999-0000';

  const posted = [];
  w.fetch = (url, opts) => {
    posted.push(url);
    if (url.indexOf('/broker-users') !== -1) {
      return Promise.resolve({ json: () => Promise.resolve({ users: [], self_contact_id: 'c1', can_manage: true }) });
    }
    if (opts) {
      return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, id: '900' })) });
    }
    // The four plain GETs loadAccess() fires (catalog/templates/users/me), and
    // its trailing /permissions/activity GET.
    return Promise.resolve({ status: 200, json: () => Promise.resolve(
      { ok: true, groups: [], templates: [], users: [], events: [], capabilities: [] }) });
  };

  w.submitContact();
  await new Promise((r) => setTimeout(r, 1450));

  assert.ok(posted.some((u) => u.indexOf('/permissions/users') !== -1),
    '/permissions/users is refetched so the pill reflects reality without a manual reload');
});

test('on an unflipped account (templatesAvailable false) the legacy permission cards are still present and the flow is unchanged', () => {
  const w = boot();
  // No templates loaded at all: the invite-template picker holds nothing (or
  // only its own blank placeholder once rendered), so templatesGovern() reads
  // false, exactly as it does for an account that has not been flipped to
  // PERM3.
  w.openEditModal(Object.assign({}, CONTACT));

  assert.strictEqual(w.document.getElementById('perm-section').hidden, false,
    'the legacy cards ARE the real mechanism on an unflipped account and must not be hidden');
  assert.ok(w.document.querySelector('.perm-card.selected'),
    'the contact\'s existing role is still pre-selected from User_Permissions');

  // Something has to actually change for a save to write anything -- same
  // rule as the flipped path, just against the legacy fields instead of a
  // template. A plain phone edit exercises that without touching the roles.
  w.document.getElementById('m-phone').value = '(555) 999-0000';

  const posted = [];
  w.fetch = (url, opts) => { posted.push({ url, opts }); return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, id: '900' })) }); };
  w.submitContact();

  assert.ok(!posted.some((p) => p.url.indexOf('/permissions/user') !== -1),
    'no template picker on this account, so no permission-engine call');
  const contactCall = posted.find((p) => p.url.indexOf('/broker-edit-contact') !== -1);
  assert.ok(contactCall, 'the legacy path still saves through /broker-edit-contact');
  assert.deepStrictEqual(JSON.parse(contactCall.opts.body).permissions, ['Full Access']);
});
