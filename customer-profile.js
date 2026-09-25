/* OperFi Customer Profile -- the page a credit analyst reads before approving a
 * customer for a credit limit. One payload in, one HTML string out.
 *
 * The engine already decided what it could; a broker's typed name and Creditsafe's
 * candidate list often leave real ambiguity (e.g. two OperFi book rows for the same
 * company). This view says what the engine decided and why, lets the analyst
 * resolve that ambiguity once, then shows what OperFi already knows before
 * anything a credit bureau says.
 *
 *   OperFiCustomerProfile.render(payload) -> htmlString   (pure -- no DOM, no network)
 *   OperFiCustomerProfile.mount(root, payload, handlers)  -> wires the rendered HTML
 *
 * handlers (all optional):
 *   onDecide(decision, limitValue)   -- decision is 'Approved' | 'Denied'
 *   onCsPick(connectId)
 *   onFvPick(companyId)
 *   onCsAbsent()
 *
 * ES5 only: this file is served straight to a browser inside a Creator iframe.
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function money(n) {
  var v = Number(n);
  if (!isFinite(v)) { return '—'; }
  return '$' + Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

var ENGINE_LABELS = { auto_approve: 'Auto-Approve', review_required: 'Review Required' };

function engineLabel(suggested) {
  if (ENGINE_LABELS[suggested]) { return ENGINE_LABELS[suggested]; }
  return suggested ? String(suggested) : 'Unscored';
}

function emptyDash() {
  return '<span class="empty">—</span>';
}

function field(label, valueHtml) {
  return '' +
    '<div class="field">' +
      '<div class="field-label">' + esc(label) + '</div>' +
      '<div class="field-val">' + valueHtml + '</div>' +
    '</div>';
}

function section(title, bodyHtml, extraClass) {
  return '' +
    '<div class="panel-section' + (extraClass ? ' ' + extraClass : '') + '">' +
      '<div class="panel-section-title">' + esc(title) + '</div>' +
      bodyHtml +
    '</div>';
}

// ---- header: customer, broker, status, engine verdict, decision controls ----
function renderHeader(p) {
  var engine = p.engine;
  var verdictHtml;
  if (engine && engine.suggested) {
    var pillClass = engine.suggested === 'auto_approve' ? 'cp-pill-ok' : 'cp-pill-warn';
    verdictHtml = '<span class="cp-pill ' + pillClass + '">' + esc(engineLabel(engine.suggested)) + '</span>';
  } else {
    verdictHtml = '<span class="cp-pill cp-pill-muted">No automated read yet</span>';
  }

  // Tom, 2026-09-25: "Show decision on both." Decision controls live in the
  // header so an analyst who has read the whole page never navigates back to act.
  var decisionHtml = '';
  if (p.can_act) {
    var approveLabel = 'Approved';
    var prefill = '';
    if (engine && engine.suggested === 'auto_approve' && engine.limit != null) {
      var n = Math.round(Number(engine.limit));
      if (isFinite(n)) {
        approveLabel = 'Approve ' + money(n);
        prefill = String(n);
      }
    }
    decisionHtml = '' +
      '<div class="cp-decision-row">' +
        '<button type="button" class="btn primary" data-decide="Approved">' + esc(approveLabel) + '</button>' +
        '<button type="button" class="btn" data-decide="Denied">Denied</button>' +
        '<input type="number" class="dec-input cp-limit-input" id="cp-limit" min="0" step="1" ' +
          'placeholder="Credit limit" value="' + esc(prefill) + '">' +
      '</div>';
  }

  var contactsHtml = '';
  var c = p.contacts;
  if (c) {
    contactsHtml = '' +
      '<div class="field-grid cp-header-contacts">' +
        field('POC', c.poc ? esc(c.poc) : emptyDash()) +
        field('POC Email', c.email ? esc(c.email) : emptyDash()) +
        field('Billing POC', c.billing_poc ? esc(c.billing_poc) : emptyDash()) +
        field('Billing Email', c.billing_email ? esc(c.billing_email) : emptyDash()) +
      '</div>';
  }

  return '' +
    '<div class="cp-header">' +
      '<div class="cp-header-top">' +
        '<div>' +
          '<div class="cp-eyebrow">Credit Submission #' + esc(p.submission_id) + '</div>' +
          '<div class="cp-customer">' + esc(p.customer_name) + '</div>' +
          '<div class="cp-broker">Submitted by ' + esc(p.broker) + '</div>' +
        '</div>' +
        '<div class="cp-header-status">' +
          '<span class="cp-status-pill">' + esc(p.status) + '</span>' +
          verdictHtml +
        '</div>' +
      '</div>' +
      contactsHtml +
      decisionHtml +
    '</div>';
}

// ---- what the engine decided, and why ----
function renderEngine(p) {
  var e = p.engine;
  var body;
  if (!e) {
    body = '<div class="field-val muted">No automated credit read yet.</div>';
  } else {
    var reasonsHtml;
    if (e.reasons && e.reasons.length) {
      reasonsHtml = '<ul class="cp-reasons">' + e.reasons.map(function (r) {
        return '<li>' + esc(r) + '</li>';
      }).join('') + '</ul>';
    } else {
      reasonsHtml = '<div class="field-val muted">No reasons given.</div>';
    }
    body = '' +
      '<div class="field-grid">' +
        field('Suggested', esc(engineLabel(e.suggested))) +
        field('Suggested Limit', e.limit != null ? esc(money(e.limit)) : emptyDash()) +
        field('Engine Version', e.engine_version ? esc(e.engine_version) : emptyDash()) +
        field('Evaluated', e.at ? esc(e.at) : emptyDash()) +
      '</div>' +
      '<div class="cp-reasons-wrap"><div class="field-label">Reasons</div>' + reasonsHtml + '</div>';
  }
  return section('Credit Engine', body);
}

// ---- let the analyst resolve the Creditsafe identity ambiguity ----
function renderIdentity(p) {
  var id = p.identity;
  var body;
  if (id && id.not_in_creditsafe) {
    body = '' +
      '<div class="cp-identity-resolved">' +
        '<span class="cp-badge cp-badge-muted">Not in Creditsafe</span>' +
        (id.bound_by ? '<div class="field-val muted">Marked by ' + esc(id.bound_by) + '</div>' : '') +
      '</div>';
  } else if (id && id.connect_id) {
    body = '' +
      '<div class="field-grid">' +
        field('Creditsafe Connect ID', esc(id.connect_id)) +
        field('FactorView Debtor ID', id.fv_debtor_id ? esc(id.fv_debtor_id) : emptyDash()) +
        field('Bound By', id.bound_by ? esc(id.bound_by) : emptyDash()) +
      '</div>';
  } else {
    var absentBtn = p.can_act
      ? '<button type="button" class="btn" data-cs-absent="1">Not in Creditsafe</button>'
      : '';
    var searchInput = p.can_act
      ? '<input type="text" class="dec-input" id="cp-cs-search" placeholder="Search Creditsafe by company name">'
      : '';
    body = '' +
      '<div class="cp-cs-picker">' +
        '<div class="field-val muted">Creditsafe returned more than one possible match for this name. ' +
          'Confirm the right company, or mark this customer as not present.</div>' +
        '<div class="cp-cs-search-row">' + searchInput + absentBtn + '</div>' +
        '<div id="cp-cs-results" class="cp-cs-results"></div>' +
      '</div>';
  }
  return section('Creditsafe Match', body);
}

// ---- the credit bureau report, once an identity is bound ----
function renderSummary(p) {
  var s = p.summary;
  var body;
  if (!s) {
    body = '<div class="field-val muted">No Creditsafe report on file.</div>';
  } else if (!s.scored) {
    body = '<div class="field-val muted">Creditsafe has not scored this company yet.</div>';
  } else {
    body = '' +
      '<div class="field-grid">' +
        field('Score', s.score != null ? esc(String(s.score)) : emptyDash()) +
        field('Grade', s.grade ? esc(s.grade) : emptyDash()) +
        field('Recommended Limit', s.recommended_limit != null ? esc(money(s.recommended_limit)) : emptyDash()) +
        field('Active Trade Lines', s.active_trade_lines != null ? esc(String(s.active_trade_lines)) : emptyDash()) +
        field('Days Beyond Terms', s.dbt != null ? esc(String(s.dbt)) : emptyDash()) +
        field('Established', s.established_year ? esc(String(s.established_year)) : emptyDash()) +
        field('Address Type', s.address_type ? esc(s.address_type) : emptyDash()) +
      '</div>';
  }
  return section('Credit Report', body);
}

// ---- what OperFi's own book (FactorView) already knows ----
function renderFactorView(p) {
  var body;
  if (p.fv_debtor) {
    var d = p.fv_debtor;
    body = '' +
      '<div class="field-grid">' +
        field('Company', esc(d.name)) +
        field('FactorView ID', esc(d.company_id)) +
        field('Buy Limit', esc(money(d.buy_limit))) +
        field('State', d.state ? esc(d.state) : emptyDash()) +
        field('Active', d.is_active ? 'Yes' : 'No') +
        field('Restricted', d.restricted ? '<span class="cp-badge cp-badge-danger">Restricted</span>' : 'No') +
      '</div>';
  } else if (p.fv_candidates && p.fv_candidates.length) {
    body = '' +
      '<div class="field-val muted">More than one FactorView company could match. Pick the right one.</div>' +
      '<div class="cp-candidates">' +
      p.fv_candidates.map(function (c) {
        var restrictedBadge = c.restricted ? ' <span class="cp-badge cp-badge-danger">Restricted</span>' : '';
        var pickBtn = p.can_act
          ? '<button type="button" class="btn primary" data-fv-pick="' + esc(c.company_id) + '">Use this</button>'
          : '';
        return '' +
          '<div class="cp-candidate-row">' +
            '<div class="cp-candidate-main">' +
              '<div class="cp-candidate-name">' + esc(c.name) + restrictedBadge + '</div>' +
              '<div class="cp-candidate-sub">' + (c.state ? esc(c.state) + ' · ' : '') +
                (c.is_active ? 'Active' : 'Inactive') + '</div>' +
            '</div>' +
            '<div class="cp-candidate-limit">' + esc(money(c.buy_limit)) + '</div>' +
            pickBtn +
          '</div>';
      }).join('') +
      '</div>';
  } else {
    body = '<div class="field-val muted">No FactorView match on file.</div>';
  }
  return section('Our FactorView History', body);
}

// ---- other clients who have submitted this customer before ----
function renderPriors(p) {
  var body;
  if (p.priors_unavailable) {
    body = '<div class="field-val muted">Prior decisions are unavailable right now.</div>';
  } else if (p.priors && p.priors.length) {
    body = '<div class="cp-priors">' + p.priors.map(function (pr) {
      return '' +
        '<div class="cp-prior-row">' +
          '<div class="cp-prior-broker">' + esc(pr.broker) + '</div>' +
          '<div class="cp-prior-limit">' + esc(money(pr.limit)) + '</div>' +
          '<div class="cp-prior-date">' + (pr.decided_at ? esc(pr.decided_at) : emptyDash()) + '</div>' +
        '</div>';
    }).join('') + '</div>';
  } else {
    body = '<div class="field-val muted">No other clients have submitted this customer for credit yet.</div>';
  }
  return section('Other Clients’ Limits', body);
}

function render(payload) {
  var p = payload || {};
  return '' +
    '<div class="cp-root">' +
      renderHeader(p) +
      renderEngine(p) +
      renderIdentity(p) +
      renderSummary(p) +
      renderFactorView(p) +
      renderPriors(p) +
    '</div>';
}

var CP_STYLE_ID = 'opf-cp-styles';
var CP_CSS = '' +
  '.cp-root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;color:#1d1d1f;}' +
  '.panel-section{background:#fff;border:1px solid #e6e3da;border-radius:10px;padding:16px 18px;margin-bottom:12px;}' +
  '.panel-section-title{font-size:11px;text-transform:uppercase;letter-spacing:0.7px;color:#888;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:8px;}' +
  '.panel-section-title::after{content:"";flex:1;height:1px;background:#f0efe9;}' +
  '.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 18px;}' +
  '.field{display:flex;flex-direction:column;gap:3px;}' +
  '.field-label{font-size:11px;color:#999;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;}' +
  '.field-val{font-size:14px;color:#1d1d1f;font-weight:600;word-break:break-word;}' +
  '.field-val.muted{color:#888;font-weight:500;}' +
  '.empty{color:#bbb;font-weight:500;font-style:italic;}' +
  '.btn{background:#fff;border:1px solid #d8d8d8;border-radius:6px;padding:8px 14px;font-size:13px;font-weight:600;color:#444;cursor:pointer;font-family:inherit;transition:all 0.15s;}' +
  '.btn:hover{border-color:#b8b8b8;background:#fafafa;}' +
  '.btn.primary{background:#F97316;color:#fff;border-color:#F97316;}' +
  '.btn.primary:hover{background:#e0650e;border-color:#e0650e;}' +
  '.dec-input{border:1px solid #d8d8d8;border-radius:6px;padding:9px 11px;font-size:13px;font-family:inherit;background:#fafafa;color:#1d1d1f;outline:none;transition:all 0.15s;}' +
  '.dec-input:focus{border-color:#F97316;background:#fff;box-shadow:0 0 0 3px rgba(249,115,22,0.14);}' +
  '.cp-header{background:#1d1d1f;color:#fff;border-radius:10px;padding:20px 22px;margin-bottom:14px;}' +
  '.cp-header-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;}' +
  '.cp-eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:0.7px;color:rgba(255,255,255,0.55);font-weight:700;margin-bottom:4px;}' +
  '.cp-customer{font-size:22px;font-weight:700;letter-spacing:-0.3px;}' +
  '.cp-broker{font-size:13px;color:rgba(255,255,255,0.7);margin-top:4px;}' +
  '.cp-header-status{display:flex;flex-direction:column;align-items:flex-end;gap:8px;}' +
  '.cp-status-pill{display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.2px;text-transform:uppercase;background:rgba(255,255,255,0.14);color:#fff;}' +
  '.cp-pill{display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;}' +
  '.cp-pill-ok{background:#1f6321;color:#e3f4e3;}' +
  '.cp-pill-warn{background:#F97316;color:#fff;}' +
  '.cp-pill-muted{background:rgba(255,255,255,0.12);color:rgba(255,255,255,0.7);}' +
  '.cp-header-contacts{margin-top:16px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.12);}' +
  '.cp-header-contacts .field-label{color:rgba(255,255,255,0.55);}' +
  '.cp-header-contacts .field-val{color:#fff;}' +
  '.cp-decision-row{margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;}' +
  '.cp-limit-input{max-width:160px;}' +
  '.cp-badge{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:8px;margin-left:6px;}' +
  '.cp-badge-danger{background:#fdecea;color:#c62828;}' +
  '.cp-badge-muted{background:#eee;color:#777;}' +
  '.cp-reasons{margin:8px 0 0;padding-left:18px;color:#444;font-size:12px;line-height:1.5;}' +
  '.cp-reasons li{margin:2px 0;}' +
  '.cp-reasons-wrap{margin-top:14px;}' +
  '.cp-cs-search-row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;}' +
  '.cp-cs-search-row input{flex:1;min-width:200px;}' +
  '.cp-cs-results{margin-top:10px;}' +
  '.cp-candidates,.cp-priors{display:flex;flex-direction:column;gap:8px;margin-top:10px;}' +
  '.cp-candidate-row,.cp-prior-row{display:grid;grid-template-columns:1.4fr 1fr auto;gap:10px;align-items:center;padding:10px 12px;background:#fafafa;border:1px solid #f0efe9;border-radius:8px;}' +
  '.cp-candidate-name,.cp-prior-broker{font-size:13px;font-weight:700;color:#1d1d1f;}' +
  '.cp-candidate-sub{font-size:11px;color:#888;margin-top:2px;}' +
  '.cp-candidate-limit,.cp-prior-limit{font-size:14px;font-weight:700;color:#1d1d1f;text-align:right;}' +
  '.cp-prior-date{font-size:11px;color:#888;text-align:right;}' +
  '@media (max-width:640px){.field-grid{grid-template-columns:1fr;}.cp-candidate-row,.cp-prior-row{grid-template-columns:1fr;}.cp-candidate-limit,.cp-prior-date{text-align:left;}}';

function injectStyles() {
  if (typeof document === 'undefined') { return; }
  if (document.getElementById(CP_STYLE_ID)) { return; }
  var s = document.createElement('style');
  s.id = CP_STYLE_ID;
  s.textContent = CP_CSS;
  document.head.appendChild(s);
}

function mount(root, payload, handlers) {
  handlers = handlers || {};
  injectStyles();
  root.innerHTML = render(payload);
  root.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== root) {
      if (t.getAttribute) {
        if (t.hasAttribute('data-decide')) {
          if (handlers.onDecide) {
            var limitEl = root.querySelector('#cp-limit');
            handlers.onDecide(t.getAttribute('data-decide'), limitEl ? limitEl.value : null);
          }
          return;
        }
        if (t.hasAttribute('data-cs-pick')) {
          if (handlers.onCsPick) { handlers.onCsPick(t.getAttribute('data-cs-pick')); }
          return;
        }
        if (t.hasAttribute('data-fv-pick')) {
          if (handlers.onFvPick) { handlers.onFvPick(t.getAttribute('data-fv-pick')); }
          return;
        }
        if (t.hasAttribute('data-cs-absent')) {
          if (handlers.onCsAbsent) { handlers.onCsAbsent(); }
          return;
        }
      }
      t = t.parentNode;
    }
  });
}

if (typeof module !== 'undefined' && module.exports) { module.exports = { render: render, mount: mount, esc: esc, money: money }; }
if (typeof window !== 'undefined') { window.OperFiCustomerProfile = { render: render, mount: mount }; }
