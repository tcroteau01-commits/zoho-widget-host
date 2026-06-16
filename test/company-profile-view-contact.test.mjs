import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../company-profile.html', import.meta.url), 'utf8');

function boot() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  dom.window.brokerEmail = 'admin@operfi.com';
  dom.window.BROKER_API_BASE = 'http://api';
  return dom;
}

test('canManage true shows Edit + Delete in the View modal footer', () => {
  const w = boot().window;
  w.canManage = true;
  w.openViewModal({ ID: '900', Contact_Name: { first_name: 'Jane', last_name: 'Doe' },
                    Email: 'jane@acme.com', Phone_Number: '(555) 111-2222',
                    User_Permissions: ['Full Access'], Added_Time: '01-Jan-2026 00:00:00' });
  const foot = w.document.getElementById('view-foot');
  assert.ok(foot.querySelector('[data-act="edit"]'), 'Edit button present');
  assert.ok(foot.querySelector('[data-act="delete"]'), 'Delete button present');
});

test('canManage false shows no action buttons (read-only view)', () => {
  const w = boot().window;
  w.canManage = false;
  w.openViewModal({ ID: '901', Contact_Name: { first_name: 'V', last_name: 'User' },
                    Email: 'v@acme.com', User_Permissions: ['Vendor Access'] });
  const foot = w.document.getElementById('view-foot');
  assert.ok(!foot.querySelector('[data-act="edit"]'), 'no Edit');
  assert.ok(!foot.querySelector('[data-act="delete"]'), 'no Delete');
});

test('self row shows Edit but not Delete', () => {
  const w = boot().window;
  w.canManage = true;
  w.selfContactId = '902';
  w.openViewModal({ ID: '902', Contact_Name: { first_name: 'Me', last_name: 'Self' },
                    Email: 'me@acme.com', User_Permissions: ['Full Access'] });
  const foot = w.document.getElementById('view-foot');
  assert.ok(foot.querySelector('[data-act="edit"]'), 'Edit present');
  assert.ok(!foot.querySelector('[data-act="delete"]'), 'Delete hidden for self');
});

test('delete is two-step: first click shows confirm with Full Access caution', () => {
  const w = boot().window;
  w.canManage = true;
  w.openViewModal({ ID: '903', Contact_Name: { first_name: 'Boss', last_name: 'Lady' },
                    Email: 'boss@acme.com', User_Permissions: ['Full Access'] });
  w.document.querySelector('#view-foot [data-act="delete"]').click();
  const foot = w.document.getElementById('view-foot');
  assert.ok(foot.querySelector('[data-act="confirm-delete"]'), 'confirm button appears');
  assert.ok(/Full Access/.test(w.document.getElementById('view-confirm-msg').textContent),
            'caution mentions Full Access');
});

test('confirm delete POSTs to /broker-delete-contact with the contact id', () => {
  const w = boot().window;
  w.canManage = true;
  let captured = null;
  w.fetch = (url, opts) => { captured = { url, opts };
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, id: '904' })) }); };
  w.openViewModal({ ID: '904', Contact_Name: { first_name: 'Reg', last_name: 'User' },
                   Email: 'reg@acme.com', User_Permissions: ['Vendor Access'] });
  w.document.querySelector('#view-foot [data-act="delete"]').click();
  w.document.querySelector('#view-foot [data-act="confirm-delete"]').click();
  assert.ok(captured && captured.url.indexOf('/broker-delete-contact') !== -1, 'hits delete endpoint');
  assert.strictEqual(JSON.parse(captured.opts.body).contact_id, '904');
});

test('Edit from the view modal opens the prefilled edit modal', () => {
  const w = boot().window;
  w.canManage = true;
  w.openViewModal({ ID: '905', Contact_Name: { first_name: 'Ed', last_name: 'Itor' },
                   Email: 'ed@acme.com', Phone_Number: '(555) 9', User_Permissions: ['Full Access'] });
  w.document.querySelector('#view-foot [data-act="edit"]').click();
  assert.strictEqual(w.document.getElementById('m-first').value, 'Ed');
  assert.ok(w.document.getElementById('modal-scrim').classList.contains('show'), 'edit modal open');
});
