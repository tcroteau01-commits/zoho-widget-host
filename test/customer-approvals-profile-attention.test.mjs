// ATTNPROF1 (John, 2026-10-18): the Needs Attention items and Mark reviewed on
// the full profile, not only in the detail pane. Same data (the list's one bulk
// fetch), same team-wide clear (POST /customer-events/clear).
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');
const profileJs = fs.readFileSync(path.resolve('customer-profile.js'), 'utf8');
function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

const PAYLOAD = {
  submission_id: '4455', customer_name: 'KSI PROFESSIONAL', broker: 'KANE Freight',
  status: 'Approved', engine: null, identity: null, summary: null, fv_debtor: null,
  fv_candidates: [], priors: [], priors_unavailable: false, notes: [], activity: [],
  contacts: {}, submitted: { company_name: 'KSI PROFESSIONAL', documents: [] },
  can_act: true
};

const EVENTS = [
  { id: 'e1', subject_id: '4455', kind: 'reference_completed',
    summary: 'Trade reference 3 completed: KSI Professional llc', at: '2026-10-07T14:18:00+00:00' },
  { id: 'e2', subject_id: '4455', kind: 'credit_app_received',
    summary: 'Application received: KSI Professional llc', at: '2026-10-07T13:51:00+00:00' }
];

async function boot(opts) {
  opts = opts || {};
  const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
                              url: 'https://x.github.io/' }).window;
  await wait(50);
  w.eval(profileJs);
  w.allClients = opts.staff !== false;
  w.brokerEmail = 'staff@operfi.com';
  const evs = opts.events || EVENTS;
  w.applyCustomerEventsPayload({ events: evs, total: evs.length ? 1 : 0,
                                 counts: evs.length ? { '4455': evs.length } : {} });
  const calls = [];
  w.fetch = function(url, o) {
    calls.push({ url: url, opts: o || {} });
    if (/\/customer-events\/clear/.test(url)) {
      return Promise.resolve(opts.clearReply || { status: 200,
        text: function() { return Promise.resolve('{"count":2}'); } });
    }
    return Promise.resolve({ ok: false, status: 404 });
  };
  w.renderProfile({ ID: '4455' }, PAYLOAD);
  return { w: w, d: w.document, calls: calls };
}

test('staff see every unread item on the profile, with Mark reviewed', async () => {
  const { d } = await boot();
  const box = d.getElementById('cp-attn');
  assert.ok(box, 'Needs Attention box on the profile');
  assert.ok(box.closest('.cp-header'), 'inside the header, beside the decision controls');
  assert.equal(box.querySelectorAll('.cp-attn-event').length, 2);
  assert.ok(box.textContent.includes('Trade reference 3 completed'));
  assert.ok(box.textContent.includes('Application received'));
  assert.ok(box.querySelector('[data-attn-clear]'));
});

test('opening the profile clears nothing', async () => {
  const { calls } = await boot();
  assert.equal(calls.filter(function(c) { return /customer-events/.test(c.url); }).length, 0);
});

test('nothing unread: no box', async () => {
  const { d } = await boot({ events: [] });
  assert.equal(d.getElementById('cp-attn'), null);
});

test('a non-staff viewer never gets the box', async () => {
  const { d } = await boot({ staff: false });
  assert.equal(d.getElementById('cp-attn'), null);
});

test('Mark reviewed clears team-wide, drops the box, and keeps the profile open', async () => {
  const { w, d, calls } = await boot();
  d.querySelector('[data-attn-clear]').click();
  await wait(30);
  const clears = calls.filter(function(c) { return /\/customer-events\/clear/.test(c.url); });
  assert.equal(clears.length, 1);
  assert.deepEqual(JSON.parse(clears[0].opts.body),
                   { email: 'staff@operfi.com', subject_id: '4455' });
  assert.equal(d.getElementById('cp-attn'), null, 'box removed');
  assert.equal(w.hasUnreadEvents({ ID: '4455' }), false, 'local state cleared');
  assert.equal(d.getElementById('attn-bell'), null, 'the bell goes quiet');
  assert.ok(d.querySelector('.cp-header'), 'profile still on screen');
  assert.equal(d.getElementById('panel').classList.contains('show'), false, 'no drawer reopened behind it');
});

test('a refused clear keeps the box and says why', async () => {
  const { d } = await boot({ clearReply: { status: 403,
    text: function() { return Promise.resolve('{"error":"Not allowed"}'); } } });
  const btn = d.querySelector('[data-attn-clear]');
  btn.click();
  await wait(30);
  assert.ok(d.getElementById('cp-attn'), 'box stays');
  assert.equal(d.getElementById('cp-attn-msg').textContent, 'Not allowed');
  assert.equal(btn.disabled, false);
});
