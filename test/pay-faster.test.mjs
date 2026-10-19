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
    { feeTotal: 80, brokerShare: 40, operfiShare: 40, reserveCharge: 0, payeeReceives: 1920 });
});

test('broker pays sample', () => {
  assert.deepEqual(PF.computeFees(2000, 4, 'broker'),
    { feeTotal: 40, brokerShare: -40, operfiShare: 40, reserveCharge: 40, payeeReceives: 2000 });
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

test('optionsHtml reserve insufficient disables broker option', () => {
  const h = PF.optionsHtml({ kind: 'net30', payer: 'carrier', rate: 2000, feePct: 4,
    reserve: { cash: 25, status: 'ok' }, trained: true });
  assert.match(h, /doesn't cover the \$40\.00 fee/);
  assert.match(h, /\$25\.00/);
  assert.match(h, /<input[^>]*value="broker"[^>]*disabled/);
  assert.doesNotMatch(h, /<input[^>]*value="carrier"[^>]*disabled/);
});

test('optionsHtml reserve ok and unavailable', () => {
  const ok = PF.optionsHtml({ kind: 'net30', payer: 'broker', rate: 2000, feePct: 4, reserve: RES_OK, trained: true });
  assert.match(ok, /Your reserve balance \$1,250\.00 covers this fee\. Balance after: \$1,210\.00\./);
  const un = PF.optionsHtml({ kind: 'net30', payer: 'broker', rate: 2000, feePct: 4,
    reserve: { cash: null, status: 'unavailable' }, trained: true });
  assert.match(un, /We couldn't check your reserve balance right now/);
  assert.doesNotMatch(un, /<input[^>]*value="broker"[^>]*disabled/);
});

test('optionsHtml factored carrier pays has short pay warning', () => {
  const h = PF.optionsHtml({ kind: 'factored', payer: 'carrier', rate: 2000, feePct: 4, reserve: RES_OK,
    factorName: 'RTS Financial', trained: true });
  assert.match(h, /RTS Financial will receive \$80\.00 less than its invoice/);
  const b = PF.optionsHtml({ kind: 'factored', payer: 'broker', rate: 2000, feePct: 4, reserve: RES_OK,
    factorName: 'RTS Financial', trained: true });
  assert.match(b, /This only pays the factor sooner/);
  assert.doesNotMatch(b, /less than its invoice/);
});

test('optionsHtml fee not set up disables carrier option', () => {
  const h = PF.optionsHtml({ kind: 'net30', payer: 'broker', rate: 2000, feePct: null, reserve: RES_OK, trained: true });
  assert.match(h, /Your quick pay fee isn't set up\. Contact OperFi\./);
  assert.match(h, /<input[^>]*value="carrier"[^>]*disabled/);
});

test('optionsHtml untrained is locked', () => {
  const h = PF.optionsHtml({ kind: 'net30', payer: 'carrier', rate: 2000, feePct: 4, reserve: RES_OK,
    trained: false, videoId: 'vid1' });
  assert.match(h, /Watch the 2-minute Pay Faster video to unlock/);
  assert.match(h, /data-video-id="vid1"/);
  assert.equal((h.match(/<input[^>]*disabled/g) || []).length, 2);
});

test('no em or en dashes in any html', () => {
  const all = [];
  for (const kind of ['net30', 'factored'])
    for (const payer of ['carrier', 'broker'])
      for (const reserve of [RES_OK, { cash: 5, status: 'ok' }, { cash: null, status: 'unavailable' }])
        for (const trained of [true, false])
          all.push(PF.optionsHtml({ kind, payer, rate: 2000, feePct: 4, reserve, factorName: 'RTS', trained, videoId: 'v' }));
  for (const kind of ['net30', 'factored', 'quickpay'])
    for (const payer of ['carrier', 'broker'])
      for (const toggled of [true, false])
        all.push(PF.summaryHtml({ kind, toggled, payer, fees: PF.computeFees(2000, 4, payer), feePct: 4, factorName: 'RTS', carrierRate: 2000 }));
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

test('waiveState and waiveHtml', () => {
  const a = { rate: 2000, reserve: { cash: 1250, status: 'ok' }, factorName: '', kind: 'quickpay', trained: true };
  const ok = PF.waiveState(a);
  assert.equal(ok.short, false);
  assert.match(ok.html, /Waive the quick pay fee on this load\. Carrier receives the full \$2,000\.00\. You cover OperFi's 2% \(\$40\.00\) from your reserve\./);
  assert.equal(PF.waiveHtml(a), ok.html);
  assert.equal(PF.waiveState(Object.assign({}, a, { reserve: { cash: 39.99, status: 'ok' } })).short, true);
  assert.equal(PF.waiveState(Object.assign({}, a, { reserve: { cash: 40, status: 'ok' } })).short, false);
  assert.equal(PF.waiveState(Object.assign({}, a, { reserve: { status: 'unavailable' } })).short, false);
  const f = PF.waiveHtml(Object.assign({}, a, { factorName: 'Example <Capital>' }));
  assert.match(f, /Example &lt;Capital&gt; receives the full/);
  assert.doesNotMatch(ok.html, DASH);
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
