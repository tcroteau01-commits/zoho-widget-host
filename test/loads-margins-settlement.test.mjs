import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../loads-margins.html', import.meta.url), 'utf8');

// Settlement payload as the backend now returns it (build_load_settlement),
// modelled on the real screenshot load (inv 5329 / inv_id 314403).
const PREVIEW = {
  load: {
    loadNumber: '5329', invoiceNo: '5329', buyDate: '2026-06-22', arStatus: 'open',
    debtorId: 'd1', debtorName: 'Weir Esco',
    purchaseAmount: 4600, margin: 508, marginPct: 11, discountFee: -92,
    vendorPayable: -4000, escrowReserve: -46, cashReserve: -370,
  },
  vendor: { name: 'COASTAL TRANSPORT', invoiceNo: '54928', terms: 'Standard Net 30',
            paidDate: '', paymentStatus: 'Pending Payment', poNumber: '26007907' },
  settlement: {
    arPurchased: 4600, carrierPay: -4000,
    fees: [{ label: 'Discount fee', amount: -92 }], feesTotal: -92,
    reserves: [{ label: 'Escrow reserve', amount: -46 },
               { label: 'Cash reserve', amount: -370 }], reservesTotal: -416,
    loanPayments: [{ label: 'Loan payment', note: 'Loan Payment on ID 314403 invoice 5329', amount: -92 }],
    loanTotal: -92, other: [], otherTotal: 0, netCash: 0, clientPayable: 0,
  },
  transactions: [],
};

function render(preview) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/loads-margins.html',
    beforeParse(window) {
      window.ZOHO = { CREATOR: { UTIL: { getInitParams: () => new Promise(() => {}) } } };
      window.fetch = () => new Promise(() => {});
    },
  });
  const w = dom.window;
  w.state.selectedLoadId = '314403';
  w.state.loadPreviewLoading = false;
  w.state.loadPreviewError = null;
  w.state.loadPreview = preview;
  w.renderLoadDetail();
  return w.document.getElementById('detailPanel');
}

test('settlement section renders a friendly cash breakdown with a net cash line', () => {
  const panel = render(PREVIEW);
  const txt = panel.textContent;
  assert.match(txt, /AR purchased/i);
  assert.match(txt, /Carrier pay/i);
  assert.match(txt, /Discount fee/i);
  assert.match(txt, /Escrow reserve/i);
  assert.match(txt, /Cash reserve/i);
  assert.match(txt, /Loan payment/i);
  assert.match(txt, /Net cash to you/i);
});

test('reserves are labelled as held/released later', () => {
  const panel = render(PREVIEW);
  // The reserve rows carry a "held" / "released later" qualifier.
  assert.match(panel.textContent, /held|released/i);
});

test('loan payment shows its reference note', () => {
  const panel = render(PREVIEW);
  assert.match(panel.textContent, /ID 314403/);
});

test('no GL account numbers or internal accounting rows are shown', () => {
  const panel = render(PREVIEW);
  const txt = panel.textContent;
  assert.doesNotMatch(txt, /\bGL \d{3,4}\b/);     // no "GL 1004" etc.
  assert.doesNotMatch(txt, /Cost of Sales/i);
  assert.doesNotMatch(txt, /Invoice Revenue/i);
  assert.doesNotMatch(txt, /Client Payable/i);
  // The old raw "All transactions on this load" GL table is gone.
  assert.doesNotMatch(txt, /All transactions on this load/i);
});

test('zero-value sections are omitted (no carrier row when carrierPay is 0)', () => {
  const noCarrier = JSON.parse(JSON.stringify(PREVIEW));
  noCarrier.settlement.carrierPay = 0;
  noCarrier.settlement.netCash = 4000;       // arbitrary; not asserted here
  const panel = render(noCarrier);
  assert.doesNotMatch(panel.textContent, /Carrier pay/i);
});
