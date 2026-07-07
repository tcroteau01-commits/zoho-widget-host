import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../noa-management.html', import.meta.url), 'utf8');

const STATUS = { allow_add_carrier: false, total_carriers: 2, carriers: [
  { vendor_id: '1001', carrier_name: 'ROADWAY EXPRESS', mc: '89765', dot: '897123',
    factoring_company: 'Triumph', pay_term: 'Factoring Company',
    submission_type: 'NOA Update', submitted_at: '10-May-2026 09:00:00',
    doc_on_file: { record_id: 'n1', type: 'NOA Update', has_doc: true,
      docs: [{ field: 'NOA_or_LOR_Upload', label: 'NOA', filename: 'n1.pdf' }] }, status: 'verified' },
  { vendor_id: '1002', carrier_name: 'MIDWEST HAUL', mc: '774120', dot: '2891044',
    factoring_company: '', pay_term: 'Factoring Company',
    submission_type: 'LOR Update', submitted_at: '12-May-2026 09:00:00',
    doc_on_file: null, status: 'verifying' },
]};

export function makeWidget() {
  const addCalls = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/noa-management.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: {
        UTIL: { getInitParams: () => new Promise(() => {}) },
        DATA: { addRecords: (a) => { addCalls.push(a); return Promise.resolve({ code: 3000, result: [{ ID: 'rec_1' }] }); } },
      }};
      window.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
    }
  });
  return { window: dom.window, addCalls };
}

test('renderStatusList renders a row per carrier with status chip and doc link', () => {
  const { window } = makeWidget();
  window.renderStatusList(STATUS);
  const rows = window.document.querySelectorAll('#view-list .tbl tbody tr');
  assert.equal(rows.length, 2);
  // Type column shows submission_type
  assert.match(rows[0].textContent, /NOA Update/);
  assert.match(rows[1].textContent, /LOR Update/);
  // doc link exists on the verified (has_doc) row
  assert.ok(rows[0].querySelector('.doc-link'));
});

test('doc cell renders one viewer link per doc and opens the shared viewer with the right field', () => {
  const { window } = makeWidget();
  window.brokerEmail = 'admin@operfi.com';
  const opened = [];
  window.OperFiDocViewer = { open: (o) => opened.push(o) };
  const TWO = { allow_add_carrier: false, total_carriers: 1, carriers: [
    { vendor_id: '1', carrier_name: 'FC CHANGE CO', mc: '1', dot: '1',
      factoring_company: 'New Factor', pay_term: 'Factoring Company',
      submission_type: 'Factoring Company Change', submitted_at: '10-May-2026 09:00:00',
      status: 'pending',
      doc_on_file: { record_id: 'r9', type: 'Factoring Company Change', has_doc: true, docs: [
        { field: 'NOA_or_LOR_Upload', label: 'LOR', filename: 'release.pdf' },
        { field: 'New_NOA', label: 'NOA', filename: 'newnoa.pdf' },
      ] } },
  ]};
  window.renderStatusList(TWO);
  const links = window.document.querySelectorAll('#view-list .tbl tbody tr .doc-link');
  assert.equal(links.length, 2);
  assert.equal(links[0].textContent.replace(/[^A-Z]/g, ''), 'LOR');
  assert.equal(links[1].textContent.replace(/[^A-Z]/g, ''), 'NOA');
  links[0].click();
  assert.equal(opened.length, 1);
  assert.match(opened[0].url, /record_id=r9/);
  assert.match(opened[0].url, /field=NOA_or_LOR_Upload/);
  assert.doesNotMatch(opened[0].url, /impersonate=/); // viewer's fetch wrapper adds it
});

test('initial table shows a loading placeholder, not hardcoded carrier rows', () => {
  const { window } = makeWidget();
  const rows = window.document.querySelectorAll('#view-list .tbl tbody tr');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /Loading/i);
  // none of the old mockup carriers are baked into the markup
  assert.doesNotMatch(window.document.body.textContent, /BLUE RIDGE FREIGHT|ILTS LOGISTICS/);
});

test('empty carrier list renders an empty-state row, not a blank table', () => {
  const { window } = makeWidget();
  window.renderStatusList({ allow_add_carrier: false, total_carriers: 0, carriers: [] });
  const rows = window.document.querySelectorAll('#view-list .tbl tbody tr');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /No carriers on file yet/i);
});

test('_acquireNoaTarget recovers vendorId from sessionStorage on reload', () => {
  const { window } = makeWidget();
  window.localStorage.clear();
  window.sessionStorage.setItem('noaManagementVendorId', 'v_77');
  const t = window._acquireNoaTarget();
  assert.equal(t.vendorId, 'v_77');
});

test('gated Add New Carrier card is hidden unless allow_add_carrier', () => {
  const { window } = makeWidget();
  window.applyGating(STATUS);                       // allow_add_carrier:false
  const gated = window.document.querySelector('.type-card.gated-card');
  assert.equal(gated.classList.contains('hidden'), true);
  window.applyGating(Object.assign({}, STATUS, { allow_add_carrier: true }));
  assert.equal(gated.classList.contains('hidden'), false);
});

test('showOnFile renders the currently-on-file guard from the carrier', () => {
  const { window } = makeWidget();
  window.statusPayload = STATUS;
  window.showOnFile(STATUS.carriers[0]);
  const onfile = window.document.querySelector('.onfile');
  assert.match(onfile.textContent, /Triumph/);
  assert.match(onfile.textContent, /Factoring Company/);
});

test('on-file panel shows factoring, pay term, and banking when present', () => {
  const { window } = makeWidget();
  window.showOnFile({
    factoring_company: 'Triumph Business Capital', pay_term: 'Factoring Company',
    bank_name: 'Wells Fargo', name_on_account: 'ROADWAY EXPRESS',
    account_last4: '****8421', routing_number: '121000248'
  });
  const t = window.document.getElementById('noa-onfile').textContent;
  assert.match(t, /Triumph Business Capital/);
  assert.match(t, /Factoring Company/);
  assert.match(t, /Wells Fargo/);
  assert.match(t, /\*\*\*\*8421/);
  assert.match(t, /121000248/);
  assert.equal(window.document.getElementById('noa-onfile').classList.contains('hidden'), false);
});

test('on-file panel omits banking rows when not present (factoring only)', () => {
  const { window } = makeWidget();
  window.showOnFile({ factoring_company: 'OTR Solutions', pay_term: 'Quick Pay' });
  const t = window.document.getElementById('noa-onfile').textContent;
  assert.match(t, /OTR Solutions/);
  assert.doesNotMatch(t, /Bank Name/);
});

// Bug: LOR Update has no Factoring Company dropdown (the carrier's existing
// factor is shown read-only), so buildNoaPayload has no selection to read from.
// showOnFile must capture the current factor's Creator ID off the on-file
// panel the same way it already captures selectedPayTerm.
test('showOnFile captures the current factor id for LOR Update to submit later', () => {
  const { window } = makeWidget();
  window.showOnFile({ factoring_company: 'Triumph Business Capital', factoring_company_id: 'f1', pay_term: 'Factoring Company' });
  assert.equal(window.selectedFactoringCompanyId, 'f1');
});

// The Vendor record's Factoring_Company is a plain-text display name, not a
// lookup -- All_Vendors never carries a usable Creator ID for it. Fall back to
// matching the carrier's factor name against the already-loaded
// /factoring-companies list (fetched for the assign-role dropdowns anyway) so
// LOR Update still gets a usable id even when the backend can't supply one.
test('showOnFile resolves the factor id by name when the backend has no id', async () => {
  const { window } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.fetch = () => Promise.resolve({ json: () => Promise.resolve({ companies: [
    { id: 'f9', name: 'Triumph Business Capital' },
    { id: 'f2', name: 'OTR Solutions' },
  ] }) });
  await window.loadFactoringCompanies();
  window.showOnFile({ factoring_company: 'Triumph Business Capital', pay_term: 'Factoring Company' });
  assert.equal(window.selectedFactoringCompanyId, 'f9');
});

test('opening the form defaults to NOA Update so Submission_Type is always set', () => {
  const { window } = makeWidget();
  window.selectedType = null;
  window.selectedVendorId = null;
  window.showForm();
  assert.equal(window.selectedType, 'NOA Update');
  assert.equal(window.document.getElementById('sec-factoring').classList.contains('hidden'), false);
});

test('selectType LOR shows bank fields; NOA hides them', () => {
  const { window } = makeWidget();
  window.selectType('LOR Update');
  assert.equal(window.document.getElementById('noa-bank-fields').classList.contains('hidden'), false);
  window.selectType('NOA Update');
  assert.equal(window.document.getElementById('noa-bank-fields').classList.contains('hidden'), true);
});

test('openSubmitFor switches to the form view, sets the vendor, and shows on-file', () => {
  const { window } = makeWidget();
  window.statusPayload = STATUS;
  window.openSubmitFor('1001');
  assert.equal(window.selectedVendorId, '1001');
  assert.equal(window.document.getElementById('view-form').classList.contains('hidden'), false);
  assert.match(window.document.querySelector('.onfile').textContent, /Triumph/);
});

test('submitNoa builds the ADD payload without private fields', async () => {
  const { window, addCalls } = makeWidget();
  window.statusPayload = STATUS;
  window.selectedType = 'NOA Update';
  window.selectedVendorId = '1001';
  window.selectedFactoringId = 'fc_9';
  window.selectedDocFile = new window.File(['x'], 'noa.pdf', { type: 'application/pdf' });
  await window.submitNoa();
  assert.equal(addCalls.length, 1);
  assert.equal(addCalls[0].form_name, 'NOA_LOR_Updates');
  const d = addCalls[0].payload.data;
  assert.equal(d.Submission_Type, 'NOA Update');
  assert.equal(d.Carrier_Name_MC_or_DOT, '1001');
  assert.equal(d.Factoring_Company, 'fc_9');
  assert.ok(!('FV_Client_ID' in d));   // private, derived server-side
  assert.ok(!('DOT' in d));            // private, derived server-side
});

test('runEngine posts the new record id to /noa-submit', async () => {
  const { window } = makeWidget();
  const calls = [];
  window.fetch = (u, opts) => { calls.push([u, opts]); return Promise.resolve({ json: () => Promise.resolve({ ok: true }) }); };
  window.brokerEmail = 'broker@op.com';
  await window.runEngine('rec_42');
  assert.match(calls[0][0], /\/noa-submit/);
  const sent = JSON.parse(calls[0][1].body);
  assert.equal(sent.record_id, 'rec_42');
  assert.equal(sent.email, 'broker@op.com');
});

test('runEngine no-ops without a recordId', async () => {
  const { window } = makeWidget();
  let called = false;
  window.fetch = () => { called = true; return Promise.resolve({ json: () => Promise.resolve({}) }); };
  await window.runEngine('');
  assert.equal(called, false);
});

test('submitNoa surfaces an addRecords failure instead of faking success', async () => {
  const { window } = makeWidget();
  window.ZOHO.CREATOR.DATA.addRecords = function () {
    return Promise.resolve({ code: 3002, message: 'Mandatory column value not found: NOA or LOR Upload' });
  };
  window.brokerEmail = 'b@op.com';
  window.statusPayload = { carriers: [] };
  window.selectedType = 'NOA Update';
  window.selectedVendorId = '1001';
  window.selectedDocFile = { name: 'noa.pdf' };
  await window.submitNoa();
  assert.match(window.document.getElementById('noa-submit-feedback').textContent, /failed/i);
  assert.equal(window.document.getElementById('view-track').classList.contains('hidden'), true);
});

test('submitNoa surfaces an engine failure (ok:false) instead of success', async () => {
  const { window } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.statusPayload = { carriers: [] };
  window.selectedType = 'NOA Update';
  window.selectedVendorId = '1001';
  window.selectedDocFile = new window.File(['x'], 'noa.pdf', { type: 'application/pdf' });
  window.fetch = function (u) {
    if (/noa-submit/.test(u)) return Promise.resolve({ json: () => Promise.resolve({ ok: false, status: 'Rejected', message: 'Unauthorized' }) });
    return Promise.resolve({ json: () => Promise.resolve({}) });
  };
  await window.submitNoa();
  assert.match(window.document.getElementById('noa-submit-feedback').textContent, /processing failed|Unauthorized/i);
  assert.equal(window.document.getElementById('view-track').classList.contains('hidden'), true);
});

test('renderStatusList sets KPIs from data and shows the truncation banner', () => {
  const { window } = makeWidget();
  const p = { allow_add_carrier: false, total_carriers: 207, truncated: true, carriers: [
    { vendor_id: '1', carrier_name: 'A', mc: '1', dot: '1', factoring_company: 'X', pay_term: 'Factoring Company', submission_type: 'NOA Update', submitted_at: '01-May-2026 08:00:00', doc_on_file: null, status: 'verifying' },
    { vendor_id: '2', carrier_name: 'B', mc: '2', dot: '2', factoring_company: 'Y', pay_term: 'Quick Pay', submission_type: 'NOA Update', submitted_at: '02-May-2026 08:00:00', doc_on_file: {record_id:'n',type:'NOA Update',has_doc:true,docs:[{field:'NOA_or_LOR_Upload',label:'NOA',filename:'n.pdf'}]}, status: 'verified' },
    { vendor_id: '3', carrier_name: 'C', mc: '3', dot: '3', factoring_company: '', pay_term: 'Quick Pay - LOR', submission_type: 'LOR Update', submitted_at: '03-May-2026 08:00:00', doc_on_file: {record_id:'n2',type:'LOR Update',has_doc:true,docs:[{field:'NOA_or_LOR_Upload',label:'LOR',filename:'n2.pdf'}]}, status: 'verifying' },
  ]};
  window.renderStatusList(p);
  assert.equal(window.document.getElementById('kpi-attention').textContent, '0');    // needs-attention count
  assert.equal(window.document.getElementById('kpi-pending').textContent, '0');      // pending count (statuses are verifying/verified, not pending)
  assert.equal(window.document.getElementById('kpi-verified').textContent, '1');     // verified count
  const banner = window.document.getElementById('noa-trunc-banner');
  assert.equal(banner.classList.contains('hidden'), false);
  assert.match(banner.textContent, /207/);
});

test('renderStatusList hides the banner when not truncated', () => {
  const { window } = makeWidget();
  window.renderStatusList({ allow_add_carrier:false, total_carriers:2, truncated:false, carriers: STATUS.carriers });
  assert.equal(window.document.getElementById('noa-trunc-banner').classList.contains('hidden'), true);
  assert.equal(window.document.getElementById('kpi-verified').textContent, '1');
});

test('openSubmitFor fills the carrier search box and sets the vendor', () => {
  const { window } = makeWidget();
  window.statusPayload = STATUS;
  window.renderStatusList(STATUS);
  window.openSubmitFor('1002');
  assert.match(window.document.getElementById('noa-carrier-search').value, /MIDWEST HAUL/);
  assert.equal(window.selectedVendorId, '1002');
});

test('loadFactoringCompanies populates the factoring dropdown', async () => {
  const { window } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.fetch = () => Promise.resolve({ json: () => Promise.resolve({ companies: [
    { id: 'f1', name: 'OTR Solutions' }, { id: 'f2', name: 'Triumph' } ] }) });
  await window.loadFactoringCompanies();
  const sel = window.document.getElementById('noa-factoring-select');
  assert.equal(sel.querySelectorAll('option').length, 3); // default + 2
  assert.match(sel.textContent, /OTR Solutions/);
});

test('Verified filter shows only verified carriers', () => {
  const { window } = makeWidget();
  window.statusPayload = STATUS;
  window.renderStatusList(STATUS);
  window.activeFilter = 'verified';
  window.applyCarrierFilters();
  const rows = window.document.querySelectorAll('#view-list .tbl tbody tr');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /ROADWAY/);
});

test('renders the new status chips from worklist data', () => {
  const { window } = makeWidget();
  window.renderStatusList({ total_carriers: 3, carriers: [
    { vendor_id: '1', carrier_name: 'A', mc: '1', dot: '1', pay_term: 'Factoring Company',
      doc_on_file: null, status: 'noa_needed' },
    { vendor_id: '2', carrier_name: 'B', mc: '2', dot: '2', pay_term: 'Quick Pay',
      doc_on_file: null, status: 'pending' },
    { vendor_id: '3', carrier_name: 'C', mc: '3', dot: '3', pay_term: 'Factoring Company',
      doc_on_file: null, status: 'verified' },
  ]});
  const text = window.document.querySelector('#view-list .tbl tbody').textContent;
  assert.match(text, /NOA Needed/);
  assert.match(text, /Pending/);
  assert.match(text, /Verified/);
});

test('KPIs count needs-attention, pending, verified', () => {
  const { window } = makeWidget();
  window.renderStatusList({ total_carriers: 4, carriers: [
    { vendor_id: '1', carrier_name: 'A', status: 'noa_needed', doc_on_file: null },
    { vendor_id: '2', carrier_name: 'B', status: 'bank_doc', doc_on_file: null },
    { vendor_id: '3', carrier_name: 'C', status: 'pending', doc_on_file: null },
    { vendor_id: '4', carrier_name: 'D', status: 'verified', doc_on_file: null },
  ]});
  assert.equal(window.document.getElementById('kpi-attention').textContent, '2');
  assert.equal(window.document.getElementById('kpi-pending').textContent, '1');
  assert.equal(window.document.getElementById('kpi-verified').textContent, '1');
});

test('Needs Attention filter shows only hold statuses', () => {
  const { window } = makeWidget();
  window.statusPayload = { carriers: [
    { vendor_id: '1', carrier_name: 'A', status: 'noa_needed', doc_on_file: null },
    { vendor_id: '2', carrier_name: 'B', status: 'verified', doc_on_file: null },
  ]};
  window.activeFilter = 'attention';
  window.applyCarrierFilters();
  const rows = window.document.querySelectorAll('#view-list .tbl tbody tr');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /A/);
});

test('search filters carriers by name', () => {
  const { window } = makeWidget();
  window.statusPayload = STATUS;
  window.renderStatusList(STATUS);
  window.searchTerm = 'roadway';
  window.applyCarrierFilters();
  const rows = window.document.querySelectorAll('#view-list .tbl tbody tr');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /ROADWAY/);
});

test('carrier combobox loads from /tms-carriers (not /noa-carriers)', async () => {
  const { window } = makeWidget();
  window.brokerEmail = 'b@op.com';
  const calls = [];
  window.fetch = (u) => {
    calls.push(u);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ carriers: [
      { vendor_id: '1001', carrier_name: 'ROADWAY EXPRESS', mc: '89765', dot: '897123', payment_terms: 'Factoring Company' }
    ]})});
  };
  await window.loadCarriers();
  assert.ok(calls.some((u) => /\/tms-carriers\?.*email=/.test(u)));
  assert.ok(!calls.some((u) => /\/noa-carriers/.test(u)));
  window.renderNoaCarrierResults('road');
  const results = window.document.getElementById('noa-carrier-list').textContent;
  assert.match(results, /ROADWAY EXPRESS/);
});

test('selecting a combobox result sets the vendor and fills the search box', () => {
  const { window } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.statusPayload = { carriers: [] };
  window.selectCarrier({ vendor_id: '1001', carrier_name: 'ROADWAY EXPRESS', mc: '89765', dot: '897123' });
  assert.equal(window.selectedVendorId, '1001');
  assert.match(window.document.getElementById('noa-carrier-search').value, /ROADWAY EXPRESS/);
  // list hidden after selection
  assert.equal(window.document.getElementById('noa-carrier-list').hidden, true);
});

test('combobox filters client-side without any fetch on keystroke', () => {
  const { window } = makeWidget();
  window._noaCarriers = [
    { vendor_id: '1', carrier_name: 'ROADWAY EXPRESS', mc: '1', dot: '1' },
    { vendor_id: '2', carrier_name: 'MIDWEST HAUL', mc: '2', dot: '2' },
  ];
  let fetched = false;
  window.fetch = () => { fetched = true; return Promise.resolve({ json: () => Promise.resolve({carriers:[]}) }); };
  window.renderNoaCarrierResults('road');
  assert.equal(fetched, false);
  const opts = window.document.querySelectorAll('#noa-carrier-list .combo-opt');
  assert.equal(opts.length, 1);
  assert.match(opts[0].textContent, /ROADWAY/);
});

test('selectType NOA Update shows factoring + upload, hides bank/new-factor/usdot', () => {
  const { window } = makeWidget();
  window.selectType('NOA Update');
  const hidden = (id) => window.document.getElementById(id).classList.contains('hidden');
  assert.equal(hidden('sec-factoring'), false);
  assert.equal(hidden('sec-upload'), false);
  assert.equal(hidden('noa-bank-fields'), true);
  assert.equal(hidden('noa-new-factor'), true);
  assert.equal(hidden('noa-usdot-search'), true);
});

// Bug: the "Choose this option if the carrier originally selected Quick Pay or
// their NOA was not correct" note is NOA-Update-specific guidance, but it was
// static HTML with no type-conditional logic -- it showed for every type.
test('type-note (NOA-Update-specific guidance) only shows for NOA Update', () => {
  const { window } = makeWidget();
  const hidden = () => window.document.getElementById('type-note').classList.contains('hidden');
  window.selectType('NOA Update');
  assert.equal(hidden(), false);
  window.selectType('LOR Update');
  assert.equal(hidden(), true);
  window.selectType('Factoring Company Change');
  assert.equal(hidden(), true);
  window.selectType('Add New Carrier');
  assert.equal(hidden(), true);
});

test('selectType Factoring Company Change shows new-factor only (no duplicate factoring/upload)', () => {
  const { window } = makeWidget();
  window.selectType('Factoring Company Change');
  const hidden = (id) => window.document.getElementById(id).classList.contains('hidden');
  assert.equal(hidden('noa-new-factor'), false);
  assert.equal(hidden('sec-factoring'), true);
  assert.equal(hidden('sec-upload'), true);
  assert.equal(hidden('sec-carrier'), false);
});

test('selectType Add New Carrier hides the existing-carrier search, shows USDOT lookup', () => {
  const { window } = makeWidget();
  window.selectType('Add New Carrier');
  assert.equal(window.document.getElementById('sec-carrier').classList.contains('hidden'), true);
  assert.equal(window.document.getElementById('noa-usdot-search').classList.contains('hidden'), false);
});

test('on-file panel is hidden until a carrier is selected, then shows real data', () => {
  const { window } = makeWidget();
  assert.equal(window.document.getElementById('noa-onfile').classList.contains('hidden'), true);
  window.showOnFile({ factoring_company: 'OTR Solutions', pay_term: 'Factoring Company' });
  const onfile = window.document.getElementById('noa-onfile');
  assert.equal(onfile.classList.contains('hidden'), false);
  assert.match(onfile.textContent, /OTR Solutions/);
  assert.doesNotMatch(onfile.textContent, /Triumph|Wells Fargo/);  // no mockup
});

test('worklist row shows the linked date', () => {
  const { window } = makeWidget();
  window.renderStatusList({ total_carriers: 1, carriers: [
    { vendor_id: '1', carrier_name: 'A', mc: '1', dot: '2', status: 'noa_needed', doc_on_file: null, linked_date: '15-Mar-2024 09:00:00' }
  ]});
  assert.match(window.document.querySelector('#view-list .tbl tbody').textContent, /Linked Mar 2024/);
});

test('buildNoaPayload includes LOR bank fields', () => {
  const { window } = makeWidget();
  window.selectedType = 'LOR Update';
  window.selectedVendorId = '1001';
  window.document.getElementById('lor-bank-name').value = 'Wells Fargo';
  window.document.getElementById('lor-account-number').value = '8421';
  window.document.getElementById('lor-routing-number').value = '121000248';
  window.document.getElementById('lor-business-name').value = 'ROADWAY EXPRESS';
  const d = window.buildNoaPayload();
  assert.equal(d.Bank_Name, 'Wells Fargo');
  assert.equal(d.Account_Number, '8421');
  assert.equal(d.Routing_Number, '121000248');
  assert.equal(d.Business_Name_Listed_on_Account, 'ROADWAY EXPRESS');
});

test('LOR "No bank" hides inputs, shows note, payload sends Bank_Document_Upload=No without bank fields', () => {
  const { window } = makeWidget();
  window.selectType('LOR Update');
  window.selectedType = 'LOR Update';
  window.selectedVendorId = '1001';
  window.setLorBankChoice('no');
  assert.equal(window.document.getElementById('lor-bank-inputs').classList.contains('hidden'), true);
  assert.equal(window.document.getElementById('lor-paylink-note').classList.contains('hidden'), false);
  const d = window.buildNoaPayload();
  assert.equal(d.Bank_Document_Upload, 'No');
  assert.ok(!('Bank_Name' in d));
});

test('LOR "Yes bank" shows inputs and payload includes bank fields + Bank_Document_Upload=Yes', () => {
  const { window } = makeWidget();
  window.selectType('LOR Update');
  window.selectedType = 'LOR Update';
  window.selectedVendorId = '1001';
  window.setLorBankChoice('yes');
  window.document.getElementById('lor-bank-name').value = 'Wells Fargo';
  assert.equal(window.document.getElementById('lor-bank-inputs').classList.contains('hidden'), false);
  const d = window.buildNoaPayload();
  assert.equal(d.Bank_Document_Upload, 'Yes');
  assert.equal(d.Bank_Name, 'Wells Fargo');
});

test('buildNoaPayload includes USDOT_Search for Add New Carrier', () => {
  const { window } = makeWidget();
  window.selectedType = 'Add New Carrier';
  window.newCarrierLookup = { carrier: { dot_number: '3899999', carrier_name: 'TEST CARRIER' }, existing_vendor: null };
  const d = window.buildNoaPayload();
  assert.equal(d.USDOT_Search, '3899999');
});

test('submitNoa uploads the doc to /upload-doc then runs the engine', async () => {
  const { window, addCalls } = makeWidget();
  const calls = [];
  window.fetch = (u, opts) => { calls.push([u, opts]); return Promise.resolve({ json: () => Promise.resolve({ code: 3000 }) }); };
  window.brokerEmail = 'b@op.com';
  window.statusPayload = { carriers: [] };
  window.selectedType = 'NOA Update';
  window.selectedVendorId = '1001';
  window.selectedFactoringId = 'fc_9';
  window.selectedDocFile = window.File
    ? new window.File(['x'], 'noa.pdf', { type: 'application/pdf' })
    : Object.assign(new window.Blob(['x'], { type: 'application/pdf' }), { name: 'noa.pdf' });
  await window.submitNoa();
  assert.equal(addCalls.length, 1);
  const up = calls.find((c) => /\/upload-doc/.test(c[0]));
  assert.ok(up, 'expected an /upload-doc POST');
  const eng = calls.find((c) => /\/noa-submit/.test(c[0]));
  assert.ok(eng, 'expected the engine call after upload');
});

test('submitNoa blocks and prompts for a document when none is attached (NOA Update)', async () => {
  const { window, addCalls } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.statusPayload = { carriers: [] };
  window.selectedType = 'NOA Update';
  window.selectedVendorId = '1001';
  window.selectedDocFile = null;
  window.selectedNewNoaFile = null;
  await window.submitNoa();
  assert.match(window.document.getElementById('noa-submit-feedback').textContent, /attach the NOA/i);
  assert.equal(addCalls.length, 0);   // never reached the create call
});

test('submitNoa LOR with no document prompts for the LOR doc', async () => {
  const { window, addCalls } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.statusPayload = { carriers: [] };
  window.selectedType = 'LOR Update';
  window.selectedVendorId = '1001';
  window.selectedDocFile = null;
  await window.submitNoa();
  assert.match(window.document.getElementById('noa-submit-feedback').textContent, /attach the LOR/i);
  assert.equal(addCalls.length, 0);
});

test('submitNoa Factoring Company Change requires the New NOA file specifically', async () => {
  const { window, addCalls } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.statusPayload = { carriers: [] };
  window.selectedType = 'Factoring Company Change';
  window.selectedVendorId = '1001';
  window.selectedLorFile = { name: 'release.pdf' };   // LOR present, so the NOA check is what blocks
  window.selectedNewNoaFile = null;
  await window.submitNoa();
  assert.match(window.document.getElementById('noa-submit-feedback').textContent, /attach the (New )?NOA/i);
  assert.equal(addCalls.length, 0);
});

test('Factoring Company Change requires the LOR as well as the New NOA', async () => {
  const { window, addCalls } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.statusPayload = { carriers: [] };
  window.selectedType = 'Factoring Company Change';
  window.selectedVendorId = '1001';
  window.selectedNewNoaFile = { name: 'newnoa.pdf' };
  window.selectedLorFile = null;
  await window.submitNoa();
  assert.match(window.document.getElementById('noa-submit-feedback').textContent, /LOR/i);
  assert.equal(addCalls.length, 0);
});

test('Factoring Company Change uploads LOR and New NOA sequentially to the right fields', async () => {
  const { window } = makeWidget();
  window.brokerEmail = 'b@op.com';
  const posts = [];
  let resolveCount = 0;
  window.fetch = (url, opts) => {
    if (typeof url === 'string' && url.indexOf('/upload-doc') !== -1) {
      const fd = opts.body;
      posts.push({ field: fd.get('field_name'), name: (fd.get('file') || {}).name,
                   order: ++resolveCount });
      return Promise.resolve({ json: () => Promise.resolve({ code: 3000 }) });
    }
    if (typeof url === 'string' && url.indexOf('/noa-submit') !== -1) {
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    }
    return Promise.resolve({ json: () => Promise.resolve({}) });
  };
  window.selectedType = 'Factoring Company Change';
  window.selectedVendorId = '1001';
  window.selectedNewFactoringId = 'f2';
  window.selectedLorFile = new window.File(['x'], 'release.pdf');
  window.selectedNewNoaFile = new window.File(['x'], 'newnoa.pdf');
  await window.submitNoa();
  const byField = {};
  posts.forEach(p => { byField[p.field] = p; });
  assert.equal(byField['NOA_or_LOR_Upload'].name, 'release.pdf');
  assert.equal(byField['New_NOA'].name, 'newnoa.pdf');
  // sequential: LOR completes before New NOA starts (LOR order < NOA order)
  assert.ok(byField['NOA_or_LOR_Upload'].order < byField['New_NOA'].order);
});

test('resetSelectedFiles clears the LOR dropzone state and keeps its LOR label', () => {
  const { window } = makeWidget();
  window.selectedLorFile = { name: 'release.pdf' };
  const z = window.document.getElementById('dropzone-lor');
  z.classList.add('has-file');
  z.querySelector('.dropzone-text').textContent = 'release.pdf';
  window.resetSelectedFiles();
  assert.equal(window.selectedLorFile, null);
  assert.equal(z.classList.contains('has-file'), false);
  assert.match(z.querySelector('.dropzone-text').textContent, /LOR/);
});

test('Factoring Company Change form exposes an LOR dropzone wired to selectedLorFile', () => {
  const { window } = makeWidget();
  assert.ok(window.document.getElementById('dropzone-lor'), 'dropzone-lor exists');
  assert.ok(window.document.getElementById('file-lor'), 'file-lor input exists');
  window.wireForm();
  const input = window.document.getElementById('file-lor');
  const f = { name: 'release.pdf' };
  Object.defineProperty(input, 'files', { value: [f], configurable: true });
  input.onchange();
  assert.equal(window.selectedLorFile, f);
});

// ── Carrier combobox: mirror Load Details (client-side filter on /tms-carriers) ──
const TMS_CARRIERS = { carriers: [
  { vendor_id: '2001', carrier_name: 'BIG SKY HAULING', mc: '1519382', dot: '4025383', payment_terms: 'Factoring Company' },
  { vendor_id: '2002', carrier_name: 'TRIPLE H HAULING', mc: '1447214', dot: '3916310', payment_terms: 'Quick Pay' },
  { vendor_id: '2003', carrier_name: 'ACME FREIGHT', mc: '999111', dot: '222333', payment_terms: 'Factoring Company' },
] };

test('loadCarriers populates window._noaCarriers from /tms-carriers', async () => {
  const { window } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(TMS_CARRIERS) });
  await window.loadCarriers();
  assert.equal((window._noaCarriers || []).length, 3);
  assert.equal(window._noaCarriers[0].carrier_name, 'BIG SKY HAULING');
});

test('renderNoaCarrierResults filters client-side by name, MC, and DOT', () => {
  const { window } = makeWidget();
  window._noaCarriers = TMS_CARRIERS.carriers;
  // by name
  window.renderNoaCarrierResults('haul');
  let opts = window.document.querySelectorAll('#noa-carrier-list .combo-opt');
  assert.equal(opts.length, 2);
  assert.match(opts[0].querySelector('.co-name').textContent, /BIG SKY HAULING/);
  assert.match(opts[0].querySelector('.co-sub').textContent, /MC 1519382/);
  // by MC
  window.renderNoaCarrierResults('999111');
  opts = window.document.querySelectorAll('#noa-carrier-list .combo-opt');
  assert.equal(opts.length, 1);
  assert.match(opts[0].querySelector('.co-name').textContent, /ACME FREIGHT/);
  // by DOT
  window.renderNoaCarrierResults('3916310');
  opts = window.document.querySelectorAll('#noa-carrier-list .combo-opt');
  assert.equal(opts.length, 1);
  assert.match(opts[0].querySelector('.co-name').textContent, /TRIPLE H/);
});

test('selectNoaCarrierFromSearch sets vendor id and fills the search box with the name', () => {
  const { window } = makeWidget();
  window._noaCarriers = TMS_CARRIERS.carriers;
  window.statusPayload = { carriers: [] };
  window.selectNoaCarrierFromSearch('2001');
  assert.equal(window.selectedVendorId, '2001');
  assert.match(window.document.getElementById('noa-carrier-search').value, /BIG SKY HAULING/);
  assert.equal(window.document.getElementById('noa-carrier-list').hidden, true);
});

test('buildNoaPayload flags Widget_Submission so the record-created Flow skips it', () => {
  const { window } = makeWidget();
  window.selectedType = 'NOA Update';
  const d = window.buildNoaPayload();
  assert.equal(d.Widget_Submission, true);
});

test('showList re-fetches the status so a new submission appears without a manual reload', () => {
  const { window } = makeWidget();
  let called = 0;
  window.loadStatus = function () { called++; return Promise.resolve(); };
  window.showList();
  assert.equal(called, 1);
});

test('submit shows a spinner and disables the button while it runs', () => {
  const { window } = makeWidget();
  window.brokerEmail = 'b@op.com';
  window.selectedType = 'NOA Update';
  window.selectedVendorId = '1001';
  window.selectedFactoringId = 'f1';
  window.selectedDocFile = { name: 'noa.pdf' };
  const btn = window.document.getElementById('noa-submit-btn');
  window.submitNoa();                 // async — check the synchronous in-flight state
  assert.equal(btn.disabled, true);
  assert.match(btn.innerHTML, /Submitting/);
  assert.match(btn.innerHTML, /btn-spinner/);
});

test('on-file panel calls out dual authority', () => {
  const { window } = makeWidget();
  window.showOnFile({ authority_class: 'dual', factoring_company: 'F', pay_term: 'Net 30' });
  const html = window.document.getElementById('noa-onfile').innerHTML;
  assert.match(html, /double-broker/i);
});

test('on-file panel shows no authority chip for a carrier', () => {
  const { window } = makeWidget();
  window.showOnFile({ authority_class: 'carrier', factoring_company: 'F', pay_term: 'Net 30' });
  assert.doesNotMatch(window.document.getElementById('noa-onfile').innerHTML, /double-broker|not a carrier/i);
});
