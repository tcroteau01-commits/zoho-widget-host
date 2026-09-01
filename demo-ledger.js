/* OperFi demo ledger — deterministic fake book-of-business for the "OperFi Demo" account.
   Every load/rating/reserve-transaction date is stored as a `daysAgo` OFFSET, never a
   calendar date, so the dataset never goes stale: demo-data.js converts offsets to real
   dates at render time. Same SEED always produces the exact same numbers — that's what
   makes it safe to use in a live sales demo without ever needing to reset anything. */
(function () {
  'use strict';

  var SEED = 20260703;

  // mulberry32 — small deterministic PRNG so every "random" choice below is 100%
  // reproducible across every page load, browser, and session.
  function mulberry32(seed) {
    var a = seed;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rand = mulberry32(SEED);
  function rf(min, max) { return min + rand() * (max - min); }
  function ri(min, max) { return Math.floor(rf(min, max + 1)); }
  function pick(arr) { return arr[ri(0, arr.length - 1)]; }
  function round2(n) { return Math.round(n * 100) / 100; }

  var DEBTOR_NAMES = [
    'Cascade Retail Distribution', 'Silverline Foods Co', 'Bluepoint Building Supply',
    'Meridian Consumer Goods', 'Harborview Industrial Parts', 'Northgate Apparel Group',
    'Pinnacle Hardware Distributors', 'Redstone Beverage Co', 'Lakeside Furniture Wholesale',
    'Ashford Paper Products', 'Coastal Produce Distributors', 'Ironwood Building Materials',
    'Summit Electronics Supply', 'Fairview Packaging Co', 'Brightpath Home Goods',
    'Westfield Auto Parts', 'Clearwater Plastics Inc', 'Highland Grocery Distribution',
    'Union Steel Supply', 'Riverside Textile Group'
  ];
  var debtors = DEBTOR_NAMES.map(function (name, i) { return { id: 'D' + (i + 1), name: name }; });

  // Only these customers carry aged-open (61+) balances, so only their rows
  // highlight in the Aging widget. Everyone else is kept current-to-60.
  // Highland Grocery is included deliberately (it reads as the top concentration).
  var SLOW_PAYER_NAMES = [
    'Highland Grocery Distribution', 'Cascade Retail Distribution',
    'Summit Electronics Supply', 'Redstone Beverage Co', 'Union Steel Supply'
  ];
  var slowPayerDebtors = debtors.filter(function (d) { return SLOW_PAYER_NAMES.indexOf(d.name) !== -1; });
  var SLOW_PAYER_IDS = slowPayerDebtors.map(function (d) { return d.id; });

  var CARRIER_PREFIXES = ['Redwood', 'Ironhide', 'Blackhawk', 'Silver Creek', 'Golden State',
    'Lone Star', 'Bluegrass', 'Cedar Point', 'Granite', 'Timberline', 'Crossroads', 'Highline', 'Prairie'];
  var CARRIER_SUFFIXES = ['Transport', 'Freight Carriers', 'Logistics', 'Trucking', 'Haulers'];
  var carriers = [];
  CARRIER_PREFIXES.forEach(function (p) {
    CARRIER_SUFFIXES.forEach(function (s) {
      carriers.push({ id: 'C' + (carriers.length + 1), name: p + ' ' + s });
    });
  }); // 13 * 5 = 65 carriers

  // Roughly a quarter of the carrier base is factored, so their money goes to their
  // factor rather than to them. Vendor Payments renders the paid party off this, and
  // it is the single row videos 05 and 08 both stop on ("paid to a factoring company
  // rather than the carrier"). Every name here is invented for the demo.
  var DEMO_FACTORS = ['Bluepine Capital Funding', 'Anchor Ridge Financial',
    'Copperline Freight Capital', 'Waypoint Receivables Group'];
  var PAY_TERMS = ['Quick Pay', 'Standard Net 30'];
  carriers.forEach(function (c, idx) {
    if (idx % 4 === 1) {
      c.factor = DEMO_FACTORS[(idx / 4 | 0) % DEMO_FACTORS.length];
      c.payTerms = 'Factoring Company';
    } else {
      c.factor = '';
      c.payTerms = PAY_TERMS[idx % PAY_TERMS.length];
    }
  });

  var ESCROW_RATE = 0.065;
  var CASH_HOLD_RATE = 0.015;
  var CASH_RESERVE_TARGET = 18240.55;
  var RECENT_WINDOW_DAYS = 90;
  var LOADS_PER_MONTH = 340;
  var RECENT_LOAD_COUNT = Math.round(LOADS_PER_MONTH * (RECENT_WINDOW_DAYS / 30));

  // The ONLY open invoices past 74 days, spelled out rather than generated. Two
  // reasons this is an explicit list and not a random tail:
  //   1. The demo account is the account every marketing video is shot in, so the
  //      book has to read like a well-run brokerage. A five-figure 75+ balance
  //      does not.
  //   2. The Dashboard's Chargeback Risk card and the AR Aging donut both derive
  //      from these exact rows, so the two can never disagree on screen.
  // One customer past 75 (the 75 Day Reserve Notice beat) and one past 90 (the
  // "over 90 matters under recourse" beat) is all the story needs.
  var AGED_OPEN = [
    { name: 'Highland Grocery Distribution', daysAgo: 78, amount: 2740.00 },
    { name: 'Highland Grocery Distribution', daysAgo: 83, amount: 2185.50 },
    { name: 'Union Steel Supply', daysAgo: 96, amount: 2610.25 }
  ];

  function buildLoad(i, daysAgo, forceOpen, debtorOverride, amountOverride) {
    var debtor = debtorOverride || pick(debtors);
    var carrier = pick(carriers);
    var purchaseAmount = amountOverride != null ? round2(amountOverride) : round2(rf(600, 3200));
    var feePct = rf(0.022, 0.028);
    var marginPct = rf(0.15, 0.20);
    var discountFee = round2(-purchaseAmount * feePct);
    var marginAmt = round2(purchaseAmount * marginPct);
    var vendorPayable = round2(-(purchaseAmount - Math.abs(discountFee) - marginAmt));
    var margin = round2(purchaseAmount + discountFee + vendorPayable); // backend's compute_load_aggregates formula
    var escrowReserve = -round2(purchaseAmount * ESCROW_RATE);
    var cashReserve = -round2(purchaseAmount * CASH_HOLD_RATE);

    var isSlow = SLOW_PAYER_IDS.indexOf(debtor.id) !== -1;
    var status, closedDaysAgo;
    if (forceOpen) {
      status = 'open'; closedDaysAgo = null;
    } else if (daysAgo > 74) {
      // Past 74 days belongs exclusively to AGED_OPEN. Anything else that old is
      // forced closed, which is what keeps the 75+ bucket equal to that list.
      status = 'closed'; closedDaysAgo = ri(0, daysAgo);
    } else if (!isSlow && daysAgo > 60) {
      // Clean customers never carry aged-open AR — force older loads closed so
      // they drop out of open aging entirely.
      status = 'closed'; closedDaysAgo = ri(0, daysAgo);
    } else {
      // Recent loads mostly stay open (current AR); older loads mostly close.
      var stayOpenChance = daysAgo <= 30 ? 0.85 : daysAgo <= 60 ? 0.35 : 0.15;
      status = rand() < stayOpenChance ? 'open' : 'closed';
      closedDaysAgo = status === 'closed' ? ri(0, daysAgo) : null;
    }

    return {
      id: 'INV' + (10000 + i), invNo: 'INV-' + (10000 + i),
      debtorId: debtor.id, carrierId: carrier.id,
      daysAgo: daysAgo, status: status, closedDaysAgo: closedDaysAgo,
      purchaseAmount: purchaseAmount, discountFee: discountFee, vendorPayable: vendorPayable,
      escrowReserve: escrowReserve, cashReserve: cashReserve, margin: margin,
      marginPct: round2((margin / purchaseAmount) * 100)
    };
  }

  var loads = [];
  for (var i = 0; i < RECENT_LOAD_COUNT; i++) {
    loads.push(buildLoad(i, ri(0, RECENT_WINDOW_DAYS), false));
  }
  AGED_OPEN.forEach(function (spec, s) {
    var d = debtors.filter(function (x) { return x.name === spec.name; })[0];
    loads.push(buildLoad(RECENT_LOAD_COUNT + s, spec.daysAgo, true, d, spec.amount));
  });

  // ---- Reserve ledger: escrow held on every load at buy time, transferred to cash
  // when a load closes, then drawn down by weekly "Reserve Release" batches so the
  // running cash balance as of today lands exactly on CASH_RESERVE_TARGET. ----
  var reserveTxns = [];
  var txnSeq = 1;
  loads.forEach(function (l) {
    reserveTxns.push({ id: 'RT' + (txnSeq++), daysAgo: l.daysAgo, glCode: '2004', amount: Math.abs(l.escrowReserve), invId: l.id, debtorId: l.debtorId, note: 'Escrow Reserve' });
    reserveTxns.push({ id: 'RT' + (txnSeq++), daysAgo: l.daysAgo, glCode: '2006', amount: Math.abs(l.cashReserve), invId: l.id, debtorId: l.debtorId, note: 'Cash Reserve' });
    if (l.status === 'closed') {
      reserveTxns.push({ id: 'RT' + (txnSeq++), daysAgo: l.closedDaysAgo, glCode: '2004', amount: -Math.abs(l.escrowReserve), invId: l.id, debtorId: l.debtorId, note: 'Escrow Reserve Transfer' });
      reserveTxns.push({ id: 'RT' + (txnSeq++), daysAgo: l.closedDaysAgo, glCode: '2006', amount: Math.abs(l.escrowReserve), invId: l.id, debtorId: l.debtorId, note: 'Escrow to Cash Transfer' });
    }
  });

  var cashBeforeReleases = round2(reserveTxns.filter(function (t) { return t.glCode === '2006' || t.glCode === '2005'; }).reduce(function (sum, t) { return sum + t.amount; }, 0));
  var totalReleaseNeeded = round2(cashBeforeReleases - CASH_RESERVE_TARGET);

  var releaseWeeks = [];
  for (var w7 = 7; w7 <= RECENT_WINDOW_DAYS; w7 += 7) releaseWeeks.push(w7);
  var remaining = totalReleaseNeeded;
  releaseWeeks.forEach(function (daysAgoW, idx) {
    var isLast = idx === releaseWeeks.length - 1;
    var chunk = isLast ? remaining : Math.min(remaining, round2((totalReleaseNeeded / releaseWeeks.length) * rf(0.7, 1.3)));
    remaining = round2(remaining - chunk);
    reserveTxns.push({ id: 'RT' + (txnSeq++), daysAgo: daysAgoW, glCode: '2005', amount: -chunk, invId: '', debtorId: '', note: 'Reserve Release' });
  });
  // Force-correct any rounding drift from the chunk loop onto the final (oldest) release
  // so the net always lands exactly on target, never off by a stray cent.
  var netNow = round2(reserveTxns.filter(function (t) { return t.glCode === '2006' || t.glCode === '2005'; }).reduce(function (sum, t) { return sum + t.amount; }, 0));
  var drift = round2(netNow - CASH_RESERVE_TARGET);
  if (drift !== 0) {
    var lastRelease = reserveTxns.filter(function (t) { return t.note === 'Reserve Release'; }).slice(-1)[0];
    lastRelease.amount = round2(lastRelease.amount - drift);
  }

  // Credit Dashboard: 9 of the 20 debtors get 6 months of rating history, mixed tiers
  // (not all clean) so the credit-monitoring story has real variety.
  var RATING_TIERS = [
    { rating: '38K-15', riskScore: 88 }, { rating: '30K-22', riskScore: 74 },
    { rating: '22K-30', riskScore: 61 }, { rating: '15K-40', riskScore: 47 },
    { rating: '8K-55', riskScore: 33 }
  ];
  var ratedDebtors = debtors.slice(0, 9);
  var ratings = [];
  ratedDebtors.forEach(function (d, idx) {
    var tier = RATING_TIERS[idx % RATING_TIERS.length];
    for (var m = 0; m < 6; m++) {
      ratings.push({ debtorId: d.id, daysAgo: m * 30 + ri(0, 5), rating: tier.rating, riskScore: tier.riskScore + ri(-4, 4) });
    }
  });

  window.OPERFI_DEMO_LEDGER = {
    SEED: SEED, debtors: debtors, carriers: carriers, loads: loads,
    reserveTxns: reserveTxns, ratings: ratings, SLOW_PAYER_IDS: SLOW_PAYER_IDS,
    CASH_RESERVE_TARGET: CASH_RESERVE_TARGET, ESCROW_RATE: ESCROW_RATE
  };
})();
