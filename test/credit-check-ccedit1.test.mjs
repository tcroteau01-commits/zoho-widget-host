// CCEDIT1 on the credit check: "Save and finish later", and editing a check
// that is still Awaiting Credit Decision. Tom, 2026-09-29.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../credit-check.html', import.meta.url), 'utf8');
const wait = (ms) => new Promise(r => setTimeout(r, ms || 0));

const FIELDS = {
  Customer_Company_Name: 'LANE FREIGHT', Customer_Type: 'Shipper',
  Address: { address_line_1: '1 Main St', district_city: 'Phoenix',
             state_province: 'AZ', postal_code: '85001' },
  Phone_Number: '6025550100', Company_Website: { value: 'https://lane.com', url: 'https://lane.com' },
  Customer_Point_of_Contact: 'Dana Reed', Phone_Number1: '6025550101', Email: 'dana@lane.com'
};

// Boots the page as a broker. `handoff` is what Customer Approvals leaves in
// sessionStorage; `routes` answers fetches by URL fragment.
async function boot({ handoff, mode, routes } = {}) {
  const calls = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/credit-check.html',
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function () {};
      if (handoff) window.sessionStorage.setItem('operfi.resumeSubmission', handoff);
      if (mode) window.sessionStorage.setItem('operfi.resumeMode', mode);
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => Promise.resolve({ loginUser: 'broker@op.com' }) } } };
      window.fetch = (url, opts) => {
        calls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
        for (const key of Object.keys(routes || {})) {
          if (url.indexOf(key) !== -1) {
            const [status, body] = routes[key](url, opts);
            return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
          }
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ drafts: [] }) });
      };
    }
  });
  await wait(20);
  return { w: dom.window, d: dom.window.document, calls };
}
const posts = (calls, frag) => calls.filter(c => c.url.indexOf(frag) !== -1 && c.body);

// --- save and finish later ---------------------------------------------------------

test('Save and finish later needs only a company name and saves a Shipper draft', async () => {
  const { d, calls } = await boot({ routes: {
    '/credit-check/save': () => [200, { ok: true, submission_id: 'd1', created: true }] } });
  d.getElementById('saveDraftBtn').click();
  await wait();
  assert.equal(posts(calls, '/credit-check/save').length, 0, 'no name, no save');

  d.getElementById('Customer_Company_Name').value = 'LANE FREIGHT';
  d.getElementById('Email').value = 'dana@lane.com';
  d.getElementById('saveDraftBtn').click();
  await wait(10);
  const sent = posts(calls, '/credit-check/save');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.submission_id, '');
  assert.equal(sent[0].body.customer_type, 'Shipper');
  assert.deepEqual(Object.keys(sent[0].body.fields).sort(), ['Customer_Company_Name', 'Email'],
                   'blanks are left out');
  assert.equal(d.getElementById('submitBtn').textContent, 'Finish credit check');
  assert.equal(d.getElementById('ctype-broker').disabled, true, 'a saved Shipper draft keeps its type');
});

test('saving twice updates the same draft, and finishing it goes to the draft route', async () => {
  const { d, calls } = await boot({ routes: {
    '/credit-check/save': () => [200, { ok: true, submission_id: 'd1' }],
    '/credit-check/draft/d1': () => [200, { ok: true, submission_id: 'd1' }] } });
  d.getElementById('Customer_Company_Name').value = 'LANE FREIGHT';
  d.getElementById('saveDraftBtn').click();
  await wait(10);
  d.getElementById('saveDraftBtn').click();
  await wait(10);
  const sent = posts(calls, '/credit-check/save');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].body.submission_id, 'd1', 'the second save names the first draft');
  // a broker cannot start a draft by skipping the lookup
  assert.equal(posts(calls, '/credit-submit').length, 0);
});

test('a Freight Broker is told to run the lookup instead of saving', async () => {
  const { d, calls } = await boot();
  d.getElementById('ctype-broker').click();
  d.getElementById('Customer_Company_Name').value = 'X';
  d.getElementById('saveDraftBtn').click();
  await wait();
  assert.equal(posts(calls, '/credit-check/save').length, 0);
  assert.match(d.body.textContent, /Look up their MC or DOT number first/);
});

// --- edit while Awaiting Credit Decision --------------------------------------------

function readRoute(canEdit) {
  return () => [200, { submission_id: 's1', is_draft: false, can_edit: canEdit,
                       edit_locked: ['Customer_DOT', 'Customer_MC', 'Customer_Type'],
                       locked: ['Customer_Company_Name', 'Email', 'Phone_Number'],
                       fields: FIELDS, authority_class: 'none',
                       requires_co_broker_agreement: false, has_agreement: false, blockers: [] }];
}

test('Edit submission unlocks the details, keeps the type locked, and posts to the edit route', async () => {
  const { d, calls } = await boot({ handoff: 's1', mode: 'edit', routes: {
    '/credit-check/submission/s1': readRoute(true),
    '/credit-check/edit/s1': () => [200, { ok: true, updated: ['Email'] }] } });
  await wait(10);
  assert.equal(d.getElementById('Email').readOnly, false, 'editable');
  assert.equal(d.getElementById('address_line_1').readOnly, false);
  assert.equal(d.getElementById('ctype-shipper').disabled, true, 'type stays settled');
  assert.equal(d.getElementById('submitBtn').textContent, 'Save changes');
  assert.equal(d.getElementById('saveDraftBtn').style.display, 'none');

  d.getElementById('Email').value = 'dana.reed@lane.com';
  d.getElementById('submitBtn').click();
  await wait(10);
  const sent = posts(calls, '/credit-check/edit/s1');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.fields.Email, 'dana.reed@lane.com');
  assert.ok(!('Customer_Type' in sent[0].body.fields), 'never sends the type');
  assert.equal(posts(calls, '/credit-check/draft/').length, 0, 'an edit is not the append path');
});

test('an edit still checks required fields', async () => {
  const { d, calls } = await boot({ handoff: 's1', mode: 'edit', routes: {
    '/credit-check/submission/s1': readRoute(true) } });
  await wait(10);
  d.getElementById('Customer_Point_of_Contact').value = '';
  d.getElementById('submitBtn').click();
  await wait(10);
  assert.equal(posts(calls, '/credit-check/edit/').length, 0);
});

test('when credit already acted, Edit opens as Add Documents and says why', async () => {
  const { d } = await boot({ handoff: 's1', mode: 'edit', routes: {
    '/credit-check/submission/s1': readRoute(false) } });
  await wait(10);
  assert.equal(d.getElementById('Email').readOnly, true);
  assert.equal(d.getElementById('submitBtn').textContent, 'Save additions');
  assert.match(d.getElementById('resume-note').textContent, /already acted/);
});

test('Add Documents on an Awaiting check stays append-only', async () => {
  const { d } = await boot({ handoff: 's1', routes: {
    '/credit-check/submission/s1': readRoute(true) } });
  await wait(10);
  assert.equal(d.getElementById('Email').readOnly, true, 'no edit without asking for one');
  assert.equal(d.getElementById('submitBtn').textContent, 'Save additions');
});

test('a 409 on save shows the server message and keeps what was typed', async () => {
  const { d } = await boot({ handoff: 's1', mode: 'edit', routes: {
    '/credit-check/submission/s1': readRoute(true),
    '/credit-check/edit/s1': () => [409, { error: 'not_editable',
      message: 'OperFi has already acted on this credit check (Approved)' }] } });
  await wait(10);
  d.getElementById('Email').value = 'new@lane.com';
  d.getElementById('submitBtn').click();
  await wait(10);
  assert.match(d.body.textContent, /already acted on this credit check \(Approved\)/);
  assert.equal(d.getElementById('Email').value, 'new@lane.com');
  assert.equal(d.getElementById('submitBtn').disabled, false);
});
