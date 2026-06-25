/* OperFi shared document viewer — full-screen modal that renders PDFs to
 * <canvas> (via PDF.js) and images inline, so a document always displays and
 * never forces a browser download.
 *
 *   OperFiDocViewer.open({ url, filename, mime });
 *   OperFiDocViewer.close();
 */
(function (global) {
  var doc = global.document;
  var STYLE_ID = 'opf-dv-styles';
  var state = { objectUrl: null, scale: 1, kind: null, pdf: null };

  function injectStyles() {
    if (doc.getElementById(STYLE_ID)) return;
    var s = doc.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '.opf-dv-backdrop{position:fixed;inset:0;background:rgba(20,22,26,.82);z-index:2147483000;display:flex;flex-direction:column}' +
      '.opf-dv-backdrop.hidden{display:none}' +
      '.opf-dv-bar{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#1c1f24;color:#f3f4f6;font:600 13px system-ui,sans-serif}' +
      '.opf-dv-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.opf-dv-bar button,.opf-dv-bar a{background:#2c3038;color:#f3f4f6;border:1px solid #3a3f48;border-radius:6px;padding:5px 10px;font:600 13px system-ui;cursor:pointer;text-decoration:none}' +
      '.opf-dv-page{color:#aeb4bd;font-weight:600;min-width:64px;text-align:center}' +
      '.opf-dv-body{flex:1;overflow:auto;padding:18px;display:flex;flex-direction:column;align-items:center;gap:14px}' +
      '.opf-dv-body img{max-width:100%;height:auto}' +
      '.opf-dv-body canvas{max-width:100%;box-shadow:0 1px 8px rgba(0,0,0,.4);background:#fff}' +
      '.opf-dv-error{color:#fde2e2;background:#3a2222;border:1px solid #6b3a3a;border-radius:8px;padding:18px 22px;font:600 14px system-ui;max-width:520px;text-align:center}' +
      '.opf-dv-loading{color:#aeb4bd;font:600 14px system-ui;padding:40px}';
    doc.head.appendChild(s);
  }

  function ensureModal() {
    var bd = doc.querySelector('.opf-dv-backdrop');
    if (bd) return bd;
    injectStyles();
    bd = doc.createElement('div');
    bd.className = 'opf-dv-backdrop hidden';
    bd.innerHTML =
      '<div class="opf-dv-bar">' +
        '<span class="opf-dv-title"></span>' +
        '<span class="opf-dv-page"></span>' +
        '<button class="opf-dv-zoom-out" title="Zoom out">−</button>' +
        '<button class="opf-dv-zoom-fit" title="Fit width">Fit</button>' +
        '<button class="opf-dv-zoom-in" title="Zoom in">+</button>' +
        '<a class="opf-dv-download" download>Download</a>' +
        '<button class="opf-dv-close" title="Close (Esc)">✕</button>' +
      '</div>' +
      '<div class="opf-dv-body"></div>';
    doc.body.appendChild(bd);
    bd.querySelector('.opf-dv-close').addEventListener('click', close);
    bd.addEventListener('mousedown', function (e) { if (e.target === bd) close(); });
    bd.querySelector('.opf-dv-zoom-in').addEventListener('click', function () { setScale(state.scale * 1.25); });
    bd.querySelector('.opf-dv-zoom-out').addEventListener('click', function () { setScale(state.scale / 1.25); });
    bd.querySelector('.opf-dv-zoom-fit').addEventListener('click', function () { setScale(1); });
    if (!doc.__opfDvKeyBound) {
      doc.__opfDvKeyBound = true;
      doc.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !bd.classList.contains('hidden')) close();
      });
    }
    return bd;
  }

  function bodyEl() { return doc.querySelector('.opf-dv-body'); }

  function showError(msg) {
    var b = bodyEl();
    if (!b) return;
    b.innerHTML = '';
    var e = doc.createElement('div');
    e.className = 'opf-dv-error';
    e.textContent = msg || 'Could not display this document.';
    b.appendChild(e);
  }

  function setScale(s) {
    state.scale = Math.max(0.25, Math.min(s, 5));
    if (state.kind === 'image') {
      var img = bodyEl().querySelector('img');
      if (img) img.style.width = (state.scale * 100) + '%';
    } else if (state.kind === 'pdf' && state.pdf) {
      renderPdf(state.pdf); // re-render at new scale (defined in Task 3)
    }
  }

  function detectKind(blobType, mime, url) {
    var t = (mime || blobType || '').toLowerCase();
    if (t.indexOf('pdf') !== -1) return 'pdf';
    if (t.indexOf('image/') === 0) return 'image';
    var u = (url || '').toLowerCase().split('?')[0];
    if (/\.pdf$/.test(u)) return 'pdf';
    if (/\.(png|jpe?g|gif|webp|bmp)$/.test(u)) return 'image';
    return 'image';
  }

  var WORKER_SRC = 'https://app.operfi.com/pdfjs/pdf.worker.min.js';
  function wireWorker() {
    if (global.pdfjsLib && global.pdfjsLib.GlobalWorkerOptions &&
        !global.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      global.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_SRC;
    }
  }

  function open(opts) {
    opts = opts || {};
    var bd = ensureModal();
    wireWorker();
    bd.classList.remove('hidden');
    state.scale = 1; state.pdf = null; state.kind = null;
    bd.querySelector('.opf-dv-title').textContent = opts.filename || 'Document';
    bodyEl().innerHTML = '<div class="opf-dv-loading">Loading…</div>';
    var dl = bd.querySelector('.opf-dv-download');
    dl.removeAttribute('href');
    if (opts.filename) dl.setAttribute('download', opts.filename);

    global.fetch(opts.url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.blob();
    }).then(function (blob) {
      if (state.objectUrl) global.URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = global.URL.createObjectURL(blob);
      dl.setAttribute('href', state.objectUrl);
      state.kind = detectKind(blob.type, opts.mime, opts.url);
      if (state.kind === 'image') return renderImage(state.objectUrl);
      return blob.arrayBuffer().then(renderPdfBytes);
    }).catch(function () {
      showError('Could not display this document. Use Download to save it instead.');
    });
  }

  function renderImage(objectUrl) {
    var b = bodyEl();
    b.innerHTML = '';
    var img = doc.createElement('img');
    img.src = objectUrl;
    img.alt = 'Document';
    b.appendChild(img);
  }

  function renderPdfBytes(arrayBuffer) {
    if (!global.pdfjsLib) { showError('Document viewer failed to load.'); return; }
    global.pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise
      .then(function (pdf) { state.pdf = pdf; renderPdf(pdf); })
      .catch(function () { showError('Could not display this PDF. Use Download to save it instead.'); });
  }

  function renderPdf(pdf) {
    var b = bodyEl();
    b.innerHTML = '';
    var pageEl = doc.querySelector('.opf-dv-page');
    if (pageEl) pageEl.textContent = pdf.numPages + (pdf.numPages === 1 ? ' page' : ' pages');
    var chain = Promise.resolve();
    var _loop = function (n) {
      chain = chain.then(function () {
        return pdf.getPage(n).then(function (page) {
          var viewport = page.getViewport({ scale: state.scale });
          var canvas = doc.createElement('canvas');
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          b.appendChild(canvas);
          return page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
        });
      });
    };
    for (var n = 1; n <= pdf.numPages; n++) _loop(n);
  }

  function close() {
    var bd = doc.querySelector('.opf-dv-backdrop');
    if (bd) bd.classList.add('hidden');
    if (state.objectUrl) { global.URL.revokeObjectURL(state.objectUrl); state.objectUrl = null; }
    state.pdf = null; state.kind = null;
    var b = bodyEl(); if (b) b.innerHTML = '';
  }

  global.OperFiDocViewer = { open: open, close: close };
})(typeof window !== 'undefined' ? window : this);
