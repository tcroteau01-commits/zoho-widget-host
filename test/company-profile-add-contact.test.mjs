import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../company-profile.html', import.meta.url), 'utf8');

function boot() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  dom.window.brokerEmail = 'admin@operfi.com';
  dom.window.BROKER_API_BASE = 'http://api';
  // populate the modal as the user would
  dom.window.document.getElementById('m-first').value = 'Samantha';
  dom.window.document.getElementById('m-last').value = 'Weber-Pillon';
  dom.window.document.getElementById('m-email').value = 'samantha@saltwater-logistics.com';
  dom.window.document.getElementById('m-phone').value = '(555) 222-3333';
  dom.window.selectedRoles = ['Full Access'];
  dom.window.document.getElementById('m-attest').checked = true;  // ACCTCHG1 Phase 1: add needs the attestation
  return dom;
}

test('submitContact POSTs the contact to /broker-add-contact', () => {
  const dom = boot();
  let captured = null;
  dom.window.fetch = (url, opts) => {
    captured = { url, opts };
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, id: 'rec_900' })) });
  };
  dom.window.submitContact();
  assert.ok(captured, 'fetch was called');
  assert.ok(captured.url.indexOf('/broker-add-contact') !== -1, 'hits the new endpoint');
  assert.strictEqual(captured.opts.method, 'POST');
  const sent = JSON.parse(captured.opts.body);
  assert.strictEqual(sent.email, 'admin@operfi.com');
  assert.strictEqual(sent.contact_email, 'samantha@saltwater-logistics.com');
  assert.strictEqual(sent.first_name, 'Samantha');
  assert.deepStrictEqual(sent.permissions, ['Full Access']);
});

test('edit mode: openEditModal pre-fills + submitContact POSTs to /broker-edit-contact with contact_id (COMP1)', () => {
  const dom = boot();
  const w = dom.window;
  // open edit on an existing contact
  w.openEditModal({ ID: '900', Contact_Name: { first_name: 'Jane', last_name: 'Doe' },
                    Email: 'jane@acme.com', Phone_Number: '(555) 111-2222', User_Permissions: ['Full Access'] });
  assert.strictEqual(w.document.getElementById('m-first').value, 'Jane');
  assert.strictEqual(w.document.getElementById('m-email').value, 'jane@acme.com');
  assert.ok(w.document.querySelector('.perm-card.selected'), 'a permission was pre-selected');

  // PERMEDIT1: /broker-edit-contact is only called when a contact field
  // actually changed, so this exercises that with a real edit rather than a
  // no-op re-save.
  w.document.getElementById('m-phone').value = '(555) 999-8888';

  let captured = null;
  w.fetch = (url, opts) => { captured = { url, opts }; return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, id: '900' })) }); };
  w.submitContact();
  assert.ok(captured.url.indexOf('/broker-edit-contact') !== -1, 'hits the edit endpoint');
  const sent = JSON.parse(captured.opts.body);
  assert.strictEqual(sent.contact_id, '900');
  assert.strictEqual(sent.first_name, 'Jane');
});

test('submitContact surfaces the real error message (no [object Object])', async () => {
  const dom = boot();
  dom.window.fetch = () =>
    Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: false, code: 3001, message: 'Email already exists' })) });
  dom.window.submitContact();
  await new Promise(r => setTimeout(r, 0));
  const msg = dom.window.document.getElementById('modal-msg').textContent;
  assert.ok(/Email already exists/.test(msg), 'shows real message, got: ' + msg);
  assert.ok(!/object Object/.test(msg), 'no [object Object]');
});

// ACCTCHG1 Phase 0: a login email is never changed in place from the Users tab.
const LOCKED_COPY = 'To change a login email, remove this user and invite the new address.';

test('edit mode: the email is read-only with the remove-and-invite hint', () => {
  const w = boot().window;
  w.openEditModal({ ID: '900', Contact_Name: { first_name: 'Jane', last_name: 'Doe' },
                    Email: 'jane@acme.com', Phone_Number: '(555) 111-2222', User_Permissions: ['Full Access'] });
  const email = w.document.getElementById('m-email');
  const hint = w.document.getElementById('m-email-locked');
  assert.strictEqual(email.readOnly, true);
  assert.ok(hint, 'hint element exists');
  assert.ok(!hint.hidden, 'hint is shown on edit');
  assert.strictEqual(hint.textContent.trim(), LOCKED_COPY);
});

test('edit mode: the save payload never carries contact_email', () => {
  const w = boot().window;
  w.openEditModal({ ID: '900', Contact_Name: { first_name: 'Jane', last_name: 'Doe' },
                    Email: 'jane@acme.com', Phone_Number: '(555) 111-2222', User_Permissions: ['Full Access'] });
  w.document.getElementById('m-phone').value = '(555) 999-8888';
  let captured = null;
  w.fetch = (url, opts) => { captured = { url, opts }; return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, id: '900' })) }); };
  w.submitContact();
  const sent = JSON.parse(captured.opts.body);
  assert.ok(!('contact_email' in sent), 'contact_email must not be sent on edit');
});

test('add mode after an edit: the email is editable again and the hint hidden', () => {
  const w = boot().window;
  w.openEditModal({ ID: '900', Contact_Name: { first_name: 'Jane', last_name: 'Doe' },
                    Email: 'jane@acme.com', Phone_Number: '(555) 111-2222', User_Permissions: ['Full Access'] });
  w.openModal();
  assert.strictEqual(w.document.getElementById('m-email').readOnly, false);
  assert.ok(w.document.getElementById('m-email-locked').hidden, 'hint hidden for add');
});

// ACCTCHG1 Phase 1: attestation + "what this access allows" + edit note.
const TEMPLATES = [
  { template_id: 't_ops', name: 'Operations', description: 'Day-to-day loads and carriers', capabilities: ['loads.submit', 'carriers.view', 'internal.secret'] },
  { template_id: 't_acct', name: 'Accounting', description: '', capabilities: ['payments.view'] },
];
const CATALOG = { groups: [{ group: 'G', capabilities: [
  { key: 'loads.submit', label: 'Submit loads' }, { key: 'carriers.view', label: 'View carriers' },
  { key: 'payments.view', label: 'View payments' } ] }] };

function bootAdd() {
  const dom = boot();
  const w = dom.window;
  w.accessCatalog = CATALOG;
  w.account = { Account_Name: 'Example Freight LLC' };
  w.renderInviteTemplatePicker(TEMPLATES);
  w.openModal();
  const d = w.document;
  d.getElementById('m-first').value = 'Sam';
  d.getElementById('m-last').value = 'Rivera';
  d.getElementById('m-first').dispatchEvent(new w.Event('input', { bubbles: true }));
  return dom;
}
function pick(w, id) {
  const p = w.document.getElementById('invite-template');
  p.value = id;
  p.dispatchEvent(new w.Event('change', { bubbles: true }));
}

test('add mode: Submit stays disabled until the attestation box is checked', () => {
  const w = bootAdd().window;
  pick(w, 't_ops');
  const submit = w.document.getElementById('modal-submit');
  const box = w.document.getElementById('m-attest');
  assert.ok(box, 'checkbox exists');
  assert.strictEqual(box.checked, false);
  assert.strictEqual(submit.disabled, true);
  box.checked = true;
  box.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.strictEqual(submit.disabled, false);
  box.checked = false;
  box.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.strictEqual(submit.disabled, true);
});

test('add mode: the payload carries attested: true', () => {
  const w = bootAdd().window;
  pick(w, 't_ops');
  const box = w.document.getElementById('m-attest');
  w.document.getElementById('m-phone').value = '(555) 201-4417';
  box.checked = true;
  w.document.getElementById('m-email').value = 'sam@examplefreight.com';
  let captured = null;
  w.fetch = (url, opts) => { captured = { url, opts }; return Promise.resolve({ status: 200, text: () => Promise.resolve('{"ok":true}') }); };
  w.submitContact();
  assert.strictEqual(JSON.parse(captured.opts.body).attested, true);
});

test('add mode: submitContact refuses to POST with the box unchecked', () => {
  const w = bootAdd().window;
  pick(w, 't_ops');
  w.document.getElementById('m-email').value = 'sam@examplefreight.com';
  let called = false;
  w.fetch = () => { called = true; return Promise.resolve({ status: 200, text: () => Promise.resolve('{"ok":true}') }); };
  w.submitContact();
  assert.strictEqual(called, false);
});

test('attestation text fills the typed names and the company live', () => {
  const w = bootAdd().window;
  const text = () => w.document.getElementById('m-attest-text').textContent;
  assert.strictEqual(text(),
    'I confirm Sam Rivera is an employee or authorized agent of Example Freight LLC and authorize them to act for Example Freight LLC in the OperFi portal with the access selected. Example Freight LLC is responsible for all activity under this login.');
  w.document.getElementById('m-last').value = 'Rivers';
  w.document.getElementById('m-last').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.ok(/I confirm Sam Rivers is/.test(text()));
  w.document.getElementById('m-first').value = '';
  w.document.getElementById('m-last').value = '';
  w.document.getElementById('m-last').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.ok(/I confirm this user is an employee/.test(text()), text());
});

test('the info line uses the first name', () => {
  const w = bootAdd().window;
  const info = w.document.getElementById('m-attest-info').textContent.trim();
  assert.strictEqual(info, 'The account owner and your admin email will get an email about this new user. Sam will receive an invitation to set up their own login.');
});

test('changing the template updates the "what this access allows" list', () => {
  const w = bootAdd().window;
  const box = () => w.document.getElementById('m-allows');
  assert.ok(box().hidden, 'hidden with no template');
  pick(w, 't_ops');
  assert.ok(!box().hidden);
  assert.ok(/What Operations access allows/.test(box().textContent));
  const items = Array.from(box().querySelectorAll('li')).map((l) => l.textContent);
  assert.deepStrictEqual(items, ['Day-to-day loads and carriers', 'Submit loads', 'View carriers']);
  pick(w, 't_acct');
  assert.ok(/What Accounting access allows/.test(box().textContent));
  assert.deepStrictEqual(Array.from(box().querySelectorAll('li')).map((l) => l.textContent), ['View payments']);
  pick(w, '');
  assert.ok(box().hidden);
});

test('resetModal (openModal) unchecks the attestation box', () => {
  const w = bootAdd().window;
  const box = w.document.getElementById('m-attest');
  box.checked = true;
  w.openModal();
  assert.strictEqual(box.checked, false);
});

test('edit mode: no attestation box, the notice note is shown; add mode hides the note', () => {
  const w = bootAdd().window;
  const d = w.document;
  assert.ok(d.getElementById('m-edit-note').hidden, 'note hidden on add');
  assert.ok(!d.getElementById('m-attest-wrap').hidden, 'attestation visible on add');
  w.openEditModal({ ID: '900', Contact_Name: { first_name: 'Jane', last_name: 'Doe' },
                    Email: 'jane@acme.com', Phone_Number: '(555) 111-2222', User_Permissions: ['Full Access'] });
  assert.ok(d.getElementById('m-attest-wrap').hidden, 'attestation hidden on edit');
  assert.ok(!d.getElementById('m-edit-note').hidden);
  assert.strictEqual(d.getElementById('m-edit-note').textContent.trim(),
    "Saving a change to this user's access or contact details emails the account owner and your admin email.");
  w.document.getElementById('m-phone').value = '(555) 999-8888';
  let sent = null;
  w.fetch = (u, o) => { sent = JSON.parse(o.body); return Promise.resolve({ status: 200, text: () => Promise.resolve('{"ok":true}') }); };
  w.submitContact();
  assert.ok(!('attested' in sent), 'edit payload has no attested');
});
