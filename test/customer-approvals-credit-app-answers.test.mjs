// BROKERREFVIEW1 (Tom, 2026-10-01) -- the broker sees what their customer's
// trade references answered, and sees their own imported Zoho Forms apps.
// The API decides WHICH answers are shareable (only a trade reference who
// answered on the survey that said so); this file proves the tracker renders
// what it is given, and that an imported app offers no nudge, no report, and
// no "waiting" clock.
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');

function boot() {
  return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
                           url: 'https://x.github.io/' }).window;
}

const ANSWER = {
  customer_since: '2021', net_terms: 'Net 30', credit_limit: '50000', high_credit: '60000',
  last_sale: '2026-09-01', balance: '12000',
  aging: { d0_30: '12000', d31_60: '0', d61_plus: null },
  rating: 5, comments: 'Pays <on> time',
  rep: { name: 'Steve Alvarez', title: 'Controller' },
  answered_at: '2026-10-01T14:00:00',
};

function party(over) {
  return Object.assign({ slot: 'trade1', name: 'Steve Alvarez', company: 'ABC Produce',
                         status: 'completed', waiting_days: 2, stalled: false, answer: null }, over || {});
}

function trackerFixture(w) {
  w.document.body.innerHTML =
    '<div class="panel-section" id="ca-app-section" style="display:none;">' +
      '<span id="ca-app-summary-text"></span>' +
      '<div id="ca-app-rows"></div>' +
      '<div id="ca-app-nudgeall-row" style="display:none;"><button id="ca-app-nudge-all"></button></div>' +
      '<div id="ca-app-supplement"></div>' +
    '</div>';
}

// ── answers ──────────────────────────────────────────────────────────────────

test('a shared trade answer renders under its row', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ answer: ANSWER }));
  assert.match(h, /ca-app-answer/);
  assert.match(h, /Net 30/);
  assert.match(h, /\$50,000/);
  assert.match(h, /\$60,000/);
  assert.match(h, /\$12,000/);
  assert.match(h, /5 \/ 5/);
  assert.match(h, /Steve Alvarez, Controller/);
  assert.match(h, /Customer since/);
});

test('comments are escaped, never injected', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ answer: ANSWER }));
  assert.match(h, /Pays &lt;on&gt; time/);
  assert.doesNotMatch(h, /Pays <on> time/);
});

test('a figure the reference left blank is left out, not shown as $0', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ answer: Object.assign({}, ANSWER, { high_credit: '', last_sale: '' }) }));
  assert.doesNotMatch(h, /High credit/);
  assert.doesNotMatch(h, /Last sale/);
});

test('a non-numeric figure is shown as the reference typed it', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ answer: Object.assign({}, ANSWER, { credit_limit: 'Open account' }) }));
  assert.match(h, /Open account/);
});

test('a completed trade row with no shared answer says where the answer is', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ answer: null }));
  assert.match(h, /Answer on file with OperFi/);
  assert.doesNotMatch(h, /ca-app-answer"/);
});

test('the bank row never claims an answer is withheld from the broker', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ slot: 'bank', company: 'Chase', name: '', answer: null }));
  assert.doesNotMatch(h, /ca-app-answer/);
});

// ── imported Zoho Forms apps ──────────────────────────────────────────────────

test('an imported app row offers no nudge and no report', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ status: 'sent', waiting_days: null, answer: null }), true);
  assert.doesNotMatch(h, /ca-app-nudge/);
  assert.doesNotMatch(h, /ca-app-report-problem/);
  assert.match(h, /No response/);
  assert.doesNotMatch(h, /Waiting/);
});

test('an imported app renders with its own summary and no nudge-all or supplement ask', () => {
  const w = boot();
  trackerFixture(w);
  w.renderCreditAppSection({ ID: 'sub_1' }, {
    status: 'references_pending', legacy: true, supplement_requests: [],
    parties: [
      party({ slot: 'customer', name: 'Dana', company: 'ACME' }),
      party({ slot: 'trade1' }),
      party({ slot: 'trade2', status: 'sent', waiting_days: null }),
      party({ slot: 'trade3', status: 'sent', waiting_days: null }),
    ],
  });
  const doc = w.document;
  assert.equal(doc.getElementById('ca-app-section').style.display, '');
  assert.match(doc.getElementById('ca-app-summary-text').textContent, /previous credit application form/);
  assert.equal(doc.getElementById('ca-app-nudgeall-row').style.display, 'none');
  assert.equal(doc.getElementById('ca-app-supplement').innerHTML, '');
  assert.equal(doc.querySelectorAll('.ca-app-nudge').length, 0);
});

test('a new app still gets nudges', () => {
  const w = boot();
  const h = w.caAppRowHtml(party({ status: 'sent', waiting_days: 3 }), false);
  assert.match(h, /ca-app-nudge/);
});
