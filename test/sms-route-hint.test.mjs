import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

// The staff-facing "where does their reply show up?" hint. Every OperFi client keeps the number we
// first text them from, so which line a client is on — and whether their replies reach a Slack
// thread or a one-way email forward — is not something staff can infer. This says it out loud.
//
// The hint is duplicated in two widgets on purpose (a shared script would cost a ?v= bump across
// three embeds for one line of text). These tests run against BOTH copies, so they can't drift.

const uw = fs.readFileSync(path.resolve('underwriting-review.html'), 'utf8');
const sales = fs.readFileSync(path.resolve('sales-pipeline.html'), 'utf8');

function hintFrom(html) {
  const src = html.match(/function smsRouteHint\(sms\) \{[\s\S]*?\n\}/);
  assert.ok(src, 'smsRouteHint not found');
  return new Function(`${src[0]}; return smsRouteHint;`)();
}

const CASES = [
  ['underwriting-review', hintFrom(uw)],
  ['sales-pipeline', hintFrom(sales)],
];

for (const [name, smsRouteHint] of CASES) {
  test(`${name}: a live carrier names the line and the Slack channel`, () => {
    assert.equal(
      smsRouteHint({ from: '+16826889619', line: 'carrier', inbound: 'slack', live: true, channel: '#texts-carrier-ops', replyTo: '' }),
      'Texts send from (682) 688-9619 · replies land in #texts-carrier-ops');
  });

  test(`${name}: a broker pre-cutover is warned that replies reach NOBODY`, () => {
    // The state that only exists for brokers right now: correct permanent number, but a reply goes
    // nowhere. Naming a channel or an inbox would leave staff waiting on an answer that can't come.
    const out = smsRouteHint({ from: '+16829002324', line: 'broker', inbound: 'none', live: false, channel: '', replyTo: '' });
    assert.equal(out, 'Texts send from (682) 900-2324 · ⚠ replies do NOT reach us yet — call or email instead');
    assert.doesNotMatch(out, /#texts/);
  });

  test(`${name}: off the relay entirely, replies are named as the inbox`, () => {
    const out = smsRouteHint({ from: '+15550000000', line: 'broker', inbound: 'email', live: false, channel: '', replyTo: 'onboarding@operfi.com' });
    assert.equal(out, 'Texts send from (555) 000-0000 · replies come to onboarding@operfi.com');
    assert.doesNotMatch(out, /#texts/);
  });

  test(`${name}: a block without 'inbound' still reads correctly off 'live'`, () => {
    // Back-compat: a deployed widget may briefly out-run the backend that adds the field.
    assert.match(smsRouteHint({ from: '+16826889619', live: true, channel: '#texts-carrier-ops' }),
      /replies land in #texts-carrier-ops/);
    assert.match(smsRouteHint({ from: '+15550000000', live: false, replyTo: 'onboarding@operfi.com' }),
      /replies come to onboarding@operfi\.com/);
  });

  test(`${name}: no block means no hint, so an older backend renders today's UI`, () => {
    assert.equal(smsRouteHint(null), '');
    assert.equal(smsRouteHint(undefined), '');
    assert.equal(smsRouteHint({}), '');
    assert.equal(smsRouteHint({ from: '' }), '');
  });

  test(`${name}: slack but channel-less still degrades to the inbox wording`, () => {
    const out = smsRouteHint({ from: '+16826889619', inbound: 'slack', live: true, channel: '' });
    assert.match(out, /replies come to the onboarding inbox/);
  });

  test(`${name}: an unexpected number shape is shown verbatim, not mangled`, () => {
    assert.match(smsRouteHint({ from: '+448081570000', live: false }), /\+448081570000/);
  });
}

test('both widgets read the sms block off /application-by-usdot', () => {
  // The hint is only as good as the field feeding it; wiring it into one widget and not the other
  // is a silent half-ship.
  assert.match(uw, /sms: j\.sms \|\| null/);
  assert.match(sales, /sms: j\.sms \|\| null/);
});

test('the underwriting widget exposes the hint and renders it near the nudge buttons', () => {
  const dom = new JSDOM(uw, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  assert.equal(typeof w.OFUW.smsRouteHint, 'function');
  const el = w.document.getElementById('smsRoute');
  assert.ok(el, 'smsRoute element missing');
  assert.equal(el.style.display, 'none', 'must start hidden so it never shows an empty line');
});
