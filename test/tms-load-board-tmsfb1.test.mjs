// TMSFB1: overdue-POD banner, nudge/dismiss, delete draft (slide-out + bulk).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../tms-load-board.html', import.meta.url), 'utf8');

const PAYLOAD = {
  pod_alert_hours: 48,
  count: 4,
  loads: [
    { id: 'l1', load_number: 'ACME-1001', status: 'Delivered', customer_name: 'Big Shipper',
      carrier_name: 'ROADWAY', lane: 'A → B', invoice_amount: 2000, margin: 500,
      delivered_at: '01-Nov-2026 09:00:00', hours_since_delivered: 53.4, pod_nudged_at: '',
      pod_overdue: true },
    { id: 'l2', load_number: 'ACME-1002', status: 'Delivered', customer_name: 'Small Co',
      carrier_name: 'MIDWEST <b>', lane: 'C → D', invoice_amount: 1000, margin: 100,
      delivered_at: '30-Oct-2026 09:00:00', hours_since_delivered: 101, pod_nudged_at: '02-Nov-2026 15:30:00',
      pod_overdue: true },
    { id: 'l3', load_number: 'ACME-1003', status: 'Delivered', customer_name: 'Fresh',
      carrier_name: 'QUICK', lane: 'E → F', invoice_amount: 900, margin: 90,
      hours_since_delivered: 3, pod_overdue: false },
    { id: 'l4', load_number: 'ACME-1004', status: 'Draft', customer_name: 'Draft Co',
      carrier_name: '', lane: 'G → H', invoice_amount: 0, margin: 0 },
  ],
};

function makeWidget(opts) {
  opts = opts || {};
  const posts = [];
  let gets = 0;
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/tms-load-board.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.confirm = () => { throw new Error('native confirm() must not be used'); };
      window.fetch = function (url, init) {
        if (init && init.method === 'POST') {
          const body = JSON.parse(init.body);
          posts.push({ url: String(url), body });
          if (/\/tms-pod\/nudge$/.test(url)) {
            return Promise.resolve({ json: () => Promise.resolve({ sent: body.load_ids.slice(0, 1),
              skipped: body.load_ids.slice(1).map((id) => ({ id, reason: 'nudged in the last 10 minutes' })) }) });
          }
          if (/\/tms-load\/delete$/.test(url)) {
            const ok = !(opts.failDelete || []).includes(body.load_id);
            return Promise.resolve({ ok, json: () => Promise.resolve(ok ? { ok: true } : { ok: false, error: 'Only drafts can be deleted' }) });
          }
          return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
        }
        gets++;
        return Promise.resolve({ json: () => Promise.resolve(JSON.parse(JSON.stringify(opts.payload || PAYLOAD))) });
      };
    },
  });
  dom.window.brokerEmail = 'b@op.com';
  return { window: dom.window, posts, gets: () => gets };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

test('banner shows when any row is pod_overdue, with count and threshold', () => {
  const { window } = makeWidget();
  window.renderBoard(JSON.parse(JSON.stringify(PAYLOAD)));
  const b = window.document.getElementById('pod-banner');
  assert.equal(b.classList.contains('hidden'), false);
  assert.match(b.textContent, /2 delivered loads still need paperwork \(over 48h\)/);
  // collapsed by default; expands on click
  assert.ok(window.document.getElementById('pod-list').classList.contains('hidden'));
  window.document.getElementById('pod-toggle').click();
  const rows = window.document.querySelectorAll('#pod-list .pod-row');
  assert.equal(rows.length, 2, 'only the overdue rows are listed');
  assert.match(rows[0].textContent, /ACME-1001/);
  assert.match(rows[0].textContent, /ROADWAY/);
  assert.match(rows[0].textContent, /delivered 53h ago/);
  assert.match(rows[0].textContent, /not nudged yet/);
  assert.match(rows[1].textContent, /delivered 4d ago/);
  assert.match(rows[1].textContent, /last nudged 02-Nov-2026 15:30/);
  // carrier name is escaped, not parsed as markup
  assert.equal(rows[1].querySelector('b'), null);
  assert.match(rows[1].textContent, /MIDWEST <b>/);
});

test('singular wording for one overdue load', () => {
  const { window } = makeWidget();
  const p = JSON.parse(JSON.stringify(PAYLOAD));
  p.loads[1].pod_overdue = false;
  p.pod_alert_hours = 24;
  window.renderBoard(p);
  assert.match(window.document.getElementById('pod-banner').textContent,
    /1 delivered load still needs paperwork \(over 24h\)/);
});

test('no banner (and no crash) when the API has no pod fields', () => {
  const { window } = makeWidget();
  window.renderBoard({ loads: [
    { id: 'x', load_number: 'L-1', status: 'Delivered', customer_name: 'C', lane: '', carrier_name: 'Z', invoice_amount: 1, margin: 1 },
  ] });
  const b = window.document.getElementById('pod-banner');
  assert.ok(b.classList.contains('hidden'));
  assert.equal(b.innerHTML, '');
  assert.equal(window.document.querySelectorAll('#board-body tr').length, 1);
  window.renderBoard(undefined);
  assert.ok(b.classList.contains('hidden'));
});

test('row Nudge posts one id to /tms-pod/nudge and refreshes the board', async () => {
  const { window, posts, gets } = makeWidget();
  window.renderBoard(JSON.parse(JSON.stringify(PAYLOAD)));
  window.document.getElementById('pod-toggle').click();
  window.document.querySelector('.pod-row[data-load-id="l2"] .pod-nudge').click();
  await tick();
  const p = posts.find((x) => /\/tms-pod\/nudge$/.test(x.url));
  assert.deepEqual(p.body, { email: 'b@op.com', load_ids: ['l2'] });
  assert.ok(gets() >= 1, 'board reloaded');
  assert.match(window.document.getElementById('tms-toast').textContent, /1 reminder sent/);
});

test('Nudge all and Dismiss all send every overdue id', async () => {
  const { window, posts } = makeWidget();
  window.renderBoard(JSON.parse(JSON.stringify(PAYLOAD)));
  window.document.getElementById('pod-nudge-all').click();
  await tick();
  let p = posts.find((x) => /\/tms-pod\/nudge$/.test(x.url));
  assert.deepEqual(p.body.load_ids, ['l1', 'l2']);
  assert.match(window.document.getElementById('tms-toast').textContent, /1 reminder sent, 1 skipped/);
  window.renderBoard(JSON.parse(JSON.stringify(PAYLOAD)));
  window.document.getElementById('pod-dismiss-all').click();
  await tick();
  p = posts.find((x) => /\/tms-pod\/dismiss$/.test(x.url));
  assert.deepEqual(p.body, { email: 'b@op.com', load_ids: ['l1', 'l2'] });
});

test('row Open uses the edit bridge to the load detail', () => {
  const { window } = makeWidget();
  window.renderBoard(JSON.parse(JSON.stringify(PAYLOAD)));
  window.document.getElementById('pod-toggle').click();
  window.document.querySelector('.pod-row[data-load-id="l1"] .pod-open').click();
  const t = JSON.parse(window.localStorage.getItem('tmsLoadTarget'));
  assert.equal(t.load_id, 'l1');
  assert.equal(t.mode, 'edit');
});

test('slide-out shows Delete draft only for Draft and Available', () => {
  const { window } = makeWidget();
  for (const [status, shown] of [['Draft', true], ['Available', true], ['Covered', false],
                                 ['Delivered', false], ['Cancelled', false]]) {
    window.renderView({ id: '9', load_number: 'ACME-9', status, stops: [] });
    assert.equal(!!window.document.getElementById('v-delete-draft'), shown, status);
  }
});

test('slide-out Delete draft asks in-page, then posts /tms-load/delete', async () => {
  const { window, posts } = makeWidget();
  window.renderView({ id: '9', load_number: 'ACME-9', status: 'Draft', stops: [] });
  window.document.getElementById('v-delete-draft').click();
  const dlg = window.document.getElementById('tms-confirm');
  assert.ok(dlg, 'in-page confirm shown');
  assert.match(dlg.textContent, /ACME-9/);
  assert.equal(posts.length, 0, 'nothing posted before confirming');
  dlg.querySelector('.cf-ok').click();
  await tick();
  const p = posts.find((x) => /\/tms-load\/delete$/.test(x.url));
  assert.deepEqual(p.body, { email: 'b@op.com', load_id: '9' });
  assert.equal(window.document.getElementById('tms-confirm'), null);
});

test('declining the confirm posts nothing', async () => {
  const { window, posts } = makeWidget();
  window.renderView({ id: '9', load_number: 'ACME-9', status: 'Available', stops: [] });
  window.document.getElementById('v-delete-draft').click();
  window.document.querySelector('#tms-confirm .cf-cancel').click();
  await tick();
  assert.equal(posts.length, 0);
});

test('bulk Delete selected drafts deletes only drafts and reports skipped', async () => {
  const { window, posts } = makeWidget({ failDelete: [] });
  await tick(); // load handler wires the bulk bar
  window.renderBoard(JSON.parse(JSON.stringify(PAYLOAD)));
  window.onRowCheck('l4', true); // Draft
  window.onRowCheck('l1', true); // Delivered: skipped
  assert.ok(window.document.getElementById('bulk-delete'), 'bulk bar has the button');
  window.document.getElementById('bulk-delete').click();
  const dlg = window.document.getElementById('tms-confirm');
  assert.match(dlg.textContent, /Delete 1 draft\?/);
  assert.match(dlg.textContent, /1 selected load is not a draft/);
  dlg.querySelector('.cf-ok').click();
  await tick();
  const dels = posts.filter((x) => /\/tms-load\/delete$/.test(x.url));
  assert.deepEqual(dels.map((d) => d.body.load_id), ['l4']);
  assert.match(window.document.getElementById('tms-toast').textContent, /1 deleted, 1 skipped/);
});

test('bulk delete counts a server refusal as skipped', async () => {
  const p = JSON.parse(JSON.stringify(PAYLOAD));
  p.loads.push({ id: 'l5', load_number: 'ACME-1005', status: 'Available', customer_name: 'X', lane: '', carrier_name: '', invoice_amount: 0, margin: 0 });
  const { window, posts } = makeWidget({ payload: p, failDelete: ['l5'] });
  window.renderBoard(JSON.parse(JSON.stringify(p)));
  window.onRowCheck('l4', true);
  window.onRowCheck('l5', true);
  window.bulkDeleteDrafts();
  window.document.querySelector('#tms-confirm .cf-ok').click();
  await tick();
  assert.equal(posts.filter((x) => /\/tms-load\/delete$/.test(x.url)).length, 2);
  assert.match(window.document.getElementById('tms-toast').textContent, /1 deleted, 1 skipped/);
});

test('bulk delete with no drafts selected posts nothing', async () => {
  const { window, posts } = makeWidget();
  window.renderBoard(JSON.parse(JSON.stringify(PAYLOAD)));
  window.onRowCheck('l1', true);
  await window.bulkDeleteDrafts();
  assert.equal(window.document.getElementById('tms-confirm'), null);
  assert.equal(posts.length, 0);
  assert.match(window.document.getElementById('tms-toast').textContent, /None of the selected/);
});
