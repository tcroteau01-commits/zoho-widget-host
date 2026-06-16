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
