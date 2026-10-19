/* OperFi Pay Carrier Faster (PAYCHG1): shared fee math and markup for Submit Load
 * and Submission History. No dependencies. Display only: the API recomputes every
 * figure and never trusts numbers sent from here.
 *
 *   PayFaster.kindForTerms(terms)            -> "net30" | "factored" | "quickpay" | null
 *   PayFaster.parseFeePct(v)                 -> number | null
 *   PayFaster.computeFeesAt(rate, pct)       -> {payer, carrierFee, feeTotal, brokerShare, operfiShare, reserveCharge, payeeReceives} | {error}
 *       pct is the fee the carrier pays on this load (PAYCHG2/3). payer is 'carrier' (pct >= 2),
 *       'broker' (pct 0, fee waived) or 'split'. Error 'bad_fee_pct' for null or negative pct.
 *   PayFaster.computeFees(rate, pct, payer)  -> {carrierFee, feeTotal, brokerShare, operfiShare, reserveCharge, payeeReceives} | {error}
 *   PayFaster.marginEffect(fees)             -> number (fees.brokerShare; a second arg is ignored)
 *   PayFaster.factorNameForTerms(terms)      -> "Example Capital" | "factor on file" | ""
 *   PayFaster.waiveState({rate, reserve, factorName, kind, trained, videoId}) -> {html, short}
 *       short is true when the reserve can't cover OperFi's 2%; pages disable Send/Submit on it.
 *   PayFaster.waiveHtml(a)                   -> string (waiveState(a).html)
 *   PayFaster.money(n)                       -> "$1,920.00"
 *   PayFaster.optionsHtml({kind, payer, rate, feePct, reserve, factorName, trained, videoId})
 *       rate is the carrier rate. fees may instead be passed as {carrier, broker} computeFees results.
 *       Radios: name="pf-payer", values "carrier" / "broker".
 *   PayFaster.summaryHtml({kind, toggled, payer, fees, feePct, factorName, carrierRate})
 *   PayFaster.injectStyles()                 -> adds the .pf-* styles once
 *
 * Mirrors pay_change_math.py in operfi-broker-api. Money is integer cents, half-up per line.
 */
(function (global) {
  var OPERFI_SHARE_PCT = 2;
  var FACTORING_PREFIX = 'Factoring Company - ';
  var QP_SUFFIX_PREFIX = 'Factoring Company - Quick Pay - ';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function baseTerm(terms) {
    var t = String(terms).trim();
    if (t.indexOf(QP_SUFFIX_PREFIX) === 0 && t.slice(QP_SUFFIX_PREFIX.length).trim()) return 'Factoring Company - Quick Pay';
    if (t.indexOf(FACTORING_PREFIX) === 0) {
      var x = t.slice(FACTORING_PREFIX.length).trim();
      if (x && x !== 'Quick Pay') return 'Factoring Company';
    }
    return t;
  }

  function kindForTerms(terms) {
    if (terms == null) return null;
    var b = baseTerm(terms);
    if (b === 'Standard Net 30' || b === 'Standard Net 30 - LOR') return 'net30';
    if (b === 'Factoring Company') return 'factored';
    if (b === 'Quick Pay' || b === 'Quick Pay - LOR' || b === 'Factoring Company - Quick Pay') return 'quickpay';
    return null;
  }

  function parseFeePct(v) {
    if (v == null) return null;
    var s = String(v).trim().replace(/%\s*$/, '').trim();
    if (!s || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  function toCents(x) {
    var n = Number(String(x).replace(/[$,\s]/g, ''));
    return isFinite(n) ? Math.round(n * 100) : null;
  }

  // round-half-up of (cents * bp / 10000) in integers (bp = percent * 100)
  function shareCents(rateCents, bp) {
    return Math.floor((2 * rateCents * bp + 10000) / 20000);
  }

  function dollars(c) { return Math.round(c) / 100; }

  // computeFees results keep their original enumerable shape (existing callers and tests
  // deepEqual it); carrierFee rides along as a non-enumerable property.
  function withCarrierFee(o, cf) {
    Object.defineProperty(o, 'carrierFee', { value: cf, enumerable: false });
    return o;
  }

  function computeFees(rate, pct, payer) {
    if (payer !== 'carrier' && payer !== 'broker') return { error: 'bad_payer' };
    var rc = toCents(rate);
    if (rc === null) return { error: 'bad_rate' };
    var op = shareCents(rc, OPERFI_SHARE_PCT * 100);
    if (payer === 'broker') {
      return withCarrierFee({ feeTotal: dollars(op), brokerShare: dollars(-op) + 0, operfiShare: dollars(op), reserveCharge: dollars(op), payeeReceives: dollars(rc) }, 0);
    }
    var p = parseFeePct(pct);
    if (p === null || p < OPERFI_SHARE_PCT) return { error: 'carrier_fee_unavailable' };
    var bp = Math.round((p - OPERFI_SHARE_PCT) * 100);
    var br = shareCents(rc, bp);
    var total = br + op;
    return withCarrierFee({ feeTotal: dollars(total), brokerShare: dollars(br), operfiShare: dollars(op), reserveCharge: 0, payeeReceives: dollars(rc - total) }, dollars(total));
  }

  // Fee at an arbitrary carrier fee X (percent). X >= 2: carrier pays X, broker keeps X-2.
  // X < 2: carrier pays X, reserve covers the rest of OperFi's 2%.
  function computeFeesAt(rate, pct) {
    var p = parseFeePct(pct);
    if (p === null || p < 0) return { error: 'bad_fee_pct' };
    var rc = toCents(rate);
    if (rc === null) return { error: 'bad_rate' };
    var op = shareCents(rc, OPERFI_SHARE_PCT * 100);
    if (p >= OPERFI_SHARE_PCT) {
      var br = shareCents(rc, Math.round((p - OPERFI_SHARE_PCT) * 100));
      var total = br + op;
      return { payer: 'carrier', carrierFee: dollars(total), feeTotal: dollars(total), brokerShare: dollars(br), operfiShare: dollars(op), reserveCharge: 0, payeeReceives: dollars(rc - total) };
    }
    var cf = shareCents(rc, Math.round(p * 100));
    var rsv = op - cf;
    return { payer: p === 0 ? 'broker' : 'split', carrierFee: dollars(cf), feeTotal: dollars(op), brokerShare: dollars(-rsv) + 0, operfiShare: dollars(op), reserveCharge: dollars(rsv), payeeReceives: dollars(rc - cf) };
  }

  function marginEffect(fees) {
    if (!fees || fees.error) return 0;
    return fees.brokerShare;
  }

  // Same rules as the API's _factor_from_terms.
  function factorNameForTerms(terms) {
    if (terms == null) return '';
    var t = String(terms).trim();
    if (t === 'Factoring Company - Quick Pay') return 'factor on file';
    var rest = '';
    if (t.indexOf(QP_SUFFIX_PREFIX) === 0) rest = t.slice(QP_SUFFIX_PREFIX.length).trim();
    else if (t.indexOf(FACTORING_PREFIX) === 0) rest = t.slice(FACTORING_PREFIX.length).trim();
    return rest === 'Quick Pay' ? '' : rest;
  }

  function money(n) {
    var c = Math.round(Number(n) * 100);
    var neg = c < 0;
    c = Math.abs(c);
    var d = Math.floor(c / 100), r = c % 100;
    var ds = String(d).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + '$' + ds + '.' + (r < 10 ? '0' : '') + r;
  }

  function pctText(p) {
    return String(Math.round(p * 100) / 100);
  }

  function pairFor(a) {
    var fp = a.fees || {};
    var carrier = fp.carrier, broker = fp.broker;
    if (a.rate != null) {
      if (!carrier) carrier = computeFees(a.rate, a.feePct, 'carrier');
      if (!broker) broker = computeFees(a.rate, a.feePct, 'broker');
    }
    return { carrier: carrier || { error: 'bad_rate' }, broker: broker || { error: 'bad_rate' } };
  }

  function msg(cls, text) { return '<div class="pf-msg pf-' + cls + '">' + text + '</div>'; }

  function reserveMsg(reserve, charge) {
    if (!reserve || reserve.status !== 'ok' || reserve.cash == null) {
      return { html: msg('info', "We couldn't check your reserve balance right now. OperFi will confirm before applying."), short: false };
    }
    if (reserve.cash >= charge) {
      return { html: msg('ok', '✓ Your reserve balance ' + money(reserve.cash) + ' covers this fee. Balance after: ' + money(reserve.cash - charge) + '.'), short: false };
    }
    return { html: msg('bad', "Your reserve balance (" + money(reserve.cash) + ") doesn't cover the " + money(charge) + ' fee.'), short: true };
  }

  function optionsHtml(a) {
    var kind = a.kind;
    if (kind !== 'net30' && kind !== 'factored') return '';
    var factored = kind === 'factored';
    var locked = a.trained === false;
    var fees = pairFor(a);
    var cf = fees.carrier, bf = fees.broker;
    var payee = factored ? (a.factorName ? esc(a.factorName) : 'The factoring company') : 'Carrier';
    var payeeRecv = factored ? (a.factorName ? esc(a.factorName) + ' receives' : 'The factor receives') : 'Carrier receives';
    var feeOk = !cf.error;
    var rsv = bf.error ? { html: '', short: false } : reserveMsg(a.reserve, bf.reserveCharge);
    var payer = a.payer === 'broker' ? 'broker' : 'carrier';
    var pctLabel = parseFeePct(a.feePct);

    var carrierDisabled = locked || !feeOk;
    var brokerDisabled = locked || bf.error || rsv.short;

    function opt(value, disabled, title, desc) {
      return '<label class="pf-opt' + (payer === value ? ' pf-sel' : '') + (disabled ? ' pf-dis' : '') + '">' +
        '<input type="radio" name="pf-payer" id="pf-payer-' + value + '" value="' + value + '"' +
        (payer === value ? ' checked' : '') + (disabled ? ' disabled' : '') + '>' +
        '<span class="pf-t"><b>' + title + '</b>' + (desc ? '<span class="pf-d">' + desc + '</span>' : '') + '</span></label>';
    }

    var carrierTitle = 'Carrier pays your standard ' + (pctLabel == null ? '' : pctText(pctLabel) + '% ') + 'QP fee';
    var carrierDesc = feeOk
      ? money(cf.feeTotal) + " comes out of the " + (factored ? 'factor' : "carrier") + "'s payment. " + payeeRecv + ' <b>' + money(cf.payeeReceives) + '</b>. ' +
        'You keep ' + money(cf.brokerShare) + ' of the fee and OperFi keeps ' + money(cf.operfiShare) + '.'
      : '';
    var brokerDesc = bf.error ? '' :
      payeeRecv + ' the full <b>' + money(bf.payeeReceives) + '</b>. <b>' + money(bf.reserveCharge) + '</b> is charged to your reserve. ' +
      'You pay only OperFi\'s ' + OPERFI_SHARE_PCT + '%, not your ' + (pctLabel == null ? 'standard' : pctText(pctLabel) + '%') + '.';

    var h = '<div class="pf-body' + (locked ? ' pf-locked' : '') + '">';
    h += '<div class="pf-sub">' + (factored
      ? 'Payment still goes to ' + (a.factorName ? esc(a.factorName) : 'the factoring company') + ', just sooner. Who pays the quick pay fee?'
      : 'Who pays the quick pay fee?') + '</div>';
    h += opt('carrier', carrierDisabled, carrierTitle, carrierDesc);
    h += opt('broker', brokerDisabled, "I'll pay " + OPERFI_SHARE_PCT + '% from my reserve', brokerDesc);
    if (!feeOk) h += msg('bad', "Your quick pay fee isn't set up. Contact OperFi.");
    h += rsv.html;
    if (factored) {
      if (payer === 'carrier' && feeOk) {
        h += msg('warn', '⚠ ' + payee + ' will receive ' + money(cf.feeTotal) + ' less than its invoice. Factors often treat this as a short pay, leave the invoice open, and come back to the carrier or to you for the ' + money(cf.feeTotal) + '. Paying faster still carries a fee.');
      } else if (payer === 'broker') {
        h += msg('info', "This only pays the factor sooner. It doesn't change who gets paid, and the " + OPERFI_SHARE_PCT + '% fee still applies.');
      }
    } else if (payer === 'carrier' && feeOk) {
      h += msg('info', 'Let the carrier know this load pays early with a ' + money(cf.feeTotal) + ' fee deducted.');
    }
    if (locked) {
      h += '<div class="pf-msg pf-info pf-lock"><a class="pf-video-link" href="#" data-video-id="' + esc(a.videoId || '') + '">Watch the 2-minute Pay Faster video to unlock</a></div>';
    }
    return h + '</div>';
  }

  function waiveState(a) {
    var f = computeFeesAt(a.rate, 0);
    if (f.error) return { html: '', short: false };
    var who = a.factorName ? (a.factorName === 'factor on file' ? 'The factor on file' : esc(a.factorName)) : 'Carrier';
    var rsv = reserveMsg(a.reserve, f.reserveCharge);
    var html = msg('info', 'Waive the quick pay fee on this load. ' + who + ' receives the full ' + money(f.payeeReceives) +
      '. You cover OperFi\'s ' + OPERFI_SHARE_PCT + '% (' + money(f.reserveCharge) + ') from your reserve.') + rsv.html;
    return { html: html, short: rsv.short };
  }

  function waiveHtml(a) { return waiveState(a).html; }

  function sl(label, value, cls) {
    return '<div class="pf-sl' + (cls ? ' ' + cls : '') + '">' + label + '<b>' + value + '</b></div>';
  }

  function summaryHtml(a) {
    var kind = a.kind;
    if (kind !== 'net30' && kind !== 'factored' && kind !== 'quickpay') return '';
    var factored = kind === 'factored';
    var quick = kind === 'quickpay';
    var showSplit = quick || a.toggled;
    var payer = quick ? (a.payer === 'broker' ? 'broker' : 'carrier') : (a.payer === 'broker' ? 'broker' : 'carrier');
    var h = '';
    var pill;
    if (quick) pill = '<span class="pf-pill pf-gr">Quick Pay' + (payer === 'broker' ? ' · fee waived' : '') + '</span>';
    else if (a.toggled) pill = '<span class="pf-pill pf-or">Quick Pay · one-off</span>';
    else pill = factored ? 'Factoring Company' : 'Net 30';
    h += sl('Carrier Payment', pill);
    if (!showSplit) return h;

    var fees = a.fees;
    if ((!fees || fees.error) && a.carrierRate != null) fees = computeFees(a.carrierRate, a.feePct, payer);
    if (!fees || fees.error) return h;

    var p = parseFeePct(a.feePct);
    var payeeWord = factored ? 'Factor' : 'Carrier';
    if (factored && a.factorName) h += sl('Paid to', esc(a.factorName));
    if (payer === 'carrier') {
      h += '<div class="pf-qph">Quick Pay fee · carrier pays ' + (p == null ? '' : esc(pctText(p)) + '%') + '</div>';
      h += sl(factored ? 'Deducted from factor payment' : 'Carrier is charged', money(fees.feeTotal), 'pf-ind');
      h += sl('You earn (' + (p == null ? '' : esc(pctText(p - OPERFI_SHARE_PCT))) + '%)', '+' + money(fees.brokerShare), 'pf-ind pf-pos');
      h += sl('OperFi earns (' + OPERFI_SHARE_PCT + '%)', money(fees.operfiShare), 'pf-ind');
    } else {
      h += '<div class="pf-qph">Quick Pay fee · you pay ' + OPERFI_SHARE_PCT + '%</div>';
      h += sl('Charged to your reserve', '-' + money(fees.reserveCharge), 'pf-ind pf-neg');
      h += sl('OperFi earns (' + OPERFI_SHARE_PCT + '%)', money(fees.operfiShare), 'pf-ind');
    }
    h += sl(payeeWord + ' receives', money(fees.payeeReceives));
    if (factored && payer === 'carrier') h += '<div class="pf-msg pf-warn">⚠ Short pay to factor</div>';
    return h;
  }

  var STYLE_ID = 'pf-styles';
  function injectStyles() {
    var d = global.document;
    if (!d || d.getElementById(STYLE_ID)) return;
    var s = d.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '.pf-sub{font-size:12px;color:#6b6862;margin:4px 0 8px}' +
      '.pf-opt{display:flex;gap:10px;align-items:flex-start;border:1px solid #e3e0d6;border-radius:8px;padding:10px 12px;margin:6px 0;cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400;color:inherit}' +
      '.pf-opt.pf-sel{border-color:#e8a33c;background:#fffaf1}' +
      '.pf-opt.pf-dis{opacity:.55;cursor:not-allowed}' +
      '.pf-opt .pf-t{display:block;font-size:13px}.pf-opt .pf-d{display:block;font-size:12px;color:#6b6862;margin-top:2px}' +
      '.pf-msg{font-size:12px;border-radius:8px;padding:8px 10px;margin:8px 0;border:1px solid}' +
      '.pf-ok{background:#eaf6ee;border-color:#a9d8b6;color:#1d6b37}' +
      '.pf-bad{background:#fdecea;border-color:#f1b0a8;color:#9b2a1c}' +
      '.pf-warn{background:#fff3e0;border-color:#f3c98a;color:#8a4b00}' +
      '.pf-info{background:#eef3fb;border-color:#bcd0ee;color:#24467a}' +
      '.pf-sl{display:flex;justify-content:space-between;font-size:13px;padding:3px 0}' +
      '.pf-sl.pf-ind{padding-left:14px;font-size:12px}.pf-pos b{color:#1d6b37}.pf-neg b{color:#9b2a1c}' +
      '.pf-qph{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#6b6862;margin-top:6px}' +
      '.pf-pill{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px}' +
      '.pf-pill.pf-or{background:#fdf1dc;color:#9a5c00}.pf-pill.pf-gr{background:#f3f4f6;color:#374151}';
    d.head.appendChild(s);
  }

  var api = {
    OPERFI_SHARE_PCT: OPERFI_SHARE_PCT,
    kindForTerms: kindForTerms,
    parseFeePct: parseFeePct,
    computeFees: computeFees,
    computeFeesAt: computeFeesAt,
    factorNameForTerms: factorNameForTerms,
    waiveState: waiveState,
    waiveHtml: waiveHtml,
    marginEffect: marginEffect,
    money: money,
    optionsHtml: optionsHtml,
    summaryHtml: summaryHtml,
    injectStyles: injectStyles
  };
  global.PayFaster = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
