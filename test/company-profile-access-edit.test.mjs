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
  // The negative assertion alone would also pass if submitContact threw
  // before reaching either fetch, so pin down the positive side too: nothing
  // at all changed, so /broker-edit-contact must not fire either, and the
  // admin still sees a real success message.
  assert.ok(!posted.some((p) => p.url.indexOf('/permissions/user') !== -1),
    'an unchanged template must not generate a write or an audit row');
  assert.ok(!posted.some((p) => p.url.indexOf('/broker-edit-contact') !== -1),
    'nothing else changed either, so no contact write');
  const msg = w.document.getElementById('modal-msg').textContent;
  assert.ok(/Changes saved/.test(msg), 'a real success message rendered, got: ' + msg);
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

// Review fix 6: unflipped accounts are the large majority and had no test
// exercising a roles-only edit (every existing unflipped test changed a
// contact field instead). Line ~1849's permissions comparison is what keeps
// this saving at all.
test('on an unflipped account, toggling a permission card alone still saves through /broker-edit-contact', () => {
  const w = boot();
  w.openEditModal(Object.assign({}, CONTACT)); // CONTACT starts on Full Access

  var vendorCard = w.document.querySelector('.perm-card[data-role="Vendor Access"]');
  w.togglePermCard(vendorCard);

  const posted = [];
  w.fetch = (url, opts) => { posted.push({ url, opts }); return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, id: '900' })) }); };
  w.submitContact();

  const contactCall = posted.find((p) => p.url.indexOf('/broker-edit-contact') !== -1);
  assert.ok(contactCall, 'a roles-only change still saves, with no other field touched');
  assert.deepStrictEqual(JSON.parse(contactCall.opts.body).permissions, ['Vendor Access']);
});

// Review fix 1: a template swap must never carry the subject's OLD overrides
// onto the NEW template. The server keeps grants_added/grants_removed as-is
// when they are omitted from the request and applies them to whatever
// template_id was just written (removal wins in resolve_effective), so a
// user on Operations with "page.credit_check" removed would land on Credit
// still missing it -- the admin told "Changes saved" while the thing they
// meant to grant never appeared. Blocked here rather than recomputed, which
// would duplicate saveAccess()'s existing delta logic in a second place.
test('a user with custom access overrides cannot have their template swapped from this modal', () => {
  const w = boot();
  editOn(w,
    [{ template_id: 't_ops', name: 'Operations' }, { template_id: 't_credit', name: 'Credit' }],
    [{ portal_user_id: 'pu_1', email: 'jane@acme.com', template_id: 't_ops', status: 'active',
       is_owner: false, delta: { added: [], removed: ['page.credit_check'] } }]);

  const picker = w.document.getElementById('invite-template');
  assert.strictEqual(picker.disabled, true, 'the picker is disabled for a user with overrides');
  const note = w.document.getElementById('tpl-picker-note').textContent;
  assert.ok(/overrides/i.test(note) && /Edit access/i.test(note),
    'the reason names the real cause and points at the drawer, got: ' + note);

  // Defense in depth: even if something forces a different value through,
  // submitContact must still refuse rather than trust a disabled control.
  picker.value = 't_credit';
  const posted = [];
  w.fetch = (url, opts) => { posted.push({ url, opts }); return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true })) }); };
  w.submitContact();

  assert.ok(!posted.length, 'the save is refused outright, nothing is posted');
  const msg = w.document.getElementById('modal-msg').textContent;
  assert.ok(/overrides/i.test(msg), 'the refusal message names the real cause, got: ' + msg);
});

// Review fix 4: the Access tab withholds "Edit access" for the owner because
// a template write for them is a no-op (resolve_effective short-circuits),
// so this modal must not send one either -- it would only create an audit
// row and inflate a template's user count for nothing.
test('the account owner’s template is never written, even if a different one is selected', () => {
  const w = boot();
  editOn(w,
    [{ template_id: 't_ops', name: 'Operations' }, { template_id: 't_credit', name: 'Credit' }],
    [{ portal_user_id: 'pu_owner', email: 'jane@acme.com', template_id: 't_ops', status: 'active', is_owner: true }]);

  const picker = w.document.getElementById('invite-template');
  assert.strictEqual(picker.disabled, true, 'the picker is disabled for the owner, matching the Access tab');

  picker.value = 't_credit';
  const posted = [];
  w.fetch = (url, opts) => { posted.push({ url, opts }); return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, id: '900' })) }); };
  w.submitContact();

  // The negative assertion alone would also pass if submitContact threw
  // before reaching either fetch (finding 5's exact weakness) -- pin down
  // the positive side too: nothing else changed, so no contact write either,
  // and the admin still sees a real success message.
  assert.ok(!posted.some((p) => p.url.indexOf('/permissions/user') !== -1),
    'no permission write for the owner, regardless of what the picker holds');
  assert.ok(!posted.some((p) => p.url.indexOf('/broker-edit-contact') !== -1),
    'nothing else changed either, so no contact write');
  const msg = w.document.getElementById('modal-msg').textContent;
  assert.ok(/Changes saved/.test(msg), 'a real success message rendered, got: ' + msg);
});

// Review round 3, fix A: WOSPROV1 (live in production) writes template_id:
// None for every owner it provisions, since an owner short-circuits to every
// capability and does not need one. The picker is correctly disabled and
// blank for this user (owner lock), but Save must not be gated on a value
// that a locked, blank picker can never hold -- otherwise this user's name
// and phone can never be edited again from this modal.
test('Save is not permanently disabled for a locked user whose template_id is null (WOSPROV1 owners)', () => {
  const w = boot();
  editOn(w,
    [{ template_id: 't_ops', name: 'Operations' }, { template_id: 't_credit', name: 'Credit' }],
    [{ portal_user_id: 'pu_owner', email: 'jane@acme.com', template_id: null, status: 'active', is_owner: true }]);

  const picker = w.document.getElementById('invite-template');
  assert.strictEqual(picker.disabled, true, 'locked for the owner');
  assert.strictEqual(picker.value, '', 'nothing to preselect when template_id is null');
  assert.strictEqual(w.document.getElementById('modal-submit').disabled, false,
    'Save must not require a value a locked, blank picker can never hold');

  w.document.getElementById('m-phone').value = '(555) 999-0000';
  const posted = [];
  w.fetch = (url, opts) => { posted.push({ url, opts }); return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, id: '900' })) }); };
  w.submitContact();

  assert.ok(!posted.some((p) => p.url.indexOf('/permissions/user') !== -1), 'still no permission write for the owner');
  const contactCall = posted.find((p) => p.url.indexOf('/broker-edit-contact') !== -1);
  assert.ok(contactCall, 'the phone edit still saves');
});

// Review fix 3: a Creator contact with no portal_users row is an expected,
// best-effort-provisioning state, not an error state. Before this build such
// a user's name/phone could still be edited; the null-accessRow guard must
// not turn that into a dead end now that a template picker exists.
test('a contact not yet provisioned in the permission engine can still have contact fields edited', () => {
  const w = boot();
  setTemplates(w, [{ template_id: 't_ops', name: 'Operations' }, { template_id: 't_credit', name: 'Credit' }]);
  setAccessIndex(w, []); // accessByEmail stays empty -- no row for this contact
  w.openEditModal(Object.assign({}, CONTACT));

  const picker = w.document.getElementById('invite-template');
  assert.strictEqual(picker.disabled, true, 'nothing to pick a template against');
  assert.strictEqual(picker.value, '', 'left blank rather than guessing');
  const note = w.document.getElementById('tpl-picker-note').textContent;
  assert.ok(/not yet set up/i.test(note), 'names the real cause, got: ' + note);
  assert.strictEqual(w.document.getElementById('modal-submit').disabled, false,
    'Save is not blocked on a template pick that can never be satisfied');

  w.document.getElementById('m-phone').value = '(555) 999-0000';
  const posted = [];
  w.fetch = (url, opts) => { posted.push({ url, opts }); return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, id: '900' })) }); };
  w.submitContact();

  assert.ok(!posted.some((p) => p.url.indexOf('/permissions/user') !== -1), 'no accessRow, no permission call');
  const contactCall = posted.find((p) => p.url.indexOf('/broker-edit-contact') !== -1);
  assert.ok(contactCall, 'the phone edit still saves through /broker-edit-contact');
});

// Review fix 2: when the permission write already succeeded, a subsequent
// contact-write failure must not be reported as if nothing happened -- the
// access change is real and audited -- and the row behind the modal has to
// be refreshed even though this second call failed.
test('when the permission write succeeds but the contact write fails, the message says so and the Access tab still refreshes', async () => {
  const w = boot();
  editOn(w,
    [{ template_id: 't_ops', name: 'Operations' }, { template_id: 't_credit', name: 'Credit' }],
    [{ portal_user_id: 'pu_1', email: 'jane@acme.com', template_id: 't_ops', status: 'active', is_owner: false }]);

  w.document.getElementById('invite-template').value = 't_credit';
  w.document.getElementById('m-phone').value = '(555) 999-0000';

  const posted = [];
  w.fetch = (url, opts) => {
    posted.push(url);
    if (url.indexOf('/permissions/user') !== -1) {
      return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true })) });
    }
    if (url.indexOf('/broker-edit-contact') !== -1) {
      return Promise.resolve({ status: 500, text: () => Promise.resolve(JSON.stringify({ error: 'Server error' })) });
    }
    // refreshAccessRow()'s single GET, fired because the permission write
    // did succeed even though the contact write is about to fail.
    return Promise.resolve({ status: 200, json: () => Promise.resolve({ users: [] }) });
  };

  w.submitContact();
  await new Promise((r) => setTimeout(r, 0));

  const msg = w.document.getElementById('modal-msg').textContent;
  assert.ok(/access was updated/i.test(msg) && /contact details/i.test(msg),
    'says the access DID save and the contact details did not, got: ' + msg);
  assert.ok(posted.some((u) => u.indexOf('/permissions/users') !== -1),
    'the Access tab row still refreshes so it shows the new template');

  // Review round 3, fix B: the row refresh above must not go through
  // loadAccess(), which also rebuilds THIS modal's own template picker and
  // re-runs syncModalSubmit while the modal is still open -- disarming the
  // "Please try again" this just showed by greying Save back out and
  // blanking the picker.
  assert.ok(!posted.some((u) => u.indexOf('/permissions/catalog') !== -1
    || u.indexOf('/permissions/templates') !== -1 || u.indexOf('/me/permissions') !== -1),
    'only the row is refetched, not the modal-clobbering full loadAccess()');
  assert.strictEqual(w.document.getElementById('modal-submit').disabled, false,
    'Save must still be usable so "Please try again" is actionable');
  assert.strictEqual(w.document.getElementById('invite-template').value, 't_credit',
    'the admin’s picked template must not be wiped out from under them');
});
