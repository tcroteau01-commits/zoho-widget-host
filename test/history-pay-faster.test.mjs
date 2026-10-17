// PAYCHG1 Task 9: Pay carrier faster on Submission History (history.html).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../history.html', import.meta.url), 'utf8');
const PF_SRC = readFileSync(new URL('../pay-faster.js', import.meta.url), 'utf8');

const CTX = { enabled: true, trained: true, training_video_id: 'vid-1', qp_fee_pct: '4',
  operfi_share_pct: '2', reserve: { cash: 1250, status: 'ok' } };
const REQ = { id: 'req1', status: 'requested', payer: 'carrier', terms_on_file: 'Standard Net 30',
  qp_fee_pct: '4', operfi_share_pct: '2', requested_at: '2026-10-17T15:04:05Z', resolved_at: null, ops_note: '' };
const ELIG = { eligible: true, reason: null, kind: 'net30', terms: 'Standard Net 30', request: null };

const PENDING_ELIG = { eligible: false, reason: 'already_requested', kind: 'net30', terms: 'Standard Net 30', request: REQ };

const ROW = { ID: '4100000000000000001', Purchase_Status: 'Purchased', Added_Time: '13-Jul-2026 06:40:15',
  Load_Rate_Confirmation_Number: 'L-100', Customer_Reference_Number: 'PO-1',
  Customer_Rate: '2,500.00', Carrier_Rate: '2,000.00', Payment_Terms: 'Standard Net 30',
  Broker_Pay_Term: 'Standard Net 30' };

function makeDom(opts) {
  opts = opts || {};
  const calls = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/history.html?serviceOrigin=https://brokerhub.operfi.com',
    beforeParse(w) {
      w.__calls = calls;
      w.__opened = [];
      w.open = (u) => { w.__opened.push(u); };
      w.ZOHO = { CREATOR: { UTIL: { getInitParams: () => Promise.resolve({ loginUser: 'b@x.com' }) } } };
      if (opts.staff) w.OPERFI_IMP = { isStaff: () => true, hint: (t) => t };
      w.fetch = (url, o) => {
        const u = String(url);
        calls.push({ url: u, opts: o || {} });
        let status = 200, body = {};
        if (u.indexOf('/pay-change/context') !== -1) {
          if (opts.ctx === 404) { status = 404; body = { error: 'not_found' }; }
          else body = opts.ctx || CTX;
        } else if (u.indexOf('/pay-change/eligibility') !== -1) {
          body = opts.elig || ELIG;
        } else if (u.indexOf('/resolve') !== -1) {
          const r = opts.resolve || { status: 200, body: { ok: true, request: Object.assign({}, REQ, { status: JSON.parse(o.body).status, resolved_at: '2026-10-17T16:00:00Z' }) } };
          status = r.status; body = r.body;
        } else if (u.indexOf('/pay-change/requests') !== -1) {
          const r = opts.post || { status: 201, body: { ok: true, request: REQ } };
          status = r.status; body = r.body;
        } else if (u.indexOf('/broker-report') !== -1) {
          body = { records: opts.rows || [] };
        }
        return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
      };
    }
  });
  const w = dom.window;
  w.eval(PF_SRC);
  return w;
}
const $ = (w, id) => w.document.getElementById(id);
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => { for (let i = 0; i < 10; i++) await tick(); };

async function open(rowOpts, domOpts) {
  const rows = [Object.assign({}, ROW, rowOpts || {})];
  const w = makeDom(Object.assign({}, domOpts, { rows }));
  await flush();
  w.document.querySelector('.row').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await flush();
  return w;
}
function click(w, el) { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }

test('pill shows for requested row', () => {
  const w = makeDom();
  const html = w.rowHtml(Object.assign({}, ROW, { pay_change: { status: 'requested', payer: 'carrier' } }), 0);
  assert.match(html, /⚡ Pay faster: Requested/);
  const a = w.rowHtml(Object.assign({}, ROW, { pay_change: { status: 'applied' } }), 0);
  assert.match(a, /⚡ Pay faster: Applied/);
  const d = w.rowHtml(Object.assign({}, ROW, { pay_change: { status: 'declined' } }), 0);
  assert.match(d, /⚡ Pay faster: Declined/);
  assert.doesNotMatch(w.rowHtml(ROW, 0), /Pay faster/);
});

test('changed pill logic untouched', async () => {
  const diff = { Payment_Terms: 'Factoring Company - Example Capital', Broker_Pay_Term: 'Standard Net 30' };
  let w = await open(diff, { elig: { eligible: false, reason: 'carrier_paid', kind: null, terms: null, request: null } });
  assert.doesNotMatch(w.document.querySelector('.row').innerHTML, /Pay faster/);
  assert.match($(w, 'panel').textContent, /Terms at submission/, 'BROKERTERMS2 treatment still shows');
  w = await open(Object.assign({}, diff, { pay_change: { status: 'requested' } }), { elig: PENDING_ELIG });
  assert.match($(w, 'panel').textContent, /Terms at submission/);
  assert.match(w.rowHtml(Object.assign({}, ROW, diff, { pay_change: { status: 'requested' } }), 0), /Pay faster: Requested/);
  w = await open({}, { elig: { eligible: false, reason: 'carrier_paid', kind: null, terms: null, request: null } });
  assert.doesNotMatch($(w, 'panel').textContent, /Terms at submission/);
});

test('button only when eligible', async () => {
  let w = await open();
  assert.ok($(w, 'pf-open'), 'eligible shows the button');
  assert.match($(w, 'pf-open').textContent, /Pay carrier faster/);
  assert.ok(w.__calls.some((c) => /\/pay-change\/eligibility\?/.test(c.url) && /record_id=4100000000000000001/.test(c.url)));
  w = await open({}, { elig: { eligible: false, reason: 'carrier_paid', kind: 'net30', terms: 'Standard Net 30', request: null } });
  assert.ok(!$(w, 'pf-open'));
  w = await open({}, { ctx: 404 });
  assert.ok(!$(w, 'pf-open'));
  assert.ok(!w.__calls.some((c) => /eligibility/.test(c.url)));
});

test('untrained shows locked button', async () => {
  const w = await open({}, { ctx: Object.assign({}, CTX, { trained: false }) });
  const b = $(w, 'pf-open');
  assert.ok(b);
  assert.equal(b.disabled, true);
  const link = w.document.querySelector('#pf-slot .pf-video-link');
  assert.ok(link);
  click(w, link);
  assert.deepEqual(w.__opened, ['https://app.operfi.com/help-center.html']);
});

async function openPopup(rowOpts, domOpts) {
  const w = await open(rowOpts, domOpts);
  click(w, $(w, 'pf-open'));
  await flush();
  return w;
}
function pick(w, p) {
  const r = $(w, 'pf-payer-' + p); r.checked = true;
  r.dispatchEvent(new w.Event('change', { bubbles: true }));
}

test('send request posts payer and note', async () => {
  const w = await openPopup();
  assert.equal($(w, 'pf-send').disabled, true, 'needs a payer first');
  pick(w, 'carrier');
  await flush();
  $(w, 'pf-note').value = 'Carrier called twice';
  w.__calls.length = 0;
  click(w, $(w, 'pf-send'));
  await flush();
  const c = w.__calls.find((x) => /\/pay-change\/requests$/.test(x.url));
  assert.ok(c);
  assert.equal(c.opts.method, 'POST');
  assert.deepEqual(JSON.parse(c.opts.body), { email: 'b@x.com', record_id: '4100000000000000001', payer: 'carrier', broker_note: 'Carrier called twice' });
  assert.ok(!$(w, 'pf-modal'), 'popup closes on 201');
  assert.match(w.document.body.textContent, /Pay faster: Requested/);
});

test('409 already_requested message', async () => {
  const w = await openPopup({}, { post: { status: 409, body: { error: 'already_requested' } } });
  pick(w, 'carrier'); await flush();
  click(w, $(w, 'pf-send')); await flush();
  assert.match($(w, 'pf-error').textContent, /A pay-faster request is already open for this load\./);
});

test('other errors map to copy', async () => {
  let w = await openPopup({}, { post: { status: 409, body: { error: 'carrier_paid' } } });
  pick(w, 'carrier'); await flush(); click(w, $(w, 'pf-send')); await flush();
  assert.match($(w, 'pf-error').textContent, /This carrier has already been paid\./);
  w = await openPopup({}, { post: { status: 409, body: { error: 'reserve_insufficient', cash: '10.00', charge: '40.00' } } });
  pick(w, 'carrier'); await flush(); click(w, $(w, 'pf-send')); await flush();
  assert.match($(w, 'pf-error').textContent, /reserve balance \(\$10\.00\) doesn't cover the \$40\.00 fee/);
  w = await openPopup({}, { post: { status: 503, body: { error: 'lookup_failed' } } });
  pick(w, 'carrier'); await flush(); click(w, $(w, 'pf-send')); await flush();
  assert.match($(w, 'pf-error').textContent, /We couldn't send the request\. Try again or contact OperFi\./);
});

test('broker radio disabled when reserve is short', async () => {
  const w = await openPopup({}, { ctx: Object.assign({}, CTX, { reserve: { cash: 5, status: 'ok' } }) });
  assert.equal($(w, 'pf-payer-broker').disabled, true);
});

test('popup amounts use the formatted carrier rate', async () => {
  const w = await openPopup();
  assert.match($(w, 'pf-modal').textContent, /\$80\.00/);
  assert.match($(w, 'pf-modal').textContent, /\$1,920\.00/);
});

test('timeline entries have no dates when flag false', async () => {
  const w = await open({ pay_change: { status: 'applied' } }, {
    elig: { eligible: false, reason: 'already_requested', kind: 'net30', terms: 'Standard Net 30',
      request: Object.assign({}, REQ, { status: 'applied', resolved_at: '2026-10-17T16:00:00Z' }) } });
  const t = $(w, 'panel').querySelector('.timeline').textContent;
  assert.match(t, /Pay change requested: Standard Net 30 → Quick Pay, carrier pays 4%/);
  assert.match(t, /Pay change applied/);
  const items = [...$(w, 'panel').querySelectorAll('.timeline-item')].filter((i) => /Pay change/.test(i.textContent));
  assert.equal(items.length, 2);
  items.forEach((i) => {
    assert.equal(i.querySelector('.timeline-time'), null);
    assert.doesNotMatch(i.textContent, /Oct|2026| CT/);
  });
});

test('broker-paid timeline wording uses the 2% share', async () => {
  const w = await open({ pay_change: { status: 'requested' } }, {
    elig: { eligible: false, reason: 'already_requested', kind: 'net30', terms: 'Standard Net 30',
      request: Object.assign({}, REQ, { payer: 'broker' }) } });
  assert.match($(w, 'panel').querySelector('.timeline').textContent, /broker pays 2%/);
});


test('staff sees resolve controls; broker does not', async () => {
  let w = await open({ pay_change: { status: 'requested' } }, { staff: true, elig: PENDING_ELIG });
  assert.ok($(w, 'pf-apply'));
  assert.ok($(w, 'pf-decline'));
  assert.ok($(w, 'pf-ops-note'));
  w = await open({ pay_change: { status: 'requested' } }, { elig: PENDING_ELIG });
  assert.ok(!$(w, 'pf-apply'));
  assert.ok(!$(w, 'pf-decline'));
  w = await open({ pay_change: { status: 'applied' } }, { staff: true, elig: Object.assign({}, PENDING_ELIG, { request: Object.assign({}, REQ, { status: 'applied' }) }) });
  assert.ok(!$(w, 'pf-apply'));
});

test('resolve posts without impersonate param', async () => {
  const w = await open({ pay_change: { status: 'requested' } }, { staff: true, elig: PENDING_ELIG });
  $(w, 'pf-ops-note').value = 'Done in FV';
  w.__calls.length = 0;
  click(w, $(w, 'pf-apply'));
  await flush();
  const c = w.__calls.find((x) => /\/pay-change\/requests\/req1\/resolve/.test(x.url));
  assert.ok(c);
  assert.equal(c.opts.method, 'POST');
  assert.doesNotMatch(c.url, /impersonate/);
  assert.match(c.url, /email=b%40x\.com/);
  assert.deepEqual(JSON.parse(c.opts.body), { status: 'applied', ops_note: 'Done in FV' });
  assert.match(w.document.body.textContent, /Pay faster: Applied/);
  assert.ok(!$(w, 'pf-apply'));
});

test('interpolated text is escaped', async () => {
  const w = await open({ pay_change: { status: 'requested' } }, {
    elig: Object.assign({}, PENDING_ELIG, { request: Object.assign({}, REQ, { terms_on_file: '<img src=x onerror=1>' }) }) });
  assert.equal($(w, 'panel').querySelector('.timeline img'), null);
});

const ROW2 = Object.assign({}, ROW, { ID: '4100000000000000002', Load_Rate_Confirmation_Number: 'L-200' });
const key = (w, el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));

test('typing j/k/Escape in the note box does not navigate or close', async () => {
  const w = makeDom({ rows: [ROW, ROW2] });
  await flush();
  w.document.querySelector('.row').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await flush();
  const before = $(w, 'panel').querySelector('.position').textContent;
  click(w, $(w, 'pf-open')); await flush();
  pick(w, 'carrier'); await flush();
  const note = $(w, 'pf-note');
  note.value = 'draft text';
  key(w, note, 'j'); key(w, note, 'k');
  await flush();
  assert.equal($(w, 'panel').querySelector('.position').textContent, before);
  assert.equal($(w, 'pf-note').value, 'draft text');
  assert.ok($(w, 'pf-modal'));
  key(w, note, 'Escape');
  assert.ok(!$(w, 'pf-modal'), 'Escape closes the modal');
  assert.ok($(w, 'panel').classList.contains('show'), 'panel stays open');
  assert.equal($(w, 'panel').querySelector('.position').textContent, before);
});

test('j/k on body do nothing while the modal is open', async () => {
  const w = makeDom({ rows: [ROW, ROW2] });
  await flush();
  w.document.querySelector('.row').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await flush();
  const before = $(w, 'panel').querySelector('.position').textContent;
  click(w, $(w, 'pf-open')); await flush();
  key(w, w.document.body, 'j');
  await flush();
  assert.equal($(w, 'panel').querySelector('.position').textContent, before);
  assert.ok($(w, 'pf-modal'));
});

test('staff controls appear when the staff flag flips after paint', async () => {
  let staff = false;
  const rows = [Object.assign({}, ROW, { pay_change: { status: 'requested' } })];
  const w = makeDom({ rows, elig: PENDING_ELIG });
  w.OPERFI_IMP = { isStaff: () => staff, hint: (t) => t };
  await flush();
  w.document.querySelector('.row').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await flush();
  assert.ok(!$(w, 'pf-apply'));
  staff = true;
  await new Promise((r) => setTimeout(r, 450));
  assert.ok($(w, 'pf-apply'));
});

test('unknown pay_change status gives no pill', () => {
  const w = makeDom();
  assert.equal(w.rowHtml(Object.assign({}, ROW, { pay_change: { status: 'constructor' } }), 0).indexOf('Pay faster'), -1);
});

test('eligibility error does not stick on reopen', async () => {
  let n = 0;
  const w = makeDom({ rows: [ROW] });
  const f = w.fetch;
  w.fetch = (u, o) => {
    if (String(u).indexOf('/pay-change/eligibility') !== -1 && ++n === 1) {
      return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ error: 'lookup_failed' }) });
    }
    return f(u, o);
  };
  await flush();
  const row = () => w.document.querySelector('.row');
  row().dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await flush();
  assert.ok(!$(w, 'pf-open'));
  click(w, $(w, 'p-close')); await flush();
  row().dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await flush();
  assert.equal(n, 2);
  assert.ok($(w, 'pf-open'));
});

test('j typed in the ops note does not navigate; Escape in search still closes the panel', async () => {
  const rows = [Object.assign({}, ROW, { pay_change: { status: 'requested' } }), ROW2];
  const w = makeDom({ rows, staff: true, elig: PENDING_ELIG });
  await flush();
  w.document.querySelector('.row').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await flush();
  const before = $(w, 'panel').querySelector('.position').textContent;
  const note = $(w, 'pf-ops-note');
  assert.ok(note);
  note.value = 'abc';
  key(w, note, 'j'); key(w, note, 'k');
  await flush();
  assert.equal($(w, 'panel').querySelector('.position').textContent, before);
  assert.equal($(w, 'pf-ops-note').value, 'abc');
  assert.ok(!$(w, 'pf-modal'));
  key(w, $(w, 'search-input'), 'Escape');
  assert.ok(!$(w, 'panel').classList.contains('show'), 'Escape in search closes the panel');
});
