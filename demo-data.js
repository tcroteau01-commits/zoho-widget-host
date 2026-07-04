/* OperFi Demo Account — shapes the deterministic demo-ledger.js dataset into the
   exact JSON shape each backend endpoint returns today. Include AFTER
   operfi-impersonate.js and demo-ledger.js on every widget that needs it:
     <script src="https://app.operfi.com/demo-ledger.js"></script>
     <script src="https://app.operfi.com/demo-data.js"></script>
   Widgets check OPERFI_DEMO.isDemo() before fetching and call the matching shaping
   function instead when true. */
(function () {
  'use strict';

  var DEMO_EMAIL = 'demo@operfi.com';
  var DEMO_ACCOUNT_NAME = 'OperFi Demo';

  function isDemo() {
    try { return !!(window.OPERFI_IMP && window.OPERFI_IMP.target() === DEMO_EMAIL); }
    catch (e) { return false; }
  }

  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function offsetISO(daysAgo) {
    var d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().slice(0, 10);
  }
  function round2(n) { return Math.round(n * 100) / 100; }

  function wallet() {
    var L = window.OPERFI_DEMO_LEDGER;
    var escrow = round2(L.reserveTxns.filter(function (t) { return t.glCode === '2004'; }).reduce(function (s, t) { return s + t.amount; }, 0));
    return { cash: L.CASH_RESERVE_TARGET, escrow: escrow, account_name: DEMO_ACCOUNT_NAME };
  }

  // ---- Shared CSV/PDF export helpers (used by later tasks) ----
  function csvFromRows(columns, rows) {
    function esc(v) {
      var s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var lines = [columns.map(function (c) { return esc(c.label); }).join(',')];
    rows.forEach(function (row) {
      lines.push(columns.map(function (c) { return esc(row[c.key]); }).join(','));
    });
    return lines.join('\r\n');
  }

  function downloadCSV(filename, csvString) {
    var blob = new Blob([csvString], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function pdfFromRows(title, columns, rows, kpiLines) {
    if (!window.PDFLib) return Promise.reject(new Error('pdf-lib not loaded'));
    return window.PDFLib.PDFDocument.create().then(function (doc) {
      return doc.embedFont(window.PDFLib.StandardFonts.Helvetica).then(function (font) {
        return doc.embedFont(window.PDFLib.StandardFonts.HelveticaBold).then(function (bold) {
          var page = doc.addPage([612, 792]);
          var y = 750;
          page.drawText(title, { x: 40, y: y, size: 16, font: bold }); y -= 24;
          (kpiLines || []).forEach(function (line) {
            page.drawText(line, { x: 40, y: y, size: 10, font: font }); y -= 14;
          });
          y -= 10;
          var colWidth = (612 - 80) / columns.length;
          columns.forEach(function (c, i) { page.drawText(c.label, { x: 40 + i * colWidth, y: y, size: 9, font: bold }); });
          y -= 14;
          rows.forEach(function (row) {
            if (y < 40) { page = doc.addPage([612, 792]); y = 750; }
            columns.forEach(function (c, i) {
              var v = row[c.key]; var s = v === null || v === undefined ? '' : String(v);
              page.drawText(s.slice(0, 28), { x: 40 + i * colWidth, y: y, size: 8, font: font });
            });
            y -= 12;
          });
          return doc.save();
        });
      });
    }).then(function (bytes) {
      var blob = new Blob([bytes], { type: 'application/pdf' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = title.replace(/\s+/g, '-').toLowerCase() + '.pdf';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
  }

  // ---- Shared helpers for dashboard and later analytics tasks ----
  function _openLoads() { return window.OPERFI_DEMO_LEDGER.loads.filter(function (l) { return l.status === 'open'; }); }
  function _closedLoads() { return window.OPERFI_DEMO_LEDGER.loads.filter(function (l) { return l.status === 'closed'; }); }
  function _sum(arr, fn) { return round2(arr.reduce(function (s, x) { return s + fn(x); }, 0)); }
  function _debtorName(id) {
    var d = window.OPERFI_DEMO_LEDGER.debtors.filter(function (x) { return x.id === id; })[0];
    return d ? d.name : '(unknown)';
  }
  function _ageDays(l) { return l.daysAgo; } // purchase-date basis, matches backend default dateBasis=purchase

  function dashboardSummary() {
    var L = window.OPERFI_DEMO_LEDGER;
    var open = _openLoads();
    var thisMonthLoads = L.loads.filter(function (l) { return l.daysAgo <= 30; });
    var pastDue31Plus = open.filter(function (l) { return _ageDays(l) > 30; });

    var agingDefs = [
      { label: '0-30', test: function (d) { return d <= 30; } },
      { label: '31-60', test: function (d) { return d > 30 && d <= 60; } },
      { label: '61-74', test: function (d) { return d > 60 && d <= 74; } },
      { label: '75+', test: function (d) { return d > 74; } }
    ];
    var agingBuckets = agingDefs.map(function (b) {
      var matched = open.filter(function (l) { return b.test(_ageDays(l)); });
      return { label: b.label, amount: _sum(matched, function (l) { return l.purchaseAmount; }), count: matched.length };
    });

    var byDebtor = {};
    open.forEach(function (l) { byDebtor[l.debtorId] = (byDebtor[l.debtorId] || 0) + l.purchaseAmount; });
    var totalOpen = _sum(open, function (l) { return l.purchaseAmount; });
    var sortedDebtors = Object.keys(byDebtor).sort(function (a, b) { return byDebtor[b] - byDebtor[a]; });
    var concentration = sortedDebtors.slice(0, 4).map(function (id) {
      var amt = round2(byDebtor[id]);
      return { customer: _debtorName(id), amount: amt, pct: totalOpen ? round2((amt / totalOpen) * 100) : 0, count: open.filter(function (l) { return l.debtorId === id; }).length };
    });
    if (sortedDebtors.length > 4) {
      var restIds = sortedDebtors.slice(4);
      var restAmt = _sum(restIds.map(function (id) { return { amt: byDebtor[id] }; }), function (x) { return x.amt; });
      concentration.push({ customer: '+' + restIds.length + ' others', amount: restAmt, pct: totalOpen ? round2((restAmt / totalOpen) * 100) : 0, count: restIds.reduce(function (n, id) { return n + open.filter(function (l) { return l.debtorId === id; }).length; }, 0) });
    }

    var monthly = [];
    for (var m = 11; m >= 0; m--) {
      var lo = m * 30, hi = lo + 30;
      var monthLoads = L.loads.filter(function (l) { return l.daysAgo >= lo && l.daysAgo < hi; });
      var purchases = _sum(monthLoads, function (l) { return l.purchaseAmount; });
      var margin = _sum(monthLoads, function (l) { return l.margin; });
      var d = new Date(); d.setDate(d.getDate() - lo);
      monthly.push({
        month: d.toISOString().slice(0, 7),
        purchases: purchases,
        collections: _sum(monthLoads.filter(function (l) { return l.status === 'closed'; }), function (l) { return l.purchaseAmount; }),
        marginPct: purchases ? round2((margin / purchases) * 100) : 0
      });
    }

    return {
      accountName: DEMO_ACCOUNT_NAME,
      header: { usdot: '9182734', mc: '1029384', status: 'Active' },
      watch: {
        chargebackRisk: { amount: 0, invoiceCount: 0 },
        creditLimits: { customersAtRisk: 1 },
        dsoDays: 27
      },
      snapshot: {
        openAR: { amount: _sum(open, function (l) { return l.purchaseAmount; }), count: open.length },
        openAP: { amount: _sum(open, function (l) { return Math.abs(l.vendorPayable); }), count: open.length },
        thisMonth: {
          purchases: _sum(thisMonthLoads, function (l) { return l.purchaseAmount; }),
          loads: thisMonthLoads.length,
          marginPct: (function () { var p = _sum(thisMonthLoads, function (l) { return l.purchaseAmount; }); var m = _sum(thisMonthLoads, function (l) { return l.margin; }); return p ? round2((m / p) * 100) : 0; })()
        }
      },
      insights: { agingBuckets: agingBuckets, concentration: concentration, monthly: monthly }
    };
  }

  var AGING_BUCKET_DEFS = [
    { key: 'b0_30', test: function (d) { return d <= 30; } },
    { key: 'b31_45', test: function (d) { return d > 30 && d <= 45; } },
    { key: 'b46_60', test: function (d) { return d > 45 && d <= 60; } },
    { key: 'b61_90', test: function (d) { return d > 60 && d <= 90; } },
    { key: 'b90_plus', test: function (d) { return d > 90; } }
  ];
  function _agingBucketOf(ageDays) {
    for (var i = 0; i < AGING_BUCKET_DEFS.length; i++) if (AGING_BUCKET_DEFS[i].test(ageDays)) return AGING_BUCKET_DEFS[i].key;
    return 'b90_plus';
  }
  function _emptyBuckets() { return { b0_30: 0, b31_45: 0, b46_60: 0, b61_90: 0, b90_plus: 0, total: 0 }; }

  function aging(dateBasis) {
    var open = _openLoads();
    var totalOpen = _sum(open, function (l) { return l.purchaseAmount; });
    var overallBuckets = _emptyBuckets();
    var byDebtor = {};

    open.forEach(function (l) {
      var ageDays = _ageDays(l);
      var bucket = _agingBucketOf(ageDays);
      overallBuckets[bucket] = round2(overallBuckets[bucket] + l.purchaseAmount);
      overallBuckets.total = round2(overallBuckets.total + l.purchaseAmount);
      if (!byDebtor[l.debtorId]) byDebtor[l.debtorId] = { buckets: _emptyBuckets(), invoices: [] };
      byDebtor[l.debtorId].buckets[bucket] = round2(byDebtor[l.debtorId].buckets[bucket] + l.purchaseAmount);
      byDebtor[l.debtorId].buckets.total = round2(byDebtor[l.debtorId].buckets.total + l.purchaseAmount);
      byDebtor[l.debtorId].invoices.push({
        fvInvoiceId: l.id, invoiceNumber: l.invNo, loadId: l.id,
        buyDate: offsetISO(l.daysAgo), invoiceDate: offsetISO(l.daysAgo), dueDate: offsetISO(l.daysAgo - 30),
        ageDays: ageDays, bucket: bucket, openBalance: l.purchaseAmount
      });
    });

    var customers = Object.keys(byDebtor).map(function (debtorId) {
      var entry = byDebtor[debtorId];
      entry.invoices.sort(function (a, b) { return b.ageDays - a.ageDays; });
      return {
        name: _debtorName(debtorId), debtorId: debtorId, buyLimit: 100000,
        buckets: entry.buckets,
        concentrationPct: totalOpen ? round2((entry.buckets.total / totalOpen) * 100) : 0,
        invoices: entry.invoices
      };
    }).sort(function (a, b) { return b.buckets.total - a.buckets.total; });

    return {
      buckets: overallBuckets, customers: customers,
      client: { fvClientId: 'DEMO001', name: DEMO_ACCOUNT_NAME, buyLimit: 750000, available: round2(750000 - totalOpen) },
      asOf: todayISO(), dateBasis: dateBasis || 'purchase'
    };
  }

  function _receiptsFromClosedLoads(debtorFilter) {
    var closed = _closedLoads().filter(function (l) { return !debtorFilter || l.debtorId === debtorFilter; });
    var receipts = closed.map(function (l) {
      return {
        date: offsetISO(l.closedDaysAgo), invoiceNo: l.invNo, debtorId: l.debtorId,
        debtorName: _debtorName(l.debtorId), note: 'Collection', checkNumber: 'CHK' + l.id.slice(3),
        age: l.daysAgo - l.closedDaysAgo, amount: l.purchaseAmount, loadId: l.id
      };
    }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return receipts;
  }

  function agingReceipts() {
    var receipts = _receiptsFromClosedLoads(null);
    var byKey = {};
    receipts.forEach(function (r) {
      var key = r.date + '|' + r.debtorId;
      if (!byKey[key]) byKey[key] = { date: r.date, pmtNumber: 'PMT' + r.date.replace(/-/g, '') + '-' + r.debtorId, debtorId: r.debtorId, debtorName: r.debtorName, invoiceCount: 0, amount: 0, invoices: [] };
      byKey[key].invoiceCount += 1;
      byKey[key].amount = round2(byKey[key].amount + r.amount);
      byKey[key].invoices.push({ invoiceNo: r.invoiceNo, loadId: r.loadId, age: r.age, note: r.note, amount: r.amount });
    });
    var summary = Object.keys(byKey).map(function (k) { return byKey[k]; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return { receipts: receipts, summary: summary, totals: { count: receipts.length, amount: _sum(receipts, function (r) { return r.amount; }), summaryCount: summary.length } };
  }

  function agingCustomerReceipts(debtorId) {
    var receipts = _receiptsFromClosedLoads(debtorId);
    return { receipts: receipts, totals: { count: receipts.length, amount: _sum(receipts, function (r) { return r.amount; }) } };
  }

  function agingLoadPreview(loadId) { return loadPreview(loadId); }

  function _vendorName(carrierId) {
    var c = window.OPERFI_DEMO_LEDGER.carriers.filter(function (x) { return x.id === carrierId; })[0];
    return c ? c.name : '(unknown)';
  }
  function _loadById(loadId) { return window.OPERFI_DEMO_LEDGER.loads.filter(function (l) { return l.id === loadId; })[0]; }

  function loads(filters) {
    filters = filters || {};
    var all = window.OPERFI_DEMO_LEDGER.loads.slice();
    var filtered = all.filter(function (l) {
      if (filters.arStatus && filters.arStatus !== 'all' && l.status !== filters.arStatus) return false;
      if (filters.debtorId && l.debtorId !== filters.debtorId) return false;
      if (filters.vendor && _vendorName(l.carrierId).toLowerCase().indexOf(String(filters.vendor).toLowerCase()) === -1) return false;
      if (filters.loadId && l.invNo.toLowerCase().indexOf(String(filters.loadId).toLowerCase()) === -1) return false;
      return true;
    }).sort(function (a, b) { return a.daysAgo - b.daysAgo; }); // newest buy date first

    var rows = filtered.map(function (l) {
      return {
        loadId: l.id, loadNumber: l.invNo, invoiceId: l.id, invoiceNo: l.invNo,
        buyDate: offsetISO(l.daysAgo), arStatus: l.status, debtorId: l.debtorId, debtorName: _debtorName(l.debtorId),
        vendorName: _vendorName(l.carrierId), vendorInvoiceNo: 'V' + l.id.slice(3),
        purchaseAmount: l.purchaseAmount, discountFee: l.discountFee, vendorPayable: l.vendorPayable,
        escrowReserve: l.escrowReserve, cashReserve: l.cashReserve, margin: l.margin, marginPct: l.marginPct
      };
    });
    var sumPurchase = _sum(rows, function (r) { return r.purchaseAmount; });
    var sumMargin = _sum(rows, function (r) { return r.margin; });
    return { loads: rows, totals: { count: rows.length, purchaseAmount: sumPurchase, margin: sumMargin, marginPct: sumPurchase ? round2((sumMargin / sumPurchase) * 100) : 0 } };
  }

  function loadPreview(loadId) {
    var l = _loadById(loadId);
    if (!l) return null;
    var carrierPay = l.vendorPayable; // already negative
    var feeAmt = l.discountFee;       // already negative
    var netCash = round2(l.purchaseAmount + feeAmt + carrierPay);
    return {
      load: {
        loadNumber: l.invNo, buyDate: offsetISO(l.daysAgo), invoiceNo: l.invNo, arStatus: l.status,
        purchaseAmount: l.purchaseAmount, margin: l.margin, marginPct: l.marginPct,
        discountFee: l.discountFee, vendorPayable: l.vendorPayable, escrowReserve: l.escrowReserve,
        cashReserve: l.cashReserve, debtorId: l.debtorId, debtorName: _debtorName(l.debtorId)
      },
      vendor: {
        name: _vendorName(l.carrierId), invoiceNo: 'V' + l.id.slice(3), terms: 'Net 30',
        paidDate: l.status === 'closed' ? offsetISO(l.closedDaysAgo) : null,
        paymentStatus: l.status === 'closed' ? 'Paid' : 'Pending', poNumber: 'PO' + l.id.slice(3)
      },
      settlement: {
        arPurchased: l.purchaseAmount, carrierPay: carrierPay,
        fees: [{ label: 'Discount Fee', amount: feeAmt }],
        reserves: [{ label: 'Escrow reserve', amount: l.escrowReserve }, { label: 'Cash reserve', amount: l.cashReserve }],
        loanPayments: [], other: [], netCash: netCash
      }
    };
  }

  function _marginRow(label, group) {
    var purchase = _sum(group, function (l) { return l.purchaseAmount; });
    var discount = _sum(group, function (l) { return l.discountFee; });
    var vp = _sum(group, function (l) { return l.vendorPayable; });
    var margin = _sum(group, function (l) { return l.margin; });
    return { label: label, loadCount: group.length, purchaseAmount: purchase, discountFee: discount, vendorPayable: vp, margin: margin, marginPct: purchase ? round2((margin / purchase) * 100) : 0 };
  }

  function loadsMargins(groupBy) {
    var L = window.OPERFI_DEMO_LEDGER;
    var rows;
    if (groupBy === 'debtor') {
      var byDebtor = {};
      L.loads.forEach(function (l) { (byDebtor[l.debtorId] = byDebtor[l.debtorId] || []).push(l); });
      rows = Object.keys(byDebtor).map(function (id) { return _marginRow(_debtorName(id), byDebtor[id]); });
    } else {
      var byMonth = {};
      L.loads.forEach(function (l) {
        var d = new Date(); d.setDate(d.getDate() - l.daysAgo);
        var key = d.toISOString().slice(0, 7);
        (byMonth[key] = byMonth[key] || []).push(l);
      });
      rows = Object.keys(byMonth).sort().reverse().map(function (key) { return _marginRow(key, byMonth[key]); });
    }
    rows.sort(function (a, b) { return b.purchaseAmount - a.purchaseAmount; });
    var totalsRow = _marginRow('__total__', L.loads);
    delete totalsRow.label;
    return { groupBy: groupBy || 'month', rows: rows, totals: totalsRow };
  }

  var FEE_GL_LABELS = { '3001': 'Discount Fee' }; // demo ledger only synthesizes the discount fee GL; that's the dominant fee bucket on every real account too.

  function loadsFees() {
    var L = window.OPERFI_DEMO_LEDGER;
    var txns = L.loads.map(function (l) {
      return { date: offsetISO(l.daysAgo), loadId: l.id, loadNumber: l.invNo, debtorName: _debtorName(l.debtorId), amount: l.discountFee };
    });
    var subtotal = _sum(txns, function (t) { return t.amount; });
    var group = { glCode: '3001', feeType: 'Discount Fee', count: txns.length, subtotal: subtotal, transactions: txns.sort(function (a, b) { return a.date < b.date ? 1 : -1; }) };
    return { groups: [group], totals: { count: txns.length, amount: subtotal } };
  }

  function _categoryFor(t) { // mirrors reserve_helpers.py infer_category, single-transaction-per-journal simplification (the demo ledger never puts two GLs in the same instant except the escrow<->cash transfer pair, handled by note)
    if (t.note === 'Reserve Release') return 'Reserve Release';
    if (t.note === 'Escrow Reserve Transfer' || t.note === 'Escrow to Cash Transfer') return 'Escrow ↔ Cash Transfer';
    if (t.glCode === '2004') return 'Escrow Reserve';
    if (t.glCode === '2006') return 'Invoice Purchase';
    return 'Other';
  }

  function _groupReserveByDate(txns) {
    var byDate = {};
    txns.forEach(function (t) {
      var date = offsetISO(t.daysAgo);
      (byDate[date] = byDate[date] || []).push(t);
    });
    var dates = Object.keys(byDate).sort().reverse();
    var days = dates.map(function (date) {
      var dayTxns = byDate[date];
      var netChange = _sum(dayTxns, function (t) { return t.amount; });
      return {
        date: date, transaction_count: dayTxns.length, net_change: netChange,
        ending_balance: 0, // filled in after running-balance pass below
        transactions: dayTxns
      };
    });
    return days;
  }

  function _withRunningBalances(days) {
    // Walk oldest-to-newest to compute running balances, then reverse for display.
    var chronological = days.slice().reverse();
    var running = 0;
    chronological.forEach(function (day) {
      var ordered = day.transactions.slice().sort(function (a, b) {
        return parseInt(a.id.slice(2), 10) - parseInt(b.id.slice(2), 10);
      });
      ordered.forEach(function (t) {
        var beginning = running;
        running = round2(running + t.amount);
        t.beginning_balance = beginning; t.ending_balance = running;
        t.category = _categoryFor(t);
        t.trans_id = t.id; t.trans_date = offsetISO(t.daysAgo) + 'T12:00:00'; t.date_only = offsetISO(t.daysAgo);
        t.gl_bucket = t.glCode === '2004' ? 'escrow' : 'cash';
        t.gl_code = t.glCode; t.inv_id = t.invId; t.debtor_id = t.debtorId; t.ref_number = t.id;
        t.inv_no = t.invId ? (_loadById(t.invId) || {}).invNo || '' : '';
        t.debtor_name = t.debtorId ? _debtorName(t.debtorId) : '';
      });
      day.transactions = ordered; // CRITICAL: reassign so the array actually returned/rendered/exported
                                    // matches the order the running balance was computed in.
      day.ending_balance = running;
    });
    return chronological.reverse(); // back to newest-first
  }

  function reserveActivity() {
    var L = window.OPERFI_DEMO_LEDGER;
    var cashTxns = L.reserveTxns.filter(function (t) { return t.glCode === '2006' || t.glCode === '2005'; });
    var escrowTxns = L.reserveTxns.filter(function (t) { return t.glCode === '2004'; });
    var cashDays = _withRunningBalances(_groupReserveByDate(cashTxns));
    var escrowDays = _withRunningBalances(_groupReserveByDate(escrowTxns));
    var cashReserve = cashDays.length ? cashDays[0].ending_balance : 0;
    var escrowReserve = escrowDays.length ? escrowDays[0].ending_balance : 0;
    var oldestDay = cashDays.concat(escrowDays).map(function (d) { return d.date; }).sort()[0];
    var newestDay = cashDays.concat(escrowDays).map(function (d) { return d.date; }).sort().reverse()[0];
    return {
      kpis: { cash_reserve: cashReserve, escrow_reserve: escrowReserve, total_reserve: round2(cashReserve + escrowReserve), available_for_release: cashReserve },
      cash_activity_by_date: cashDays, escrow_activity_by_date: escrowDays,
      date_range: { start: oldestDay || null, end: newestDay || null },
      client: { fvClientId: 'DEMO001' }, has_outstanding_balance: false
    };
  }

  function _vpRow(l) {
    var carrier = window.OPERFI_DEMO_LEDGER.carriers.filter(function (c) { return c.id === l.carrierId; })[0];
    return {
      _id: l.id, Client: DEMO_ACCOUNT_NAME, 'Load #': l.invNo, Debtor: _debtorName(l.debtorId),
      'Vendor Name': carrier ? carrier.name : '(unknown)', USDOT: '19' + l.carrierId.slice(1).padStart(5, '0'),
      'Vendor Amount': Math.abs(l.vendorPayable),
      'Date of Buy Date': offsetISO(l.daysAgo), 'Purchase Date': offsetISO(l.daysAgo),
      'Vendor Pmt Terms': 'Quick Pay', 'Broker Pmt Terms': 'Net 30', 'Factoring Company': '',
      'Pmt Acct Number': 'ACCT' + l.carrierId.slice(1), 'Vendor Invoice #': 'V' + l.id.slice(3), 'Invoice #': l.id,
      'Payment Status': l.status === 'closed' ? 'Paid' : 'Pending', 'AR Balance': l.status === 'open' ? l.purchaseAmount : 0,
      'Vendor Gross Amt': Math.abs(l.vendorPayable), 'PO #': 'PO' + l.id.slice(3), 'Other Reference': ''
    };
  }

  function vendorPaymentsOpen() {
    var open = _openLoads();
    var rows = open.map(function (l) { var r = _vpRow(l); r['Vendor Due'] = offsetISO(l.daysAgo - 30); return r; });
    return { rows: rows, totals: { openLoads: rows.length, totalOwed: _sum(rows, function (r) { return r['Vendor Amount']; }), carrierCount: new Set(open.map(function (l) { return l.carrierId; })).size }, accountName: DEMO_ACCOUNT_NAME, seeAll: false };
  }

  function vendorPaymentsHistory(from, to) {
    var closed = _closedLoads();
    var rows = closed.map(function (l) { var r = _vpRow(l); r['Paid Date'] = offsetISO(l.closedDaysAgo); return r; });
    return { rows: rows, totals: { paymentCount: rows.length, totalPaid: _sum(rows, function (r) { return r['Vendor Amount']; }), carriersPaid: new Set(closed.map(function (l) { return l.carrierId; })).size }, accountName: DEMO_ACCOUNT_NAME, seeAll: false };
  }

  function creditDashboard() {
    var L = window.OPERFI_DEMO_LEDGER;
    var byDebtor = {};
    L.ratings.forEach(function (r) { (byDebtor[r.debtorId] = byDebtor[r.debtorId] || []).push(r); });
    var debtors = Object.keys(byDebtor).map(function (debtorId) {
      var snaps = byDebtor[debtorId].slice().sort(function (a, b) { return a.daysAgo - b.daysAgo; });
      return {
        name: _debtorName(debtorId), mc: '10' + debtorId.slice(1).padStart(4, '0'), mcList: [],
        snapshots: snaps.map(function (r) {
          return {
            date: offsetISO(r.daysAgo) + 'T00:00:00', rating: r.rating, riskScore: r.riskScore,
            cosReporting: 1, reportType: 'Monitor', login: 'system',
            daysToPay: parseInt(r.rating.split('-')[1], 10), arMonthlyBalance: parseInt(r.rating.split('K')[0], 10) * 1000, noData: false
          };
        }).sort(function (a, b) { return a.date < b.date ? 1 : -1; })
      };
    });
    return {
      client: { fvClientId: 'DEMO001', name: DEMO_ACCOUNT_NAME, mc: '1029384', mcNormalized: 'MC1029384', dot: '9182734' },
      debtorCount: debtors.length, totalSnapshots: L.ratings.length, debtors: debtors
    };
  }

  window.OPERFI_DEMO = {
    EMAIL: DEMO_EMAIL, ACCOUNT_NAME: DEMO_ACCOUNT_NAME,
    isDemo: isDemo, todayISO: todayISO, offsetISO: offsetISO,
    wallet: wallet,
    csvFromRows: csvFromRows, downloadCSV: downloadCSV, pdfFromRows: pdfFromRows,
    dashboardSummary: dashboardSummary,
    aging: aging,
    agingReceipts: agingReceipts, agingCustomerReceipts: agingCustomerReceipts, agingLoadPreview: agingLoadPreview,
    loads: loads, loadPreview: loadPreview,
    loadsMargins: loadsMargins, loadsFees: loadsFees,
    reserveActivity: reserveActivity,
    vendorPaymentsOpen: vendorPaymentsOpen, vendorPaymentsHistory: vendorPaymentsHistory,
    creditDashboard: creditDashboard
  };
})();
