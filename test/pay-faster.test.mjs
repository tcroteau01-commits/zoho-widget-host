import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pay-faster.js'), 'utf8');
const win = {};
new Function('window', src)(win);
const PF = win.PayFaster;

const DASH = /[–—]/;
const RES_OK = { cash: 1250, status: 'ok' };

test('kindForTerms table', () => {
  const k = PF.kindForTerms;
  assert.equal(k('Standard Net 30'), 'net30');
  assert.equal(k('Standard Net 30 - LOR'), 'net30');
  assert.equal(k('Factoring Company'), 'factored');
  assert.equal(k('Factoring Company - RTS Financial'), 'factored');
  assert.equal(k('Quick Pay'), 'quickpay');
  assert.equal(k('Quick Pay - LOR'), 'quickpay');
  assert.equal(k('Factoring Company - Quick Pay'), 'quickpay');
  assert.equal(k('Factoring Company - Quick Pay - RTS Financial'), 'quickpay');
  assert.equal(k('No Invoice - 180 Days'), null);
  assert.equal(k('Unknown - 180 Days'), null);
  assert.equal(k('Payment Change'), null);
  assert.equal(k(''), null);
  assert.equal(k(null), null);
  assert.equal(k(undefined), null);
});

test('parseFeePct variants', () => {
  const p = PF.parseFeePct;
  assert.equal(p('4'), 4);
  assert.equal(p('4.00'), 4);
  assert.equal(p('4%'), 4);
  assert.equal(p(4), 4);
  assert.equal(p('1.5'), 1.5);
  assert.equal(p(null), null);
  assert.equal(p(undefined), null);
  assert.equal(p(''), null);
  assert.equal(p('abc'), null);
});

test('carrier pays sample', () => {
  assert.deepEqual(PF.computeFees(2000, 4, 'carrier'),
    { carrierFee: 80, feeTotal: 80, brokerShare: 40, operfiShare: 40, reserveCharge: 0, payeeReceives: 1920 });
});

test('broker pays sample', () => {
  assert.deepEqual(PF.computeFees(2000, 4, 'broker'),
    { carrierFee: 0, feeTotal: 40, brokerShare: -40, operfiShare: 40, reserveCharge: 40, payeeReceives: 2000 });
});

test('parity vector 1234.57 @ 3.5', () => {
  const f = PF.computeFees(1234.57, 3.5, 'carrier');
  assert.equal(f.brokerShare, 18.52);
  assert.equal(f.operfiShare, 24.69);
  assert.equal(f.feeTotal, 43.21);
  assert.equal(f.payeeReceives, 1191.36);
});

test('tie vector rounds half up', () => {
  assert.equal(PF.computeFees(1.25, 2, 'broker').operfiShare, 0.03);
});

test('below floor returns error', () => {
  assert.deepEqual(PF.computeFees(2000, 1.5, 'carrier'), { error: 'carrier_fee_unavailable' });
  assert.deepEqual(PF.computeFees(2000, null, 'carrier'), { error: 'carrier_fee_unavailable' });
  assert.equal(PF.computeFees(2000, 1.5, 'broker').operfiShare, 40);
});

test('marginEffect and money', () => {
  assert.equal(PF.marginEffect(PF.computeFees(2000, 4, 'carrier'), 'carrier'), 40);
  assert.equal(PF.marginEffect(PF.computeFees(2000, 4, 'broker'), 'broker'), -40);
  assert.equal(PF.money(1920), '$1,920.00');
  assert.equal(PF.OPERFI_SHARE_PCT, 2);
});

test('summaryHtml quickpay always shows split', () => {
  const h = PF.summaryHtml({ kind: 'quickpay', toggled: false, payer: 'carrier',
    fees: PF.computeFees(2000, 4, 'carrier'), feePct: 4, carrierRate: 2000 });
  assert.match(h, /You earn \(2%\)/);
  assert.match(h, /\+\$40\.00/);
  assert.match(h, /\$1,920\.00/);
});

test('summaryHtml net30 untoggled shows only Net 30', () => {
  const h = PF.summaryHtml({ kind: 'net30', toggled: false, feePct: 4, carrierRate: 2000 });
  assert.match(h, /Net 30/);
  assert.doesNotMatch(h, /You earn/);
  assert.doesNotMatch(h, /Quick Pay/);
});

test('summaryHtml toggled broker pays and factored short pay', () => {
  const b = PF.summaryHtml({ kind: 'net30', toggled: true, payer: 'broker',
    fees: PF.computeFees(2000, 4, 'broker'), feePct: 4, carrierRate: 2000 });
  assert.match(b, /Quick Pay · one-off/);
  assert.match(b, /Charged to your reserve/);
  assert.match(b, /-\$40\.00/);
  const f = PF.summaryHtml({ kind: 'factored', toggled: true, payer: 'carrier', factorName: 'RTS <Financial>',
    fees: PF.computeFees(2000, 4, 'carrier'), feePct: 4, carrierRate: 2000 });
  assert.match(f, /Short pay to factor/);
  assert.match(f, /RTS &lt;Financial&gt;/);
  assert.match(f, /Factor receives/);
});

// PAYCHGPICK2: explicit "Who pays the quick pay fee?" (whoPaysState replaces optionsHtml,
// waiveState and feePickerHtml).
const WP = { kind: 'net30', rate: 2000, payer: null, feeAdjust: false, savedPct: '4', reserve: RES_OK, factorName: '', trained: true };
const wp = (o) => PF.whoPaysState(Object.assign({}, WP, o));
const radio = (h, v) => (h.match(new RegExp('<input[^>]*value="' + v + '"[^>]*>')) || [null])[0];

test('whoPaysState shows both options, nothing picked, blocked', () => {
  const r = wp({});
  assert.match(r.html, /Who pays the quick pay fee\?/);
  assert.match(r.html, /The carrier pays/);
  assert.match(r.html, /I'll cover the fee/);
  assert.ok(radio(r.html, 'carrier') && radio(r.html, 'broker'));
  assert.doesNotMatch(r.html, /checked/);
  assert.equal(r.blocked, true);
  assert.equal(r.payer, null);
  assert.doesNotMatch(r.html, /id="pf-fee"/);
});

test('whoPaysState carrier pays without fee adjust uses the saved fee', () => {
  const r = wp({ payer: 'carrier' });
  assert.equal(r.blocked, false);
  assert.match(radio(r.html, 'carrier'), /checked/);
  assert.doesNotMatch(r.html, /<select/);
  assert.match(r.html, /\$80\.00 deducted from the carrier's payment/);
  assert.match(r.html, /You earn \$40\.00 · OperFi earns \$40\.00/);
  assert.match(r.html, /Carrier receives \$1,920\.00/);
  assert.doesNotMatch(r.html, /from your reserve/);
  assert.doesNotMatch(r.html, DASH);
});

test('whoPaysState I will cover the fee', () => {
  const r = wp({ payer: 'broker' });
  assert.equal(r.blocked, false);
  assert.match(r.html, /Carrier receives the full \$2,000\.00/);
  assert.match(r.html, /\$40\.00 \(OperFi's 2%\) is charged to your reserve/);
  assert.match(r.html, /Your reserve balance \$1,250\.00 covers this fee\. Balance after: \$1,210\.00\./);
  const un = wp({ payer: 'broker', reserve: { cash: null, status: 'unavailable' } });
  assert.match(un.html, /We couldn't check your reserve balance right now/);
  assert.equal(un.blocked, false);
});

test('whoPaysState short reserve disables I will cover and drops a stale pick', () => {
  const r = wp({ payer: 'broker', reserve: { cash: 25, status: 'ok' } });
  assert.match(radio(r.html, 'broker'), /disabled/);
  assert.doesNotMatch(radio(r.html, 'carrier'), /disabled/);
  assert.match(r.html, /doesn't cover the \$40\.00 fee/);
  assert.equal(r.payer, null);
  assert.equal(r.blocked, true);
});

test('whoPaysState factored wording and short pay warning', () => {
  const c = wp({ kind: 'factored', factorName: 'RTS Financial', payer: 'carrier' });
  assert.match(c.html, /Payment still goes to RTS Financial, just sooner\. Who pays the quick pay fee\?/);
  assert.match(c.html, /\$80\.00 deducted from the factor's payment/);
  assert.match(c.html, /RTS Financial receives \$1,920\.00/);
  assert.match(c.html, /RTS Financial will receive \$80\.00 less than its invoice/);
  const b = wp({ kind: 'factored', factorName: 'RTS Financial', payer: 'broker' });
  assert.match(b.html, /RTS Financial receives the full \$2,000\.00/);
  assert.doesNotMatch(b.html, /less than its invoice/);
});

test('whoPaysState saved fee not set up disables carrier pays without fee adjust', () => {
  for (const savedPct of [null, '1.5']) {
    const r = wp({ savedPct, payer: 'carrier' });
    assert.match(r.html, /Your quick pay fee isn't set up\. Contact OperFi\./);
    assert.match(radio(r.html, 'carrier'), /disabled/);
    assert.equal(r.blocked, true);
  }
});

test('whoPaysState untrained is locked', () => {
  const r = wp({ trained: false, videoId: 'vid1', payer: 'carrier' });
  assert.match(r.html, /Watch the 2-minute Pay Faster video to unlock/);
  assert.match(r.html, /data-video-id="vid1"/);
  assert.equal(r.blocked, true);
});

test('whoPaysState no rate shows no dollar figures and blocks', () => {
  for (const rate of [0, '', 'abc', null]) {
    const r = wp({ rate, payer: 'broker' });
    assert.match(r.html, /Enter the carrier rate to see the fee\./);
    assert.doesNotMatch(r.html, /\$/);
    assert.equal(r.blocked, true, String(rate));
  }
});

test('whoPaysState fee adjust: whole-number select 5..1 plus the saved fee', () => {
  const r = wp({ feeAdjust: true, payer: 'carrier', pct: '4' });
  const sel = r.html.match(/<select[^>]*id="pf-fee"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(sel, 'select rendered');
  const opts = [...sel[1].matchAll(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g)].map((m) => [m[1], !!m[2], m[3]]);
  assert.deepEqual(opts.map((o) => o[0]), ['5', '4', '3', '2', '1']);
  assert.deepEqual(opts.map((o) => o[2]), ['5%', '4% (your standard)', '3%', '2%', '1%']);
  assert.deepEqual(opts.filter((o) => o[1]).map((o) => o[0]), ['4']);
  assert.doesNotMatch(r.html, /type="number"/);
  assert.doesNotMatch(sel[1], /value="0"/);
  assert.equal(r.blocked, false);
  const s = wp({ feeAdjust: true, payer: 'carrier', pct: '3.5', savedPct: '3.5' }).html;
  assert.match(s, /<option value="4">4%<\/option><option value="3\.5" selected>3\.5% \(your standard\)<\/option><option value="3">/);
  const six = wp({ feeAdjust: true, payer: 'carrier', pct: '6', savedPct: '6' }).html;
  assert.match(six, /<option value="6" selected>6% \(your standard\)<\/option><option value="5">/);
  // The select only shows under "The carrier pays".
  assert.doesNotMatch(wp({ feeAdjust: true, payer: 'broker', pct: '4' }).html, /<select/);
  assert.doesNotMatch(wp({ feeAdjust: true, payer: null, pct: '4' }).html, /<select/);
});

test('whoPaysState fee adjust 1%: split lines and reserve check', () => {
  const r = wp({ feeAdjust: true, payer: 'carrier', pct: '1' });
  assert.match(r.html, /\$20\.00 deducted from the carrier's payment/);
  assert.match(r.html, /You earn \$0\.00 · OperFi earns \$40\.00/);
  assert.match(r.html, /Carrier receives \$1,980\.00/);
  assert.match(r.html, /You cover the other 1% \(\$20\.00\) from your reserve/);
  assert.match(r.html, /Your reserve balance \$1,250\.00 covers this fee\. Balance after: \$1,230\.00\./);
  assert.equal(r.blocked, false);
  assert.equal(wp({ feeAdjust: true, payer: 'carrier', pct: '1', reserve: { cash: 5, status: 'ok' } }).blocked, true);
  assert.equal(wp({ feeAdjust: true, payer: 'carrier', pct: '1', reserve: { status: 'unavailable' } }).blocked, false);
  const five = wp({ feeAdjust: true, payer: 'carrier', pct: '5' });
  assert.match(five.html, /\$100\.00 deducted from the carrier's payment/);
  assert.match(five.html, /You earn \$60\.00 · OperFi earns \$40\.00/);
  assert.doesNotMatch(five.html, /from your reserve/);
});

test('whoPaysState fee adjust refuses a value that is not a choice', () => {
  for (const pct of ['', 'abc', '5.1', '-1', '0.3', '1.25', '4.5', '0'])
    assert.equal(wp({ feeAdjust: true, payer: 'carrier', pct }).blocked, true, pct);
});

test('whoPaysState quickpay: fee adjust offers both, saved fee is no change', () => {
  const q = { kind: 'quickpay', feeAdjust: true };
  const at = wp(Object.assign({ payer: 'carrier', pct: '4' }, q));
  assert.equal(at.blocked, true);
  assert.match(at.html, /That's your saved quick pay fee\. Pick a different fee to change it on this load\./);
  assert.equal(wp(Object.assign({ payer: 'carrier', pct: '3' }, q)).blocked, false);
  const b = wp(Object.assign({ payer: 'broker', pct: '4' }, q));
  assert.equal(b.blocked, false);
  assert.match(b.html, /\$40\.00 \(OperFi's 2%\) is charged to your reserve/);
});

test('whoPaysState quickpay without fee adjust offers only I will cover the fee', () => {
  const r = wp({ kind: 'quickpay', payer: null });
  assert.ok(!radio(r.html, 'carrier'));
  assert.ok(radio(r.html, 'broker'));
  assert.equal(r.blocked, true);
  const b = wp({ kind: 'quickpay', payer: 'broker', factorName: 'Example <Capital>' });
  assert.equal(b.blocked, false);
  assert.match(b.html, /Example &lt;Capital&gt; receives the full \$2,000\.00/);
  const c = wp({ kind: 'quickpay', payer: 'carrier' });
  assert.equal(c.payer, null, 'carrier is not an option here');
  assert.equal(c.blocked, true);
  assert.equal(wp({ kind: 'quickpay', payer: 'broker', reserve: { cash: 39.99, status: 'ok' } }).blocked, true);
  assert.equal(wp({ kind: 'quickpay', payer: 'broker', reserve: { cash: 40, status: 'ok' } }).blocked, false);
});

test('feeChoices and defaultFee', () => {
  const v = (s) => PF.feeChoices(s).map((c) => c.value + '|' + c.label);
  assert.deepEqual(v('4'), ['5|5%', '4|4% (your standard)', '3|3%', '2|2%', '1|1%']);
  assert.deepEqual(v(null), ['5|5%', '4|4%', '3|3%', '2|2%', '1|1%']);
  assert.deepEqual(v('1.5'), ['5|5%', '4|4%', '3|3%', '2|2%', '1.5|1.5% (your standard)', '1|1%']);
  assert.deepEqual(v('0'), ['5|5%', '4|4%', '3|3%', '2|2%', '1|1%']);
  assert.equal(PF.defaultFee('4'), '4');
  assert.equal(PF.defaultFee('4.00'), '4');
  assert.equal(PF.defaultFee('6'), '6');
  assert.equal(PF.defaultFee('3.5'), '3.5');
  assert.equal(PF.defaultFee('1.5'), '2');
  assert.equal(PF.defaultFee(null), '2');
  assert.equal(PF.defaultFee('abc'), '2');
});

test('refusalMessage maps API codes', () => {
  const m = PF.refusalMessage;
  assert.equal(m('not_enabled_for_account'), "Pay Faster isn't turned on for your account. Contact OperFi.");
  assert.equal(m('fee_adjust_not_enabled'), "Changing the quick pay fee isn't turned on for your account. Pick 'I'll cover the fee' or your standard fee.");
  assert.equal(m('bad_fee_pct'), 'Pick a fee of 0% to 5%.');
  assert.equal(m('no_change'), "That's already this carrier's quick pay fee. Nothing to change.");
  assert.equal(m('terms_not_eligible'), "This carrier's payment terms can't be changed here.");
  assert.equal(m('carrier_paid'), 'This carrier has already been paid.');
  assert.equal(m('lookup_failed'), null);
  assert.equal(m(undefined), null);
});

test('no em or en dashes in any html', () => {
  const all = [];
  for (const kind of ['net30', 'factored', 'quickpay'])
    for (const payer of ['carrier', 'broker', null])
      for (const feeAdjust of [true, false])
        for (const pct of ['4', '1', '0'])
          for (const reserve of [RES_OK, { cash: 5, status: 'ok' }, { cash: null, status: 'unavailable' }])
            for (const trained of [true, false])
              all.push(wp({ kind, payer, feeAdjust, pct, reserve, factorName: 'RTS', trained, videoId: 'v' }).html);
  for (const kind of ['net30', 'factored', 'quickpay'])
    for (const payer of ['carrier', 'broker'])
      for (const toggled of [true, false])
        all.push(PF.summaryHtml({ kind, toggled, payer, fees: PF.computeFees(2000, 4, payer), feePct: 4, factorName: 'RTS', carrierRate: 2000 }));
  for (const c of ['not_enabled_for_account', 'fee_adjust_not_enabled', 'bad_fee_pct', 'no_change', 'terms_not_eligible', 'carrier_paid'])
    all.push(PF.refusalMessage(c));
  for (const h of all) assert.doesNotMatch(h, DASH);
  assert.doesNotMatch(src, DASH);
});

test('computeFeesAt vectors', () => {
  const f = PF.computeFeesAt;
  let r = f(2000, 0);
  assert.deepEqual([r.payer, r.carrierFee, r.feeTotal, r.brokerShare, r.operfiShare, r.reserveCharge, r.payeeReceives], ['broker', 0, 40, -40, 40, 40, 2000]);
  r = f(2000, 1);
  assert.deepEqual([r.payer, r.carrierFee, r.feeTotal, r.brokerShare, r.reserveCharge, r.payeeReceives], ['split', 20, 40, -20, 20, 1980]);
  r = f(1234.57, 1.75);
  assert.deepEqual([r.payer, r.carrierFee, r.operfiShare, r.reserveCharge, r.payeeReceives], ['split', 21.6, 24.69, 3.09, 1212.97]);
  r = f(2000, 5);
  assert.deepEqual([r.payer, r.carrierFee, r.feeTotal, r.brokerShare, r.reserveCharge, r.payeeReceives], ['carrier', 100, 100, 60, 0, 1900]);
  r = f(2000, 2);
  assert.deepEqual([r.payer, r.carrierFee, r.brokerShare, r.reserveCharge], ['carrier', 40, 0, 0]);
  assert.equal(f(2000, null).error, 'bad_fee_pct');
  assert.equal(f(2000, -1).error, 'bad_fee_pct');
  assert.equal(f('abc', 1).error, 'bad_rate');
});

test('computeFees keeps old results and adds carrierFee', () => {
  const c = PF.computeFees(2000, 4, 'carrier');
  assert.equal(c.feeTotal, 80); assert.equal(c.brokerShare, 40); assert.equal(c.carrierFee, 80); assert.equal(c.payeeReceives, 1920);
  const b = PF.computeFees(2000, 4, 'broker');
  assert.equal(b.carrierFee, 0); assert.equal(b.reserveCharge, 40); assert.equal(b.payeeReceives, 2000);
  assert.equal(PF.marginEffect(b, 'carrier'), -40);
  assert.equal(PF.marginEffect({ error: 'x' }), 0);
});

test('factorNameForTerms table', () => {
  const n = PF.factorNameForTerms;
  assert.equal(n('Factoring Company - Quick Pay - Example Capital'), 'Example Capital');
  assert.equal(n('Factoring Company - Quick Pay'), 'factor on file');
  assert.equal(n('Factoring Company - Example Capital'), 'Example Capital');
  assert.equal(n('Factoring Company'), '');
  assert.equal(n('Quick Pay'), '');
  assert.equal(n(null), '');
});

test('summaryHtml quickpay broker-paid shows fee waived', () => {
  const h = PF.summaryHtml({ kind: 'quickpay', payer: 'broker', carrierRate: 2000, feePct: '4' });
  assert.match(h, /fee waived/);
  assert.match(h, /\$40\.00/);
  assert.match(h, /you pay 2%/);
  assert.doesNotMatch(h, DASH);
  const c = PF.summaryHtml({ kind: 'quickpay', payer: 'carrier', carrierRate: 2000, feePct: '4' });
  assert.doesNotMatch(c, /fee waived/);
});

// PAYCHGPICK2: whole numbers 0 to 5, or the saved fee as is.
test('feeValid table', () => {
  const v = PF.feeValid;
  for (const x of ['0', '1', '2', '3', '4', '5', '4.0', '4.00', 2, '-0', '0.00']) assert.equal(v(x, '4'), true, String(x));
  for (const x of ['5.1', '-1', '', 'abc', '0.3', '5.25', '0.25', '1.25', '1.5', '4.75', '5.5', '6', null, undefined]) assert.equal(v(x, '4'), false, String(x));
  assert.equal(v('3.3', '4'), false);
  assert.equal(v('3.3', '3.3'), true);
  assert.equal(v('6', '6'), true);
  assert.equal(v('3.5', '3.5'), true);
  assert.equal(v('3.3', null), false);
  assert.equal(v('1.0000000000001', '4'), false);
});

test('summaryHtml split shows carrier part, reserve part and OperFi 2%', () => {
  const h = PF.summaryHtml({ kind: 'net30', toggled: true, pickPct: '1', carrierRate: 2000 });
  assert.match(h, /carrier pays 1%/);
  assert.match(h, /Carrier is charged \(1%\)<b>\$20\.00/);
  assert.match(h, /Charged to your reserve \(1%\)<b>-\$20\.00/);
  assert.match(h, /OperFi earns \(2%\)<b>\$40\.00/);
  assert.match(h, /Carrier receives<b>\$1,980\.00/);
  assert.doesNotMatch(h, DASH);
  const c = PF.summaryHtml({ kind: 'net30', toggled: true, pickPct: '3', carrierRate: 2000 });
  assert.match(c, /You earn \(1%\)<b>\+\$20\.00/);
  assert.match(c, /Carrier is charged<b>\$60\.00/);
  const z = PF.summaryHtml({ kind: 'quickpay', toggled: true, pickPct: '0', carrierRate: 2000 });
  assert.match(z, /fee waived/);
  assert.match(z, /Charged to your reserve<b>-\$40\.00/);
  const q = PF.summaryHtml({ kind: 'quickpay', toggled: true, pickPct: '3', carrierRate: 2000 });
  assert.match(q, /fee changed to 3%/);
  const fs = PF.summaryHtml({ kind: 'factored', toggled: true, pickPct: '1', carrierRate: 2000, factorName: 'Example Capital' });
  assert.match(fs, /Short pay to factor/);
  assert.match(fs, /Deducted from factor payment \(1%\)/);
});
