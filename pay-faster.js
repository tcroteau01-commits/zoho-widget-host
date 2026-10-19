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
 *   PayFaster.money(n)                       -> "$1,920.00"
 *   PayFaster.whoPaysState({kind, rate, payer, feeAdjust, pct, savedPct, reserve, factorName, trained, videoId})
 *       -> {html, blocked, payer}. PAYCHGPICK2: the explicit "Who pays the quick pay fee?" choice.
 *       Radios name="pf-payer", values "carrier" / "broker" (nothing pre-selected). Under "The carrier pays",
 *       with feeAdjust a <select id="pf-fee"> of feeChoices(savedPct); without it the saved fee applies.
 *       A quick pay carrier without feeAdjust offers only "I'll cover the fee" (the waive).
 *       payer comes back null when the pick is not available (reserve short, option not offered).
 *       blocked: no payer, no rate, invalid fee, reserve short, or quickpay at the saved fee.
 *   PayFaster.summaryHtml({kind, toggled, payer, fees, feePct, factorName, carrierRate, pickPct})
 *       pickPct (PAYCHG3): the picked carrier fee. When set, fees come from computeFeesAt and
 *       payer from its result, so a split value shows the carrier part, the reserve part and OperFi's 2%.
 *   PayFaster.feeValid(v, savedPct)          -> boolean: v equals the saved fee, or a whole number 0..5
 *   PayFaster.feeChoices(savedPct)           -> [{value, label}] 5..1 plus the saved fee ("4% (your standard)")
 *   PayFaster.defaultFee(savedPct)           -> the saved fee when >= 2, else "2"
 *   PayFaster.refusalMessage(code)           -> plain copy for an API refusal code, or null (use the generic)
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

  function computeFees(rate, pct, payer) {
    if (payer !== 'carrier' && payer !== 'broker') return { error: 'bad_payer' };
    var rc = toCents(rate);
    if (rc === null) return { error: 'bad_rate' };
    var op = shareCents(rc, OPERFI_SHARE_PCT * 100);
    if (payer === 'broker') {
      return { carrierFee: 0, feeTotal: dollars(op), brokerShare: dollars(-op) + 0, operfiShare: dollars(op), reserveCharge: dollars(op), payeeReceives: dollars(rc) };
    }
    var p = parseFeePct(pct);
    if (p === null || p < OPERFI_SHARE_PCT) return { error: 'carrier_fee_unavailable' };
    var bp = Math.round((p - OPERFI_SHARE_PCT) * 100);
    var br = shareCents(rc, bp);
    var total = br + op;
    return { carrierFee: dollars(total), feeTotal: dollars(total), brokerShare: dollars(br), operfiShare: dollars(op), reserveCharge: 0, payeeReceives: dollars(rc - total) };
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

  function lockHtml(videoId) {
    return '<div class="pf-msg pf-info pf-lock"><a class="pf-video-link" href="#" data-video-id="' + esc(videoId || '') + '">Watch the 2-minute Pay Faster video to unlock</a></div>';
  }

  // PAYCHGPICK2. Mirrors the API: the saved fee is accepted as is, anything else a whole number 0..5.
  function feeValid(v, savedPct) {
    var p = parseFeePct(v);
    if (p === null || p < 0) return false;
    var saved = parseFeePct(savedPct);
    if (saved !== null && p === saved) return true;
    return p <= 5 && p === Math.floor(p);
  }

  // The carrier-pays choices: 5..1 plus the saved fee when it is not one of them. 0 is "I'll cover the fee".
  function feeChoices(savedPct) {
    var saved = parseFeePct(savedPct);
    var vals = [5, 4, 3, 2, 1];
    if (saved !== null && saved > 0 && vals.indexOf(saved) === -1) vals.push(saved);
    vals.sort(function (x, y) { return y - x; });
    return vals.map(function (v) {
      return { value: pctText(v), label: pctText(v) + '%' + (v === saved ? ' (your standard)' : '') };
    });
  }

  // Saved fee when it is at least OperFi's 2%, else 2.
  function defaultFee(savedPct) {
    var saved = parseFeePct(savedPct);
    return (saved !== null && saved >= OPERFI_SHARE_PCT) ? pctText(saved) : String(OPERFI_SHARE_PCT);
  }

  var REFUSALS = {
    not_enabled_for_account: "Pay Faster isn't turned on for your account. Contact OperFi.",
    fee_adjust_not_enabled: "Changing the quick pay fee isn't turned on for your account. Pick 'I'll cover the fee' or your standard fee.",
    bad_fee_pct: 'Pick a fee of 0% to 5%.',
    no_change: "That's already this carrier's quick pay fee. Nothing to change.",
    terms_not_eligible: "This carrier's payment terms can't be changed here.",
    carrier_paid: 'This carrier has already been paid.'
  };
  function refusalMessage(code) {
    return Object.prototype.hasOwnProperty.call(REFUSALS, code) ? REFUSALS[code] : null;
  }

  // PAYCHGPICK2: one explicit "Who pays the quick pay fee?" choice for every open block.
  function whoPaysState(a) {
    var kind = a.kind;
    var factored = kind === 'factored';
    var quick = kind === 'quickpay';
    var feeAdjust = !!a.feeAdjust;
    var saved = parseFeePct(a.savedPct);
    var rate = Number(a.rate);
    var hasRate = a.rate != null && a.rate !== '' && isFinite(rate) && rate > 0;
    var fname = a.factorName ? (a.factorName === 'factor on file' ? 'The factor on file' : esc(a.factorName)) : '';
    var payee = fname || (factored ? 'The factoring company' : 'Carrier');
    var fromWhom = (factored || (quick && fname)) ? "factor's" : "carrier's";
    var offerCarrier = !(quick && !feeAdjust);
    var payer = a.payer === 'broker' ? 'broker' : (a.payer === 'carrier' && offerCarrier ? 'carrier' : null);

    var sub = '<div class="pf-sub">' + (factored
      ? 'Payment still goes to ' + (a.factorName ? esc(a.factorName) : 'the factoring company') + ', just sooner. Who pays the quick pay fee?'
      : 'Who pays the quick pay fee?') + '</div>';
    if (a.trained === false) {
      return { html: '<div class="pf-body pf-locked">' + sub + lockHtml(a.videoId) + '</div>', blocked: true, payer: payer };
    }
    if (!hasRate) {
      return { html: '<div class="pf-body">' + sub + msg('info', 'Enter the carrier rate to see the fee.') + '</div>', blocked: true, payer: payer };
    }

    // "I'll cover the fee": the payee gets the full rate, OperFi's 2% comes from the reserve.
    var bf = computeFeesAt(rate, 0);
    var brsv = reserveMsg(a.reserve, bf.reserveCharge);
    if (brsv.short && payer === 'broker') payer = null;

    // "The carrier pays": the picked fee with fee adjust, else the saved fee.
    var carrierOk = feeAdjust || (saved !== null && saved >= OPERFI_SHARE_PCT);
    if (payer === 'carrier' && !carrierOk) payer = null;
    var cpct = feeAdjust ? a.pct : a.savedPct;

    function opt(value, title, disabled) {
      var on = payer === value;
      return '<label class="pf-opt' + (on ? ' pf-sel' : '') + (disabled ? ' pf-dis' : '') + '">' +
        '<input type="radio" name="pf-payer" id="pf-payer-' + value + '" value="' + value + '"' +
        (on ? ' checked' : '') + (disabled ? ' disabled' : '') + '>' +
        '<span class="pf-t"><b>' + title + '</b></span></label>';
    }
    function line(t) { return '<div class="pf-fee-live">' + t + '</div>'; }

    var blocked = !payer;
    var h = '<div class="pf-body">' + sub;
    if (offerCarrier) {
      h += opt('carrier', 'The carrier pays', !carrierOk);
      if (!carrierOk) h += msg('bad', "Your quick pay fee isn't set up. Contact OperFi.");
      if (payer === 'carrier' && carrierOk) {
        var d = '';
        if (feeAdjust) {
          if (saved === null || saved < OPERFI_SHARE_PCT) d += msg('info', "Your saved quick pay fee isn't set up. Contact OperFi.");
          var cur = parseFeePct(a.pct);
          d += '<label class="pf-fee-row">Quick pay fee the carrier pays <select id="pf-fee">' +
            feeChoices(a.savedPct).map(function (c) {
              return '<option value="' + esc(c.value) + '"' + (cur !== null && parseFeePct(c.value) === cur ? ' selected' : '') + '>' + esc(c.label) + '</option>';
            }).join('') + '</select></label>';
        }
        var p = parseFeePct(cpct);
        if (!feeValid(cpct, a.savedPct) || p === 0) {
          d += msg('bad', 'Pick a fee of 1% to 5%.');
          blocked = true;
        } else {
          var f = computeFeesAt(rate, p);
          d += line(money(f.carrierFee) + ' deducted from the ' + fromWhom + ' payment');
          d += line('You earn ' + money(Math.max(f.brokerShare, 0)) + ' · OperFi earns ' + money(f.operfiShare));
          d += line(payee + ' receives ' + money(f.payeeReceives));
          if (f.reserveCharge > 0) {
            d += line('You cover the other ' + esc(pctText(OPERFI_SHARE_PCT - p)) + '% (' + money(f.reserveCharge) + ') from your reserve');
            var rsv = reserveMsg(a.reserve, f.reserveCharge);
            d += rsv.html;
            if (rsv.short) blocked = true;
          }
          if (quick && feeAdjust && saved !== null && p === saved) {
            d += msg('info', "That's your saved quick pay fee. Pick a different fee to change it on this load.");
            blocked = true;
          }
          if (factored) {
            var fp = a.factorName ? esc(a.factorName) : 'The factoring company';
            d += msg('warn', '⚠ ' + fp + ' will receive ' + money(f.carrierFee) + ' less than its invoice. Factors often treat this as a short pay, leave the invoice open, and come back to the carrier or to you for the ' + money(f.carrierFee) + '.');
          } else if (kind === 'net30') {
            d += msg('info', 'Let the carrier know this load pays early with a ' + money(f.carrierFee) + ' fee deducted.');
          }
        }
        h += '<div class="pf-detail">' + d + '</div>';
      }
    }
    h += opt('broker', "I'll cover the fee", brsv.short);
    if (payer === 'broker') {
      var bd = line(payee + ' receives the full ' + money(bf.payeeReceives));
      bd += line(money(bf.reserveCharge) + " (OperFi's " + OPERFI_SHARE_PCT + '%) is charged to your reserve');
      bd += brsv.html;
      if (factored) bd += msg('info', "This only pays the factor sooner. It doesn't change who gets paid, and the " + OPERFI_SHARE_PCT + '% fee still applies.');
      h += '<div class="pf-detail">' + bd + '</div>';
    } else if (brsv.short) {
      h += brsv.html;
    }
    return { html: h + '</div>', blocked: blocked, payer: payer };
  }

  function sl(label, value, cls) {
    return '<div class="pf-sl' + (cls ? ' ' + cls : '') + '">' + label + '<b>' + value + '</b></div>';
  }

  function summaryHtml(a) {
    var kind = a.kind;
    if (kind !== 'net30' && kind !== 'factored' && kind !== 'quickpay') return '';
    var factored = kind === 'factored';
    var quick = kind === 'quickpay';
    var showSplit = quick || a.toggled;
    var pick = a.pickPct != null ? parseFeePct(a.pickPct) : null;
    var fees = a.fees;
    if (pick !== null && (!fees || fees.error) && a.carrierRate != null) fees = computeFeesAt(a.carrierRate, pick);
    var payer = (pick !== null && fees && fees.payer) ? fees.payer : (a.payer === 'broker' ? 'broker' : 'carrier');
    var h = '';
    var pill;
    if (quick && pick !== null && payer !== 'broker' && a.toggled) pill = '<span class="pf-pill pf-or">Quick Pay · fee changed to ' + esc(pctText(pick)) + '%</span>';
    else if (quick) pill = '<span class="pf-pill pf-gr">Quick Pay' + (payer === 'broker' ? ' · fee waived' : '') + '</span>';
    else if (a.toggled) pill = '<span class="pf-pill pf-or">Quick Pay · one-off</span>';
    else pill = factored ? 'Factoring Company' : 'Net 30';
    h += sl('Carrier Payment', pill);
    if (!showSplit) return h;

    if ((!fees || fees.error) && a.carrierRate != null && pick === null) fees = computeFees(a.carrierRate, a.feePct, payer);
    if (!fees || fees.error) return h;

    var p = pick !== null ? pick : parseFeePct(a.feePct);
    var payeeWord = factored ? 'Factor' : 'Carrier';
    if (a.factorName && (factored || (quick && a.factorName !== 'factor on file'))) h += sl('Paid to', esc(a.factorName));
    if (payer === 'carrier') {
      h += '<div class="pf-qph">Quick Pay fee · carrier pays ' + (p == null ? '' : esc(pctText(p)) + '%') + '</div>';
      h += sl(factored ? 'Deducted from factor payment' : 'Carrier is charged', money(fees.feeTotal), 'pf-ind');
      h += sl('You earn (' + (p == null ? '' : esc(pctText(p - OPERFI_SHARE_PCT))) + '%)', '+' + money(fees.brokerShare), 'pf-ind pf-pos');
      h += sl('OperFi earns (' + OPERFI_SHARE_PCT + '%)', money(fees.operfiShare), 'pf-ind');
    } else if (payer === 'split') {
      // PAYCHG3: the carrier's fee pays part of OperFi's 2%, the reserve covers the rest.
      h += '<div class="pf-qph">Quick Pay fee · carrier pays ' + esc(pctText(p)) + '%, you cover the rest</div>';
      h += sl((factored ? 'Deducted from factor payment' : 'Carrier is charged') + ' (' + esc(pctText(p)) + '%)', money(fees.carrierFee), 'pf-ind');
      h += sl('Charged to your reserve (' + esc(pctText(OPERFI_SHARE_PCT - p)) + '%)', '-' + money(fees.reserveCharge), 'pf-ind pf-neg');
      h += sl('OperFi earns (' + OPERFI_SHARE_PCT + '%)', money(fees.operfiShare), 'pf-ind');
    } else {
      h += '<div class="pf-qph">Quick Pay fee · you pay ' + OPERFI_SHARE_PCT + '%</div>';
      h += sl('Charged to your reserve', '-' + money(fees.reserveCharge), 'pf-ind pf-neg');
      h += sl('OperFi earns (' + OPERFI_SHARE_PCT + '%)', money(fees.operfiShare), 'pf-ind');
    }
    h += sl(payeeWord + ' receives', money(fees.payeeReceives));
    if (factored && (payer === 'carrier' || payer === 'split')) h += '<div class="pf-msg pf-warn">⚠ Short pay to factor</div>';
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
      '.pf-fee-row{display:flex;align-items:center;gap:6px;font-size:13px;text-transform:none;letter-spacing:0;font-weight:400;color:inherit;margin:6px 0}' +
      '.pf-fee-row select{width:auto}.pf-fee-live{font-size:13px;margin:4px 0}.pf-detail{margin:0 0 6px 30px}' +
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
    feeValid: feeValid,
    feeChoices: feeChoices,
    defaultFee: defaultFee,
    refusalMessage: refusalMessage,
    whoPaysState: whoPaysState,
    marginEffect: marginEffect,
    money: money,
    summaryHtml: summaryHtml,
    injectStyles: injectStyles
  };
  global.PayFaster = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
