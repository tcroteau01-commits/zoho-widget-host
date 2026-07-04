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
    var byDate = {};
    receipts.forEach(function (r) {
      if (!byDate[r.date]) byDate[r.date] = { date: r.date, pmtNumber: 'PMT' + r.date.replace(/-/g, ''), debtorId: r.debtorId, debtorName: r.debtorName, invoiceCount: 0, amount: 0, invoices: [] };
      byDate[r.date].invoiceCount += 1;
      byDate[r.date].amount = round2(byDate[r.date].amount + r.amount);
      byDate[r.date].invoices.push({ invoiceNo: r.invoiceNo, loadId: r.loadId, age: r.age, note: r.note, amount: r.amount });
    });
    var summary = Object.keys(byDate).map(function (k) { return byDate[k]; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return { receipts: receipts, summary: summary, totals: { count: receipts.length, amount: _sum(receipts, function (r) { return r.amount; }), summaryCount: summary.length } };
  }

  function agingCustomerReceipts(debtorId) {
    var receipts = _receiptsFromClosedLoads(debtorId);
    return { receipts: receipts, totals: { count: receipts.length, amount: _sum(receipts, function (r) { return r.amount; }) } };
  }

  function agingLoadPreview(loadId) { return loadPreview(loadId); }

  window.OPERFI_DEMO = {
    EMAIL: DEMO_EMAIL, ACCOUNT_NAME: DEMO_ACCOUNT_NAME,
    isDemo: isDemo, todayISO: todayISO, offsetISO: offsetISO,
    wallet: wallet,
    csvFromRows: csvFromRows, downloadCSV: downloadCSV, pdfFromRows: pdfFromRows,
    dashboardSummary: dashboardSummary,
    aging: aging,
    agingReceipts: agingReceipts, agingCustomerReceipts: agingCustomerReceipts, agingLoadPreview: agingLoadPreview
  };
})();
