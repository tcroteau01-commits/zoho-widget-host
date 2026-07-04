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

  window.OPERFI_DEMO = {
    EMAIL: DEMO_EMAIL, ACCOUNT_NAME: DEMO_ACCOUNT_NAME,
    isDemo: isDemo, todayISO: todayISO, offsetISO: offsetISO,
    wallet: wallet,
    csvFromRows: csvFromRows, downloadCSV: downloadCSV, pdfFromRows: pdfFromRows
  };
})();
