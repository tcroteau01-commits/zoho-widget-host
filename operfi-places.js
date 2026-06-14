/* OperFi address autocomplete — attaches Google Places (via our backend proxy)
 * to a text input. The API key stays server-side; this only calls our endpoints.
 *
 *   OperFiPlaces.attach(inputEl, {
 *     apiBase: BROKER_API_BASE,            // optional; falls back to window.BROKER_API_BASE
 *     email:   function(){ return brokerEmail; },  // string or getter; falls back to window.brokerEmail
 *     onSelect: function(addr){ ... }      // optional; addr = {street,city,state,zip,country,formatted,description}
 *   });                                    // no onSelect -> input.value = addr.formatted
 */
(function (global) {
  function debounce(fn, ms) {
    var t;
    return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); };
  }

  function attach(input, opts) {
    opts = opts || {};
    if (!input || input._opfPlaces) return;
    input.setAttribute('autocomplete', 'off');
    input._opfPlaces = true;

    var apiBase = opts.apiBase || global.BROKER_API_BASE || '';
    var emailOpt = opts.email;
    function getEmail() {
      var e = (typeof emailOpt === 'function') ? emailOpt() : emailOpt;
      return e || global.brokerEmail || '';
    }

    var box = document.createElement('div');
    box.className = 'opf-places-results';
    box.style.cssText = 'position:absolute;z-index:99999;background:#fff;border:1px solid #e6e3da;' +
      'border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.14);max-height:280px;overflow-y:auto;' +
      'display:none;font-size:13px;font-family:inherit;';
    document.body.appendChild(box);

    function position() {
      var r = input.getBoundingClientRect();
      box.style.left = (r.left + window.scrollX) + 'px';
      box.style.top = (r.bottom + window.scrollY + 2) + 'px';
      box.style.width = r.width + 'px';
    }
    function hide() { box.style.display = 'none'; box.innerHTML = ''; }

    var run = debounce(function () {
      var q = (input.value || '').trim();
      if (q.length < 3 || !apiBase) { hide(); return; }
      fetch(apiBase + '/places-autocomplete?email=' + encodeURIComponent(getEmail()) + '&q=' + encodeURIComponent(q))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var list = (d && d.predictions) || [];
          if (!list.length) { hide(); return; }
          box.innerHTML = '';
          list.forEach(function (p) {
            var item = document.createElement('div');
            item.className = 'opf-places-item';
            item.style.cssText = 'padding:9px 12px;cursor:pointer;border-bottom:1px solid #f3f1ea;';
            item.textContent = p.description;
            item.addEventListener('mouseenter', function () { item.style.background = '#faf8f2'; });
            item.addEventListener('mouseleave', function () { item.style.background = '#fff'; });
            // mousedown (not click) so it fires before the input's blur hides the box
            item.addEventListener('mousedown', function (e) { e.preventDefault(); choose(p); });
            box.appendChild(item);
          });
          position();
          box.style.display = '';
        })
        .catch(hide);
    }, 250);

    function choose(p) {
      hide();
      fetch(apiBase + '/place-details?email=' + encodeURIComponent(getEmail()) + '&place_id=' + encodeURIComponent(p.place_id))
        .then(function (r) { return r.json(); })
        .then(function (addr) {
          addr = addr || {};
          addr.description = p.description;
          if (typeof opts.onSelect === 'function') opts.onSelect(addr);
          else input.value = addr.formatted || p.description;
        })
        .catch(function () {
          // details failed — fall back to the prediction text
          if (typeof opts.onSelect === 'function') opts.onSelect({ description: p.description, formatted: p.description });
          else input.value = p.description;
        });
    }

    input.addEventListener('input', run);
    input.addEventListener('blur', function () { setTimeout(hide, 150); });
    window.addEventListener('scroll', function () { if (box.style.display !== 'none') position(); }, true);
  }

  global.OperFiPlaces = { attach: attach };
})(window);
