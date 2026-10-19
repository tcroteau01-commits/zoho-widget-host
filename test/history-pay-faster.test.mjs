// PAYCHG1 Task 9: Pay carrier faster on Submission History (history.html).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../history.html', import.meta.url), 'utf8');
const PF_SRC = readFileSync(new URL('../pay-faster.js', import.meta.url), 'utf8');

// PAYCHGACCESS1: an approved client with both boxes. The real context always reports waive_enabled.
const CTX = { enabled: true, trained: true, training_video_id: 'vid-1', qp_fee_pct: '4',
  operfi_share_pct: '2', reserve: { cash: 1250, status: 'ok' }, waive_enabled: true,
  access: { pay_faster: true, fee_adjust: true }, staff: false };
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
      if (opts.staff || opts.imp) {
        w.OPERFI_IMP = { isStaff: () => !!opts.staff, hint: (t) => t, target: () => opts.imp || '' };
      }
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
  assert.match($(w, 'pf-error').textContent, /A pay change request is already open for this load\./);
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

test('staff flag flipping late is watched for about 10s', () => {
  const m = HTML.match(/var PF_STAFF_POLL_MS = (\d+), PF_STAFF_MAX_TRIES = (\d+);/);
  assert.ok(m);
  const total = Number(m[1]) * Number(m[2]);
  assert.ok(total >= 10000 && total <= 11000, String(total));
});

test('staff flag flipping late repaints timeline dates', async () => {
  let staff = false;
  const elig = Object.assign({}, PENDING_ELIG, { request: Object.assign({}, REQ, { status: 'applied', resolved_at: '2026-10-17T16:00:00Z' }) });
  const rows = [Object.assign({}, ROW, { pay_change: { status: 'applied' } })];
  const w = makeDom({ rows, elig });
  w.OPERFI_IMP = { isStaff: () => staff, hint: (t) => t, target: () => '' };
  await flush();
  w.document.querySelector('.row').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await flush();
  const times = () => [...$(w, 'panel').querySelectorAll('.timeline-item')]
    .filter((i) => /Pay change/.test(i.textContent)).map((i) => i.querySelector('.timeline-time'));
  assert.ok(times().every((t) => t === null));
  staff = true;
  await new Promise((r) => setTimeout(r, 450));
  assert.ok(times().every((t) => t && / CT$/.test(t.textContent)));
});

test('staff always see timeline dates; brokers do not', async () => {
  const elig = { eligible: false, reason: 'already_requested', kind: 'net30', terms: 'Standard Net 30',
    request: Object.assign({}, REQ, { status: 'applied', resolved_at: '2026-10-17T16:00:00Z' }) };
  const items = (w) => [...$(w, 'panel').querySelectorAll('.timeline-item')].filter((i) => /Pay change/.test(i.textContent));
  let w = await open({ pay_change: { status: 'applied' } }, { staff: true, elig });
  assert.match(HTML, /var PAYCHG_SHOW_DATES = false;/);
  assert.equal(items(w).length, 2);
  items(w).forEach((i) => {
    const t = i.querySelector('.timeline-time');
    assert.ok(t, 'staff sees a date');
    assert.match(t.textContent, /Oct 17, 2026.* CT$/);
  });
  w = await open({ pay_change: { status: 'applied' } }, { elig });
  items(w).forEach((i) => assert.equal(i.querySelector('.timeline-time'), null));
});

test('impersonating staff get no request button but keep resolve controls', async () => {
  let w = await open({}, { staff: true, imp: 'client@sample-brokerage.example' });
  assert.ok(!$(w, 'pf-open'), 'no broker request button while impersonating');
  w = await open({ pay_change: { status: 'requested' } },
    { staff: true, imp: 'client@sample-brokerage.example', elig: PENDING_ELIG });
  assert.ok($(w, 'pf-apply'));
  assert.ok($(w, 'pf-decline'));
  w = await open({}, { staff: true });
  assert.ok($(w, 'pf-open'), 'staff not impersonating: unchanged');
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

test('arrow keys typed in the ops note do not navigate or wipe the note', async () => {
  const rows = [Object.assign({}, ROW, { pay_change: { status: 'requested' } }), ROW2];
  const w = makeDom({ rows, staff: true, elig: PENDING_ELIG });
  await flush();
  w.document.querySelector('.row').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await flush();
  const before = $(w, 'panel').querySelector('.position').textContent;
  const note = $(w, 'pf-ops-note');
  note.value = 'keep me';
  key(w, note, 'ArrowDown'); key(w, note, 'ArrowUp');
  await flush();
  assert.equal($(w, 'panel').querySelector('.position').textContent, before);
  assert.equal($(w, 'pf-ops-note').value, 'keep me');
});

test('pay change timeline entries follow Purchased when requested after purchase, precede it when requested before', async () => {
  const elig = { eligible: false, reason: 'already_requested', kind: 'net30', terms: 'Standard Net 30',
    request: Object.assign({}, REQ, { status: 'applied', resolved_at: '2026-10-17T16:00:00Z' }) };
  const titles = (w) => [...$(w, 'panel').querySelectorAll('.timeline-title')].map((e) => e.textContent);
  let w = await open({ Purchase_Date: '15-Jul-2026', pay_change: { status: 'applied' } }, { elig });
  let t = titles(w);
  assert.ok(t.indexOf('Purchased') < t.findIndex((x) => /Pay change requested/.test(x)), 'requested after purchase');
  assert.ok(t.findIndex((x) => /Pay change requested/.test(x)) < t.indexOf('Pay change applied'));
  w = await open({ Purchase_Date: '25-Oct-2026', pay_change: { status: 'applied' } }, { elig });
  t = titles(w);
  assert.ok(t.findIndex((x) => /Pay change requested/.test(x)) < t.indexOf('Purchased'), 'requested before purchase');
});

// ---- PAYCHG2 Task 5: waive the QP fee ----
const QP_ROW = { Payment_Terms: 'Quick Pay', Broker_Pay_Term: 'Quick Pay' };
const QP_ELIG = { eligible: true, reason: null, kind: 'quickpay', terms: 'Quick Pay', request: null };
const WAIVE_REQ = Object.assign({}, REQ, { payer: 'broker', terms_on_file: 'Quick Pay', qp_fee_pct: '4',
  request_type: 'qp_fee', carrier_fee_pct: '0', carrier_fee: '0.00' });

test('quickpay eligible shows Waive QP fee', async () => {
  const w = await open(QP_ROW, { elig: QP_ELIG });
  assert.match($(w, 'pf-open').textContent, /Waive QP fee/);
  assert.doesNotMatch($(w, 'pf-open').textContent, /Pay carrier faster/);
});

test('waive popup sends payer broker', async () => {
  const w = await open(QP_ROW, { elig: QP_ELIG });
  w.__calls.length = 0;
  click(w, $(w, 'pf-open'));
  await flush();
  assert.ok(w.__calls.some((c) => /\/pay-change\/context/.test(c.url)), 'context refetched on open');
  assert.match($(w, 'pf-modal').textContent, /Waive the quick pay fee on this load/);
  assert.match($(w, 'pf-modal').textContent, /\$40\.00/);
  assert.equal($(w, 'pf-send').disabled, false);
  $(w, 'pf-note').value = 'Good carrier';
  w.__calls.length = 0;
  click(w, $(w, 'pf-send'));
  await flush();
  const c = w.__calls.find((x) => /\/pay-change\/requests$/.test(x.url));
  assert.deepEqual(JSON.parse(c.opts.body), { email: 'b@x.com', record_id: '4100000000000000001', payer: 'broker', broker_note: 'Good carrier' });
});

test('waive short reserve disables send', async () => {
  const w = await open(QP_ROW, { elig: QP_ELIG, ctx: Object.assign({}, CTX, { reserve: { cash: 5, status: 'ok' } }) });
  click(w, $(w, 'pf-open'));
  await flush();
  assert.equal($(w, 'pf-send').disabled, true);
  assert.match($(w, 'pf-modal').textContent, /Your reserve balance \(\$5\.00\) doesn't cover the \$40\.00 fee\./);
});

test('waive resolved timeline titles', async () => {
  const titles = (w) => [...$(w, 'panel').querySelectorAll('.timeline-title')].map((e) => e.textContent);
  const el = (req) => ({ eligible: false, reason: 'already_requested', kind: 'quickpay', terms: 'Quick Pay', request: req });
  let w = await open(QP_ROW, { elig: el(Object.assign({}, WAIVE_REQ, { status: 'applied', resolved_at: '2026-10-17T16:00:00Z' })) });
  assert.ok(titles(w).includes('QP fee waiver applied'), titles(w).join('|'));
  w = await open(QP_ROW, { elig: el(Object.assign({}, WAIVE_REQ, { status: 'declined', resolved_at: '2026-10-17T16:00:00Z' })) });
  assert.ok(titles(w).includes('QP fee waiver declined'));
  w = await open(QP_ROW, { elig: el(Object.assign({}, WAIVE_REQ, { carrier_fee_pct: '3.5', status: 'applied' })) });
  assert.ok(titles(w).includes('QP fee change applied'));
});

test('waive pill and timeline', async () => {
  const w = await open(Object.assign({}, QP_ROW, { pay_change: { status: 'requested', payer: 'broker', request_type: 'qp_fee', carrier_fee_pct: '0' } }), {
    elig: { eligible: false, reason: 'already_requested', kind: 'quickpay', terms: 'Quick Pay', request: WAIVE_REQ } });
  assert.match(w.rowHtml(Object.assign({}, ROW, { pay_change: { status: 'requested', payer: 'broker', request_type: 'qp_fee', carrier_fee_pct: '0' } }), 0), /⚡ QP fee waived: Requested/);
  assert.match($(w, 'panel').querySelector('.timeline').textContent, /QP fee waived: broker covers 2% from reserve/);
});

test('waive request label, changed fee and staff slot', async () => {
  const w = await open(Object.assign({}, QP_ROW, { pay_change: { status: 'requested' } }), { staff: true,
    elig: { eligible: false, reason: 'already_requested', kind: 'quickpay', terms: 'Quick Pay', request: WAIVE_REQ } });
  assert.match($(w, 'pf-slot').textContent, /QP fee waived request \(OperFi staff\)/);
  assert.match(w.rowHtml(Object.assign({}, ROW, { pay_change: { status: 'applied', request_type: 'qp_fee', carrier_fee_pct: '3.5' } }), 0), /⚡ QP fee changed to 3\.5%: Applied/);
});

test('waive via POST response paints the pill', async () => {
  const w = await open(QP_ROW, { elig: QP_ELIG, post: { status: 201, body: { ok: true, request: WAIVE_REQ } } });
  click(w, $(w, 'pf-open')); await flush();
  click(w, $(w, 'pf-send')); await flush();
  assert.match(w.document.body.textContent, /QP fee waived: Requested/);
});

test('old request renders as before', async () => {
  const w = await open({ pay_change: { status: 'requested', payer: 'carrier', request_type: null, carrier_fee_pct: null } }, { elig: PENDING_ELIG, staff: true });
  assert.match(w.rowHtml(Object.assign({}, ROW, { pay_change: { status: 'requested', payer: 'carrier', request_type: null, carrier_fee_pct: null } }), 0), /⚡ Pay faster: Requested/);
  assert.match($(w, 'panel').querySelector('.timeline').textContent, /Pay change requested: Standard Net 30 → Quick Pay, carrier pays 4%/);
  assert.match($(w, 'pf-slot').textContent, /Pay faster request \(OperFi staff\)/);
  assert.match($(w, 'pf-slot').textContent, /Standard Net 30 → Quick Pay, carrier pays 4%/);
});

// ---- Staff box shows the dollar math ops keys into FactorView (Tom 10-19) ----
const MATH_REQ = Object.assign({}, REQ, { carrier_rate: '2000.00', carrier_fee: '100.00', carrier_fee_pct: '5',
  qp_fee_pct: '5', fee_total: '100.00', broker_share: '60.00', operfi_share: '40.00', reserve_charge: '0.00',
  payee_receives: '1900.00', vendor_name: 'TESTING ZOHO CARRIER', fv_client_id: '12670', fv_vendor_id: '11716',
  broker_note: 'rush please', entered_by: 'client' });
const mathOf = (w) => $(w, 'pf-slot').querySelector('.pf-math');

test('staff box: carrier pays shows deduction, both shares and FV link', async () => {
  const w = await open({}, { staff: true, elig: Object.assign({}, PENDING_ELIG, { request: MATH_REQ }) });
  const t = mathOf(w).textContent;
  assert.match(t, /Carrier rate\$2,000\.00/);
  assert.match(t, /Quick pay fee5% · \$100\.00 · carrier pays/);
  assert.match(t, /Deduct from carrier payment\$100\.00/);
  assert.match(t, /TESTING ZOHO CARRIER receives\$1,900\.00/);
  assert.match(t, /Credit to broker \(3%\)\$60\.00/);
  assert.match(t, /OperFi earns \(2%\)\$40\.00/);
  assert.doesNotMatch(t, /Charge broker reserve/);
  assert.match(t, /Broker note: rush please/);
  const a = mathOf(w).querySelector('a.pf-fv');
  assert.equal(a.getAttribute('href'),
    'https://operfi.factorview.com/account/tools?section=vendor-payables&run=1&duedays=0&client=12670&debtor=&vendor=11716&arbalance=0');
  assert.doesNotMatch(t, /[–—]/);
});

test('staff box: broker covers shows reserve charge and UNVERIFIED, no deduction', async () => {
  const req = Object.assign({}, MATH_REQ, { payer: 'broker', carrier_fee: '0.00', carrier_fee_pct: '0', fee_total: '40.00',
    broker_share: '-40.00', reserve_charge: '40.00', payee_receives: '2000.00', reserve_status: 'unverified',
    reserve_balance_at_request: null });
  const w = await open({}, { staff: true, elig: Object.assign({}, PENDING_ELIG, { request: req }) });
  const t = mathOf(w).textContent;
  assert.match(t, /Quick pay fee2% · \$40\.00 · broker covers from reserve/);
  assert.doesNotMatch(t, /Deduct from/);
  assert.doesNotMatch(t, /Credit to broker/);
  assert.match(t, /Charge broker reserve\$40\.00/);
  assert.match(t, /Reserve UNVERIFIED/);
  assert.match(t, /TESTING ZOHO CARRIER receives\$2,000\.00/);
});

test('staff box: split, factored short pay, reserve balance, entered by staff', async () => {
  const req = Object.assign({}, MATH_REQ, { payer: 'split', carrier_fee: '20.00', carrier_fee_pct: '1', fee_total: '40.00',
    broker_share: '-20.00', reserve_charge: '20.00', payee_receives: '1980.00', factor_name: 'Example Capital',
    short_pay: true, reserve_status: 'covered', reserve_balance_at_request: '1250.00', entered_by: 'staff',
    entered_by_email: 'pat@operfi.com', terms_on_file: 'Factoring Company - Example Capital' });
  const w = await open({}, { staff: true, elig: Object.assign({}, PENDING_ELIG, { kind: 'factored', request: req }) });
  const t = mathOf(w).textContent;
  assert.match(t, /Quick pay fee1% · \$20\.00 · carrier pays, broker covers the other 1% \(\$20\.00\)/);
  assert.match(t, /Deduct from factor payment\$20\.00/);
  assert.match(t, /Example Capital receives\$1,980\.00/);
  assert.match(t, /Charge broker reserve\$20\.00/);
  assert.match(t, /Reserve \$1,250\.00 → \$1,230\.00/);
  assert.match(t, /Short pay to factor/);
  assert.match(t, /Entered by pat@operfi\.com for the client/);
});

test('staff box: legacy doc without carrier_fee still shows the deduction', async () => {
  const req = Object.assign({}, REQ, { carrier_rate: '2000.00', fee_total: '80.00', broker_share: '40.00',
    operfi_share: '40.00', reserve_charge: '0.00', payee_receives: '1920.00' });
  const w = await open({}, { staff: true, elig: Object.assign({}, PENDING_ELIG, { request: req }) });
  const t = mathOf(w).textContent;
  assert.match(t, /Deduct from carrier payment\$80\.00/);
  assert.match(t, /Carrier receives\$1,920\.00/);
  assert.equal(mathOf(w).querySelector('a.pf-fv'), null);
});

test('broker (non-staff) never sees the math box', async () => {
  const w = await open({}, { elig: Object.assign({}, PENDING_ELIG, { request: MATH_REQ }) });
  assert.equal($(w, 'pf-slot').querySelector('.pf-math'), null);
});

// ---- PAYCHG3 Task 8: fee picker on Submission History ----
const PICK_CTX = Object.assign({}, CTX, { fee_pick_enabled: true, waive_enabled: true });
const posts = (w) => w.__calls.filter((c) => /\/pay-change\/requests$/.test(c.url) && c.opts.method === 'POST');
function setFee(w, v) {
  const f = $(w, 'pf-fee');
  f.value = v;
  f.dispatchEvent(new w.Event('input', { bubbles: true }));
}

test('quickpay Change QP fee label', async () => {
  let w = await open(QP_ROW, { elig: QP_ELIG, ctx: PICK_CTX });
  assert.match($(w, 'pf-open').textContent, /Change QP fee/);
  assert.doesNotMatch($(w, 'pf-open').textContent, /Waive/);
  w = await open(QP_ROW, { elig: QP_ELIG });
  assert.match($(w, 'pf-open').textContent, /Waive QP fee/, 'flag off: unchanged');
  w = await open({}, { ctx: PICK_CTX });
  assert.match($(w, 'pf-open').textContent, /Pay carrier faster/);
});

test('popup picker sends carrier_fee_pct', async () => {
  const w = await open({}, { ctx: PICK_CTX });
  click(w, $(w, 'pf-open'));
  await flush();
  assert.ok($(w, 'pf-fee'), 'picker shown');
  assert.ok(!w.document.querySelector('input[name="pf-payer"]'), 'no payer radios');
  assert.equal($(w, 'pf-fee').value, '4', 'defaults to the saved fee');
  assert.equal($(w, 'pf-send').disabled, false);
  setFee(w, '3');
  await flush();
  assert.equal($(w, 'pf-fee'), w.document.getElementById('pf-fee'));
  $(w, 'pf-note').value = 'Hi';
  w.__calls.length = 0;
  click(w, $(w, 'pf-send'));
  await flush();
  const c = posts(w);
  assert.equal(c.length, 1);
  assert.deepEqual(JSON.parse(c[0].opts.body), { email: 'b@x.com', record_id: '4100000000000000001', carrier_fee_pct: '3', broker_note: 'Hi' });
});

test('popup picker keeps the input element while typing', async () => {
  const w = await open({}, { ctx: PICK_CTX });
  click(w, $(w, 'pf-open'));
  await flush();
  const el = $(w, 'pf-fee');
  setFee(w, '2.5');
  assert.strictEqual($(w, 'pf-fee'), el);
  assert.match($(w, 'pf-modal').textContent, /Carrier pays 2\.5%/);
});

test('popup picker validity', async () => {
  const w = await open({}, { ctx: PICK_CTX });
  click(w, $(w, 'pf-open'));
  await flush();
  w.__calls.length = 0;
  for (const v of ['', 'abc', '5.1', '-1']) {
    setFee(w, v);
    await flush();
    assert.equal($(w, 'pf-send').disabled, true, 'send disabled for "' + v + '"');
    $(w, 'pf-send').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await flush();
  }
  assert.equal(posts(w).length, 0, 'nothing was POSTed');
  setFee(w, '5');
  await flush();
  assert.equal($(w, 'pf-send').disabled, false);
});

test('popup picker quickpay at the saved fee is blocked, 0 is allowed', async () => {
  const w = await open(QP_ROW, { elig: QP_ELIG, ctx: PICK_CTX });
  click(w, $(w, 'pf-open'));
  await flush();
  assert.match($(w, 'pf-modal').textContent, /Change the QP fee/);
  assert.equal($(w, 'pf-fee').value, '4');
  assert.equal($(w, 'pf-send').disabled, true, 'saved fee on quickpay is no_change');
  setFee(w, '0');
  await flush();
  assert.equal($(w, 'pf-send').disabled, false);
  w.__calls.length = 0;
  click(w, $(w, 'pf-send'));
  await flush();
  assert.equal(JSON.parse(posts(w)[0].opts.body).carrier_fee_pct, '0');
});

test('popup picker refetches the reserve once when the value spends it', async () => {
  const w = await open({}, { ctx: PICK_CTX });
  click(w, $(w, 'pf-open'));
  await flush();
  w.__calls.length = 0;
  setFee(w, '1'); await flush();
  setFee(w, '0.5'); await flush();
  assert.equal(w.__calls.filter((c) => /\/pay-change\/context/.test(c.url)).length, 1);
});

test('popup picker short reserve disables send', async () => {
  const w = await open({}, { ctx: Object.assign({}, PICK_CTX, { reserve: { cash: 5, status: 'ok' } }) });
  click(w, $(w, 'pf-open'));
  await flush();
  setFee(w, '0');
  await flush();
  assert.equal($(w, 'pf-send').disabled, true);
  assert.match($(w, 'pf-modal').textContent, /Your reserve balance \(\$5\.00\) doesn't cover the \$40\.00 fee\./);
});

test('split request timeline wording', async () => {
  const SPLIT = Object.assign({}, REQ, { payer: 'split', carrier_fee_pct: '1.25', request_type: 'pay_faster' });
  const el = (req, kind, terms) => ({ eligible: false, reason: 'already_requested', kind, terms, request: req });
  let w = await open({}, { elig: el(SPLIT, 'net30', 'Standard Net 30') });
  const tl = $(w, 'panel').querySelector('.timeline').textContent;
  assert.match(tl, /Standard Net 30 → Quick Pay, carrier pays 1\.25% · broker covers 0\.75%/);
  assert.equal((tl.match(/1\.25%/g) || []).length, 1, 'percent not repeated');
  const QSPLIT = Object.assign({}, WAIVE_REQ, { payer: 'split', carrier_fee_pct: '1.25' });
  w = await open(QP_ROW, { staff: true, elig: el(QSPLIT, 'quickpay', 'Quick Pay') });
  assert.match($(w, 'panel').querySelector('.timeline').textContent, /QP fee change: carrier pays 1\.25% · broker covers 0\.75%/);
  assert.match($(w, 'pf-slot').textContent, /carrier pays 1\.25% · broker covers 0\.75%/);
});

test('fee change pill wording', async () => {
  const w = makeDom();
  assert.match(w.rowHtml(Object.assign({}, ROW, { pay_change: { status: 'requested', request_type: 'qp_fee', payer: 'carrier', carrier_fee_pct: '3.25' } }), 0), /⚡ QP fee changed to 3\.25%: Requested/);
  assert.match(w.rowHtml(Object.assign({}, ROW, { pay_change: { status: 'requested', request_type: 'qp_fee', payer: 'split', carrier_fee_pct: '1' } }), 0), /⚡ QP fee changed to 1%: Requested/);
  const el = { eligible: false, reason: 'already_requested', kind: 'quickpay', terms: 'Quick Pay',
    request: Object.assign({}, WAIVE_REQ, { payer: 'carrier', carrier_fee_pct: '3.25', status: 'applied' }) };
  const w2 = await open(QP_ROW, { elig: el });
  const tl = $(w2, 'panel').querySelector('.timeline').textContent;
  assert.match(tl, /QP fee changed to 3\.25%/);
  assert.equal((tl.match(/3\.25%/g) || []).length, 1);
});

test('legacy carrier row at 1.5% reads as PAYCHG1 (no split wording)', async () => {
  const LEG = Object.assign({}, REQ, { payer: 'carrier', qp_fee_pct: '1.5', request_type: null, carrier_fee_pct: null });
  const w = await open({ pay_change: { status: 'requested' } }, { staff: true, elig: { eligible: false, reason: 'already_requested', kind: 'net30', terms: 'Standard Net 30', request: LEG } });
  const tl = $(w, 'panel').querySelector('.timeline').textContent;
  assert.match(tl, /Pay change requested: Standard Net 30 → Quick Pay, carrier pays 1\.5%/);
  assert.doesNotMatch(tl, /broker covers/);
  assert.match($(w, 'pf-slot').textContent, /Standard Net 30 → Quick Pay, carrier pays 1\.5%/);
  assert.doesNotMatch($(w, 'pf-slot').textContent, /broker covers/);
});

// ---- PAYCHGACCESS1 Task 5: per-client access + staff entry ----
const NO_ACCESS_CTX = Object.assign({}, CTX, { access: { pay_faster: false, fee_adjust: false } });
const STAFF_CTX = Object.assign({}, CTX, { access: { pay_faster: false, fee_adjust: false }, staff: true, trained: false });
const IMP = 'client@sample-brokerage.example';
const ACCT_ROW = { 'Contact.Account_Name': { ID: '1', display_value: 'Sample Brokerage LLC' } };

test('client without access sees no button', async () => {
  let w = await open({}, { ctx: NO_ACCESS_CTX });
  assert.ok(!$(w, 'pf-open'));
  assert.ok(!w.document.querySelector('#pf-slot .pf-video-link'), 'no training hint either');
  assert.equal($(w, 'pf-slot').textContent.trim(), '');
  w = await open({}, { ctx: Object.assign({}, CTX, { access: undefined }) });
  assert.ok(!$(w, 'pf-open'), 'missing access key fails closed');
  w = await open({}, { ctx: Object.assign({}, CTX, { access: { pay_faster: 'true', fee_adjust: true } }) });
  assert.ok(!$(w, 'pf-open'), 'only a real true counts');
});

test('access removed keeps pill', async () => {
  const pc = { pay_change: { status: 'requested', payer: 'carrier' } };
  const w = await open(pc, { ctx: NO_ACCESS_CTX,
    elig: { eligible: false, reason: 'not_enabled_for_account', kind: 'net30', terms: 'Standard Net 30', request: REQ } });
  assert.match(w.document.querySelector('.row').innerHTML, /⚡ Pay faster: Requested/);
  assert.match($(w, 'panel').querySelector('.timeline').textContent, /Pay change requested: Standard Net 30 → Quick Pay, carrier pays 4%/);
  assert.ok(!$(w, 'pf-open'));
});

test('staff impersonating sees for-client button and banner', async () => {
  let w = await open(ACCT_ROW, { staff: true, imp: IMP, ctx: STAFF_CTX });
  const b = $(w, 'pf-open');
  assert.ok(b, 'staff get the button while impersonating');
  assert.equal(b.textContent, '⚡ Pay carrier faster (for client)');
  assert.equal(b.disabled, false, 'training gate does not apply to staff');
  assert.ok(!w.document.querySelector('#pf-slot .pf-video-link'));
  click(w, b); await flush();
  const m = $(w, 'pf-modal');
  assert.ok(m);
  const first = m.querySelector('.pf-modal').firstElementChild;
  assert.equal(first.textContent, "You're entering this for Sample Brokerage LLC. The client will see it on the load.");
  assert.ok(w.document.querySelector('input[name="pf-payer"]'), 'radios when the picker flag is off');
  assert.equal($(w, 'pf-payer-carrier').disabled, false);

  w = await open(QP_ROW, { staff: true, imp: IMP, ctx: STAFF_CTX, elig: QP_ELIG });
  assert.equal($(w, 'pf-open').textContent, '⚡ Waive QP fee (for client)');
  click(w, $(w, 'pf-open')); await flush();
  assert.match($(w, 'pf-modal').textContent, /You're entering this for this client\. The client will see it on the load\./);

  w = await open(QP_ROW, { staff: true, imp: IMP, ctx: Object.assign({}, STAFF_CTX, { fee_pick_enabled: true }), elig: QP_ELIG });
  assert.equal($(w, 'pf-open').textContent, '⚡ Change QP fee (for client)');
  click(w, $(w, 'pf-open')); await flush();
  assert.ok($(w, 'pf-fee'), 'staff get the picker when the flag is on, whatever the boxes');

  w = await open({}, { staff: true, imp: IMP, ctx: Object.assign({}, CTX, { staff: false }) });
  assert.ok(!$(w, 'pf-open'), 'impersonating without server staff: hidden as today');
  w = await open({}, { ctx: Object.assign({}, CTX, { staff: false }) });
  assert.doesNotMatch($(w, 'pf-open').textContent, /for client/);
  click(w, $(w, 'pf-open')); await flush();
  assert.doesNotMatch($(w, 'pf-modal').textContent, /entering this for/);
});

test('staff popup posts once', async () => {
  const w = await open(ACCT_ROW, { staff: true, imp: IMP, ctx: STAFF_CTX,
    post: { status: 201, body: { ok: true, request: Object.assign({}, REQ, { entered_by: 'staff' }) } } });
  click(w, $(w, 'pf-open')); await flush();
  pick(w, 'carrier'); await flush();
  $(w, 'pf-note').value = 'Client called';
  w.__calls.length = 0;
  click(w, $(w, 'pf-send'));
  click(w, $(w, 'pf-send'));
  await flush();
  const c = w.__calls.filter((x) => /\/pay-change\/requests$/.test(x.url) && x.opts.method === 'POST');
  assert.equal(c.length, 1);
  assert.deepEqual(JSON.parse(c[0].opts.body), { email: 'b@x.com', record_id: '4100000000000000001', payer: 'carrier', broker_note: 'Client called' });
  assert.ok(!$(w, 'pf-modal'));
  assert.match($(w, 'panel').querySelector('.timeline').textContent, /Requested by OperFi/);
});

test('staff entered timeline reads Requested by OperFi', async () => {
  const titles = (w) => [...$(w, 'panel').querySelectorAll('.timeline-title')].map((e) => e.textContent);
  const el = (req) => ({ eligible: false, reason: 'already_requested', kind: req.request_type === 'qp_fee' ? 'quickpay' : 'net30', terms: req.terms_on_file, request: req });
  let w = await open({ pay_change: { status: 'requested' } }, { elig: el(Object.assign({}, REQ, { entered_by: 'staff' })) });
  assert.ok(titles(w).includes('Requested by OperFi · Standard Net 30 → Quick Pay, carrier pays 4%'), titles(w).join('|'));
  assert.ok(!titles(w).some((t) => /^Pay change requested/.test(t)));
  w = await open(QP_ROW, { elig: el(Object.assign({}, WAIVE_REQ, { entered_by: 'staff', status: 'applied', resolved_at: '2026-10-17T16:00:00Z' })) });
  assert.ok(titles(w).includes('Requested by OperFi · QP fee waived: broker covers 2% from reserve'), titles(w).join('|'));
  assert.ok(titles(w).includes('QP fee waiver applied'), 'resolved entry unchanged');
  w = await open({ pay_change: { status: 'requested' } }, { elig: el(Object.assign({}, REQ, { entered_by: 'client' })) });
  assert.ok(titles(w).includes('Pay change requested: Standard Net 30 → Quick Pay, carrier pays 4%'), 'client entries unchanged');
});

test('client without fee_adjust gets radios not picker', async () => {
  const ctx = Object.assign({}, PICK_CTX, { access: { pay_faster: true, fee_adjust: false } });
  let w = await open({}, { ctx });
  assert.equal($(w, 'pf-open').textContent, '⚡ Pay carrier faster');
  click(w, $(w, 'pf-open')); await flush();
  assert.ok(!$(w, 'pf-fee'), 'no picker');
  assert.ok(w.document.querySelector('input[name="pf-payer"]'), 'payer radios');
  w = await open(QP_ROW, { ctx, elig: QP_ELIG });
  assert.equal($(w, 'pf-open').textContent, '⚡ Waive QP fee');
  click(w, $(w, 'pf-open')); await flush();
  assert.ok(!$(w, 'pf-fee'));
  assert.match($(w, 'pf-modal').textContent, /Waive the quick pay fee on this load/);
});

test('quickpay without fee_adjust and without waive_enabled shows no button', async () => {
  const ctx = Object.assign({}, PICK_CTX, { waive_enabled: false, access: { pay_faster: true, fee_adjust: false } });
  let w = await open(QP_ROW, { ctx, elig: QP_ELIG });
  assert.ok(!$(w, 'pf-open'));
  w = await open(QP_ROW, { ctx: Object.assign({}, CTX, { waive_enabled: false }), elig: QP_ELIG });
  assert.ok(!$(w, 'pf-open'), 'no picker, no waive: nothing to offer');
  w = await open(QP_ROW, { ctx: Object.assign({}, PICK_CTX, { waive_enabled: false }), elig: QP_ELIG });
  assert.match($(w, 'pf-open').textContent, /Change QP fee/, 'picker alone still covers quick pay for fee_adjust');
});
