import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../carrier-onboarding.html', import.meta.url), 'utf8');

// Build the carrier-onboarding widget under jsdom. Boots via ZOHO.getInitParams
// (loginUser). fetch is stubbed: /broker-report returns the rows for each report
// (keyed by the report query param); /broker-users returns a self contact;
// /broker-send-onboarding-link echoes ok.
function makeWidget(rowsByReport, opts) {
  opts = opts || {};
  const posts = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://tcroteau01-commits.github.io/carrier-onboarding.html',
    beforeParse(window) {
      window.ZOHO = {
        CREATOR: {
          UTIL: { getInitParams: () => Promise.resolve({ loginUser: 'broker@test.com' }) },
          init: () => Promise.resolve()
        }
      };
      window.fetch = (url, init) => {
        const u = String(url);
        if (u.includes('/broker-report')) {
          const report = /report=([^&]+)/.exec(u)[1];
          return Promise.resolve({ ok: true, text: () => Promise.resolve(''),
            json: () => Promise.resolve({ records: rowsByReport[report] || [] }) });
        }
        if (u.includes('/broker-users')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ self_contact_id: 'c1' }) });
        }
        if (u.includes('/broker-send-onboarding-link')) {
          posts.push({ url: u, body: JSON.parse((init && init.body) || '{}') });
          return Promise.resolve({ ok: true, status: 200,
            text: () => Promise.resolve(JSON.stringify({ ok: true, id: 'new1' })),
            json: () => Promise.resolve({ ok: true, id: 'new1' }) });
        }
        return Promise.resolve({ ok: true, text: () => Promise.resolve('{}'),
          json: () => Promise.resolve({}) });
      };
      window._posts = posts;
    }
  });
  return dom;
}

async function waitFor(win, sel, timeout = 400) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (win.document.querySelector(sel)) return;
    await new Promise(r => setTimeout(r, 10));
  }
}

// Boot the widget and drive the date filter to "all" so May-2026 fixtures are
// always visible regardless of the production 30d default.
function boot(w) {
  w.dispatchEvent(new w.Event('load'));
  const sel = w.document.getElementById('history-date-filter');
  sel.value = 'all';
  sel.dispatchEvent(new w.Event('change'));
}

const FULL = 'Carrier_Onboarding_Report';
const PAY = 'Vendor_Pay_Setup_Sent_Report';

test('row with setup=true shows a Completed badge', async () => {
  const dom = makeWidget({
    [FULL]: [{ ID: 'L1', Carrier_Name: 'A&M', Carrier_DOT: '92261',
               Send_To: 'a@m.com', Added_Time: '08-May-2026 10:00:00', setup: true }],
    [PAY]: []
  });
  const w = dom.window;
  boot(w);
  await waitFor(w, '.history-table tbody tr td .status-pill');
  const pill = w.document.querySelector('.history-table tbody tr .status-pill');
  assert.equal(pill.textContent.trim(), 'Completed');
  assert.ok(pill.className.includes('completed'));
});

test('row with setup=false shows a Sent badge', async () => {
  const dom = makeWidget({
    [FULL]: [{ ID: 'L1', Carrier_Name: 'A&M', Carrier_DOT: '99999',
               Send_To: 'a@m.com', Added_Time: '08-May-2026 10:00:00', setup: false }],
    [PAY]: []
  });
  const w = dom.window;
  boot(w);
  await waitFor(w, '.history-table tbody tr .status-pill');
  const pill = w.document.querySelector('.history-table tbody tr .status-pill');
  assert.equal(pill.textContent.trim(), 'Sent');
});

test('two sends to the same carrier+type collapse into one row with "sent 2x"', async () => {
  const dom = makeWidget({
    [FULL]: [
      { ID: 'L2', Carrier_Name: 'A&M', Carrier_DOT: '92261', Send_To: 'a@m.com',
        Added_Time: '10-May-2026 09:00:00', setup: false },
      { ID: 'L1', Carrier_Name: 'A&M', Carrier_DOT: '92261', Send_To: 'a@m.com',
        Added_Time: '08-May-2026 10:00:00', setup: false }
    ],
    [PAY]: []
  });
  const w = dom.window;
  boot(w);
  await waitFor(w, '.history-table tbody tr .status-pill');
  const rows = w.document.querySelectorAll('.history-table tbody tr');
  assert.equal(rows.length, 1, 'duplicate DOT+type collapses to one row');
  assert.match(w.document.querySelector('.history-table tbody').textContent, /sent 2x/i);
});

test('rows with no DOT are not collapsed', async () => {
  const dom = makeWidget({
    [FULL]: [
      { ID: 'N1', Carrier_Name: 'No DOT 1', Carrier_DOT: '', Send_To: 'a@x.com',
        Added_Time: '10-May-2026 09:00:00' },
      { ID: 'N2', Carrier_Name: 'No DOT 2', Carrier_DOT: '', Send_To: 'b@x.com',
        Added_Time: '09-May-2026 09:00:00' }
    ],
    [PAY]: []
  });
  const w = dom.window;
  boot(w);
  await waitFor(w, '.history-table tbody tr .status-pill');
  const rows = w.document.querySelectorAll('.history-table tbody tr');
  assert.equal(rows.length, 2, 'no-DOT rows stay individual');
});

test('Resend button posts the row fields to /broker-send-onboarding-link', async () => {
  const dom = makeWidget({
    [FULL]: [{ ID: 'L1', _type: 'full', Carrier_Name: 'A&M', Carrier_DOT: '92261',
               Carrier_MC: '123456', Send_To: 'a@m.com', Additional_Email: 'cc@m.com',
               Added_Time: '08-May-2026 10:00:00', setup: false }],
    [PAY]: []
  });
  const w = dom.window;
  boot(w);
  await waitFor(w, '.history-table tbody tr .btn-resend');

  w.document.querySelector('.history-table tbody tr .btn-resend').click();
  await waitFor(w, '.btn-resend'); // allow the click handler microtasks to run
  await new Promise(r => setTimeout(r, 20));

  const posts = w._posts.filter(p => p.url.includes('/broker-send-onboarding-link'));
  assert.equal(posts.length, 1, 'one resend POST');
  const b = posts[0].body;
  assert.equal(b.type, 'full');
  assert.equal(b.send_to, 'a@m.com');
  assert.equal(b.additional_email, 'cc@m.com');
  assert.equal(b.carrier_name, 'A&M');
  assert.equal(String(b.carrier_dot), '92261');
  assert.equal(String(b.carrier_mc), '123456');
});

test('history table has an Actions column header', async () => {
  const dom2 = makeWidget({
    [FULL]: [{ ID: 'L1', _type: 'full', Carrier_Name: 'A&M', Carrier_DOT: '92261',
               Send_To: 'a@m.com', Added_Time: '08-May-2026 10:00:00', setup: false }],
    [PAY]: []
  });
  const w2 = dom2.window;
  boot(w2);
  await waitFor(w2, '.history-table thead th');
  const heads = Array.from(w2.document.querySelectorAll('.history-table thead th')).map(th => th.textContent.trim());
  assert.ok(heads.includes('Actions'), 'Actions column present');
});
