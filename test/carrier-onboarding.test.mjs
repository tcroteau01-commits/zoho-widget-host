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
      const loginUser = opts.loginUser === undefined ? 'broker@test.com' : opts.loginUser;
      window.ZOHO = {
        CREATOR: {
          UTIL: { getInitParams: () => Promise.resolve(loginUser ? { loginUser } : {}) },
          init: () => Promise.resolve()
        }
      };
      window.fetch = (url, init) => {
        const u = String(url);
        if (u.includes('/broker-report')) {
          if (opts.historyFails) return Promise.reject(new Error('network down'));
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

// ── OB3.1: search-first send flow ─────────────────────────────────────────────
function makeLookupWidget(carrier) {
  // carrier: object returned as lookupResult.carrier (null = not found)
  const posts = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://tcroteau01-commits.github.io/carrier-onboarding.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: {
        UTIL: { getInitParams: () => Promise.resolve({ loginUser: 'broker@test.com' }) },
        init: () => Promise.resolve() } };
      window.fetch = (url, init) => {
        const u = String(url);
        if (u.includes('/carrier-lookup')) {
          return Promise.resolve({ ok: true,
            text: () => Promise.resolve(''),
            json: () => Promise.resolve({ carrier: carrier, existing_vendor: null }) });
        }
        if (u.includes('/broker-users')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ self_contact_id: 'c1' }) });
        }
        if (u.includes('/broker-send-onboarding-link')) {
          posts.push({ url: u, body: JSON.parse((init && init.body) || '{}') });
          return Promise.resolve({ ok: true, status: 200,
            text: () => Promise.resolve(JSON.stringify({ ok: true, id: 'n1' })),
            json: () => Promise.resolve({ ok: true, id: 'n1' }) });
        }
        if (u.includes('/broker-report')) {
          return Promise.resolve({ ok: true, text: () => Promise.resolve(''),
            json: () => Promise.resolve({ records: [] }) });
        }
        return Promise.resolve({ ok: true, text: () => Promise.resolve('{}'),
          json: () => Promise.resolve({}) });
      };
      window._posts = posts;
    }
  });
  return dom;
}

async function runLookup(w) {
  w.document.getElementById('lookup-input').value = '92261';
  w.document.getElementById('lookup-btn').click();
  // Wait for the final result (not the transient loading state which also has .result-info)
  await waitFor(w, '#lookup-result .result-name', 500);
  // Let any remaining microtasks (fetch .then chains) settle
  await new Promise(r => setTimeout(r, 20));
}

test('clicking a send card before any lookup does NOT open the modal', async () => {
  const dom = makeLookupWidget({ dot_number: '92261', carrier_name: 'A&M', email_address: 'fmcsa@carrier.com' });
  const w = dom.window;
  w.dispatchEvent(new w.Event('load'));
  await waitFor(w, '[data-open-modal]');
  w.document.querySelector('[data-open-modal="full"]').click();
  assert.ok(!w.document.getElementById('modal-scrim').classList.contains('show'),
    'modal must not open without a prior lookup');
});

test('after lookup with FMCSA email, Send To is prefilled + locked and DOT is shown', async () => {
  const dom = makeLookupWidget({ dot_number: '92261', carrier_name: 'A&M', email_address: 'fmcsa@carrier.com' });
  const w = dom.window;
  w.dispatchEvent(new w.Event('load'));
  await waitFor(w, '[data-open-modal]');
  await runLookup(w);
  w.document.querySelector('[data-open-modal="full"]').click();
  assert.ok(w.document.getElementById('modal-scrim').classList.contains('show'), 'modal opens after lookup');
  const sendTo = w.document.getElementById('m-send-to');
  assert.strictEqual(sendTo.value, 'fmcsa@carrier.com');
  assert.strictEqual(sendTo.readOnly, true, 'FMCSA email locked');
  assert.ok(sendTo.classList.contains('locked'));
  assert.strictEqual(w.document.getElementById('m-carrier-dot').value, '92261');
});

test('after lookup with NO FMCSA email, Send To is editable but DOT still shown', async () => {
  const dom = makeLookupWidget({ dot_number: '92261', carrier_name: 'A&M', email_address: '' });
  const w = dom.window;
  w.dispatchEvent(new w.Event('load'));
  await waitFor(w, '[data-open-modal]');
  await runLookup(w);
  w.document.querySelector('[data-open-modal="full"]').click();
  const sendTo = w.document.getElementById('m-send-to');
  assert.strictEqual(sendTo.readOnly, false, 'Send To editable when no FMCSA email');
  assert.strictEqual(w.document.getElementById('m-carrier-dot').value, '92261');
});

test('send posts the locked FMCSA email and DOT', async () => {
  const dom = makeLookupWidget({ dot_number: '92261', carrier_name: 'A&M', email_address: 'fmcsa@carrier.com' });
  const w = dom.window;
  w.dispatchEvent(new w.Event('load'));
  await waitFor(w, '[data-open-modal]');
  await runLookup(w);
  w.document.querySelector('[data-open-modal="full"]').click();
  w.document.getElementById('modal-submit').click();
  await new Promise(r => setTimeout(r, 30));
  const posts = w._posts.filter(p => p.url.includes('/broker-send-onboarding-link'));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.send_to, 'fmcsa@carrier.com');
  assert.equal(String(posts[0].body.carrier_dot), '92261');
});

// ── Client-facing error copy (no DevTools/F12 hints) ──────────────────────────
async function waitForText(w, sel, re, timeout = 500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const el = w.document.querySelector(sel);
    if (el && re.test(el.textContent)) return el.textContent;
    await new Promise(r => setTimeout(r, 10));
  }
  const el = w.document.querySelector(sel);
  return el ? el.textContent : '';
}

test('history load failure shows a client-facing message, not a DevTools hint', async () => {
  // A broker whose history fetch rejects (e.g. the onboarding report 502s) must
  // see a client-appropriate message, not "Open DevTools console (F12)".
  const dom = makeWidget({}, { historyFails: true });
  const w = dom.window;
  w.dispatchEvent(new w.Event('load'));
  const txt = await waitForText(w, '#history-body', /couldn't load your recently sent links/i);
  assert.doesNotMatch(txt, /DevTools|F12/i);
  assert.match(txt, /couldn't load your recently sent links/i);
});

test('unidentified broker shows a client-facing message, not a DevTools hint', async () => {
  const dom = makeWidget({}, { loginUser: '' });
  const w = dom.window;
  w.dispatchEvent(new w.Event('load'));
  const txt = await waitForText(w, '#lookup-result', /identify/i);
  assert.match(txt, /Could not identify broker/i);
  assert.doesNotMatch(txt, /DevTools|F12/i);
});

test('dual authority renders a warning badge, not green', async () => {
  const dom = makeWidget({ [FULL]: [], [PAY]: [] });
  boot(dom.window);
  dom.window.renderLookupResult({
    carrier: { dot_number: '111', carrier_name: 'DOUBLE BROKE LLC',
               authority_class: 'dual', authority_active: true },
    existing_vendor: null
  }, 'DOT 111');
  const html = dom.window.document.getElementById('lookup-result').innerHTML;
  assert.match(html, /Dual Authority/i);
  assert.doesNotMatch(html, /FMCSA Active/i);
});

test('broker_only authority warns', async () => {
  const dom = makeWidget({ [FULL]: [], [PAY]: [] });
  boot(dom.window);
  dom.window.renderLookupResult({
    carrier: { dot_number: '222', carrier_name: 'PURE BROKER INC',
               authority_class: 'broker_only', authority_active: true },
    existing_vendor: null
  }, 'DOT 222');
  const html = dom.window.document.getElementById('lookup-result').innerHTML;
  assert.match(html, /Broker Authority/i);
  assert.doesNotMatch(html, /FMCSA Active/i);
});

test('carrier class still renders green FMCSA Active', async () => {
  const dom = makeWidget({ [FULL]: [], [PAY]: [] });
  boot(dom.window);
  dom.window.renderLookupResult({
    carrier: { dot_number: '333', carrier_name: 'REAL CARRIER LLC',
               authority_class: 'carrier', authority_active: true },
    existing_vendor: null
  }, 'DOT 333');
  const html = dom.window.document.getElementById('lookup-result').innerHTML;
  assert.match(html, /FMCSA Active/i);
});

test('authorityChipHtml returns a chip for dual', () => {
  const dom = makeWidget({ [FULL]: [], [PAY]: [] });
  boot(dom.window);
  assert.match(dom.window.authorityChipHtml('dual'), /double-broker/i);
});

test('authorityChipHtml returns a chip for broker_only', () => {
  const dom = makeWidget({ [FULL]: [], [PAY]: [] });
  boot(dom.window);
  assert.match(dom.window.authorityChipHtml('broker_only'), /Broker authority, not a carrier/i);
});

test('authorityChipHtml returns empty for carrier', () => {
  const dom = makeWidget({ [FULL]: [], [PAY]: [] });
  boot(dom.window);
  assert.equal(dom.window.authorityChipHtml('carrier'), '');
});

test('already-a-vendor result shows the authority chip for a dual carrier', async () => {
  const dom = makeWidget({ [FULL]: [], [PAY]: [] });
  boot(dom.window);
  dom.window.renderLookupResult({
    carrier: { dot_number: '7', carrier_name: 'X', authority_class: 'dual' },
    existing_vendor: { ID: '1', Vendor_Name: 'X', Vendor_Status: 'Approved', USDOT: '7' }
  }, 'DOT 7');
  const html = dom.window.document.getElementById('lookup-result').innerHTML;
  assert.match(html, /double-broker/i);
});
