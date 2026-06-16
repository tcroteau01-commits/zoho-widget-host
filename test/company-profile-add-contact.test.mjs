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
