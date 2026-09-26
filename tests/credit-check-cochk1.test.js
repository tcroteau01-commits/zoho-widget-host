// tests/credit-check-cochk1.test.js
//
// COCHK1 on the credit check form: the Shipper/Freight Broker question, the
// forced MC lookup, and the co-broker agreement.
//
// 🚨 THE ORDER IS THE CONTROL. Ask → force the lookup → the server saves a
// draft → only THEN does the page mention a co-broker agreement. Tom,
// 2026-09-25: "If they see that the co-broker form is required, they might back
// out and then classify them as a shipper to get around it."
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

// 🚨 Normalised to \n: the file is checked out CRLF on Windows and a pattern
// anchored on a bare \n matches nothing there, which reads as "the code is
// missing" rather than "the test is wrong".
const html = fs.readFileSync(__dirname + '/../credit-check.html', 'utf8')
               .replace(/\r\n/g, '\n');

test('the question is asked before anything else on the form', () => {
  // A broker who meets this after filling the form in has already worked out
  // which answer costs least.
  assert.ok(html.indexOf('id="ctype-block"') < html.indexOf('id="company-block"'));
  assert.ok(html.includes('data-ctype="Shipper"'));
  assert.ok(html.includes('data-ctype="Freight Broker"'));
});

test('neither answer is pre-selected', () => {
  // The answer decides whether a co-broker agreement is required. A nudged
  // answer is worth nothing.
  assert.ok(!/class="ctype-btn on"/.test(html));
});

test('the MC lookup is hidden until they say Freight Broker', () => {
  assert.ok(/id="mc-block"[^>]*display:\s*none/.test(html));
  assert.ok(html.includes("document.getElementById('mc-block').style.display"));
});

test('the co-broker requirement is not in the markup at all', () => {
  // 🚨 THE CONTROL. It is built by renderCoBrokerRequirement AFTER the lookup
  // returns, which is after the server has already saved the draft. Shipping it
  // in the HTML would let a broker read it before committing to anything.
  assert.ok(!html.includes('A signed co-broker agreement is required</div>')
            || html.includes('function renderCoBrokerRequirement'));
  const idx = html.indexOf('A signed co-broker agreement is required');
  const fnIdx = html.indexOf('function renderCoBrokerRequirement');
  assert.ok(idx > fnIdx, 'the copy must live inside the render function');
});

test('switching away from Freight Broker does not undo the draft', () => {
  // The record is already on their account; changing the answer now is exactly
  // the move this feature exists to make pointless.
  assert.ok(/does not undo the draft/i.test(html));
  assert.ok(!/draftId = null/.test(html.split('function setCustomerType')[1]
                                       .split('function ')[0]));
});

test('submitting without an answer is refused before the network', () => {
  assert.ok(html.includes('if (!customerType)'));
  assert.ok(html.includes("customerType === 'Freight Broker' && !draftId"));
});

test('a broker with no agreement attached cannot submit', () => {
  assert.ok(html.includes('needsCoBroker && selectedFiles.length === 0'));
});

test('files upload BEFORE the draft is finalized', () => {
  // 🚨 The server checks the RECORD for the agreement, not the request, so
  // finalizing first would be refused for a file that was about to arrive.
  const fin = html.split('function finalizeDraft')[1].split('\nfunction ')[0];
  assert.ok(fin.includes('uploadFiles(draftId,'));
  // go() is DEFINED first and CALLED from the upload callback, never before it
  assert.ok(fin.indexOf('uploadFiles(draftId,') > fin.indexOf('function go('));
  assert.ok(/uploadFiles\(draftId,[\s\S]*?go\(errs\)/.test(fin));
});

test('a broker finishes the draft instead of creating a second record', () => {
  assert.ok(html.includes('if (draftId) { return finalizeDraft(); }'));
  assert.ok(html.includes('/credit-check/draft/'));
});

test("the server's list of what is missing is shown verbatim", () => {
  // The server knows what the record lacks; the page is guessing.
  assert.ok(html.includes('j.blockers.join'));
});

test('an outage and an unregistered number read differently', () => {
  assert.ok(html.includes("j.error === 'lookup_unavailable'"));
  assert.ok(/could not reach FMCSA/i.test(html));
  assert.ok(/No FMCSA record for that number/i.test(html));
});

test('only the company and address are prefilled', () => {
  // Tom: "We only pull in the main address MC, DOT fields and let them give
  // everything else." The POC and emails are the relationship.
  const fn = html.split('function applyLookup')[1].split('\nfunction ')[0];
  ['Customer_Company_Name', 'address_line_1', 'district_city',
   'state_province', 'postal_Code'].forEach((id) => {
    assert.ok(fn.includes("put('" + id + "'"), 'not prefilled: ' + id);
  });
  ['Email', 'Customer_Point_of_Contact', 'Billing_Email', 'Phone_Number1']
    .forEach((id) => {
      assert.ok(!fn.includes("put('" + id + "'"), 'must NOT prefill: ' + id);
    });
});

test('the prefilled postal field uses the capital-C key', () => {
  // 🚨 postal_Code is the form's link name; the lower-case spelling is what a
  // READ returns. The wrong one loses the zip silently.
  const fn = html.split('function applyLookup')[1].split('\nfunction ')[0];
  assert.ok(fn.includes('a.postal_Code'));
});

test('a hostile company name from the lookup cannot inject markup', () => {
  // The name comes from FMCSA via our API, but it lands in innerHTML.
  const fn = html.split('function applyLookup')[1].split('\nfunction ')[0];
  assert.ok(fn.includes('esc(p.Customer_Company_Name'));
  assert.ok(html.includes('function esc(s)'));
});

test('Enter in the MC box searches rather than submitting the form', () => {
  assert.ok(html.includes("if (ev.key === 'Enter') { ev.preventDefault(); lookupBroker(); }"));
});

test('billing reusing the contact mailbox is caught before the network', () => {
  assert.ok(html.includes('pocE === billE'));
  // ...and the comment says the server is the real gate
  assert.ok(/Refused server-side/i.test(html));
});

test('Submit another clears the draft so it cannot overwrite the last customer', () => {
  // 🚨 THE WORST ONE. draftId surviving a reset means the next submission POSTs
  // to the PREVIOUS customer's record and overwrites it -- silently, on a form
  // that reported success both times.
  const fn = html.split('function resetCustomerType')[1].split('\nfunction ')[0];
  ['customerType = null', 'draftId = null', 'authorityClass = null',
   'needsCoBroker = false', 'draftFilesLanded = false'].forEach((s) => {
    assert.ok(fn.includes(s), 'reset does not clear: ' + s);
  });
  // ...and the visible traces of the last lookup go too
  assert.ok(fn.includes("getElementById('cobroker-req')"));
  assert.ok(fn.includes("getElementById('mc-result')"));
  assert.ok(fn.includes("b.classList.remove('on')"));
  // ...and resetForm actually calls it
  const rf = html.split('function resetForm')[1].split('\nfunction ')[0];
  assert.ok(rf.includes('resetCustomerType()'));
});

test('a failed upload never reports success over an unfinalized draft', () => {
  // The co-broker agreement is the biggest file and so the likeliest to fail.
  // Short-circuiting here would tell the broker "✓ submitted" over a record
  // still at Draft - Incomplete that credit never sees.
  assert.ok(html.includes('if (errors > 0 && !afterUpload)'));
  assert.ok(html.includes('afterUpload(errors)'));
  // the finalize reports the partial outcome instead of a clean tick
  const fin = html.split('function finalizeDraft')[1].split('\nfunction ')[0];
  assert.ok(fin.includes('if (uploadErrors)'));
  assert.ok(/Credit check submitted, but/.test(fin));
});

test('files attach once per draft, not once per retry', () => {
  // A 409 sends them back to fix a blocker; re-uploading would leave credit
  // three copies of the agreement to read.
  const fin = html.split('function finalizeDraft')[1].split('\nfunction ')[0];
  assert.ok(fin.includes('!draftFilesLanded'));
  assert.ok(fin.includes('draftFilesLanded = true'));
});
