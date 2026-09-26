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
  // 🚨 A false "Shipper" is NOT caught later: that answer means we never ask
  // for an MC, so the FMCSA authority check never runs on them. Defaulting to
  // Shipper would make the bypass the path of least resistance.
  // Scoped to the customer-type pills: the MC/DOT pills reuse the same class
  // and DO default (to MC), which is a different decision -- a wrong number
  // kind is visible and correctable, a wrong customer type is the bypass.
  assert.ok(!/id="ctype-shipper"[^>]*class="ctype-btn on"/.test(html));
  assert.ok(!/class="ctype-btn on"[^>]*id="ctype-shipper"/.test(html));
  assert.ok(!/id="ctype-broker"[^>]*class="ctype-btn on"/.test(html));
  assert.ok(!/class="ctype-btn on"[^>]*id="ctype-broker"/.test(html));
});

test('the MC/DOT kind is declared, never guessed', () => {
  // 🚨 1484200 is MCM Transportation's MC *and* Metro Diesel Inc's USDOT
  // (Toa Baja PR, out of service) -- verified live 2026-09-26. Sending the
  // same digits as both made the DOT attempt win and silently prefilled the
  // wrong company into a real broker's credit check.
  assert.ok(html.includes('data-numkind="mc"'));
  assert.ok(html.includes('data-numkind="dot"'));
  assert.ok(html.includes("var numberKind = 'mc'"));
  const fn = html.split('function lookupBroker')[1].split('\nfunction ')[0];
  assert.ok(fn.includes('payload[numberKind] = digits'));
  assert.ok(!/mc: digits, dot: digits/.test(html), 'must not send both');
  // a miss OFFERS the other kind rather than retrying as it
  assert.ok(/If that is a/.test(fn));
});

test('the result says which number it matched on', () => {
  // The broker is the only one who can tell we resolved the wrong company,
  // and only if we show them the number we used.
  const fn = html.split('function applyLookup')[1].split('\nfunction ')[0];
  assert.ok(fn.includes('Matched on'));
  assert.ok(fn.includes('j.matched_by'));
  assert.ok(/Not the right company/.test(fn));
  // an out-of-service carrier is a credit signal, not a detail
  assert.ok(fn.includes('p.out_of_service'));
  assert.ok(/OUT OF SERVICE/.test(fn));
});

test('the question is understated, not a titled section', () => {
  // 🚨 Tom, 2026-09-26: "I don't want to normalize co-brokering and make it
  // seem like it happens often but when it does, I want the rules to take
  // effect." Volume down, position unchanged -- the order is still the control.
  const block = html.split('id="ctype-block"')[1].split('id="mc-block"')[0];
  assert.ok(!block.includes('section-title'), 'no section heading');
  assert.ok(!block.includes('section-sub'), 'no explanatory blurb');
  assert.ok(!/id="ctype-block"[^>]*class="[^"]*section-block/.test(html),
            'not a form section');
  // ...and no copy that frames brokering as the routine case
  assert.ok(!/They broker freight to you/.test(html));
  assert.ok(block.includes('Who is this customer?'));
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
  // A miss now names the kind it searched, because "no record" on a number
  // that IS a valid DOT is a different problem from a wrong number.
  assert.ok(/No broker found with/i.test(html));
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

// ── Resume: a draft is not a dead end ────────────────────────────────────
//
// 🚨 Tom, 2026-09-26: a broker who stopped before attaching the co-broker
// agreement had NO WAY BACK IN. And a credit check often runs before the PO or
// the MSA exists, so adding documents to a SUBMITTED record has to work too.

test('the page lists the broker unfinished checks on load', () => {
  assert.ok(html.includes("'/credit-check/drafts?email='"));
  assert.ok(html.includes('function loadMyDrafts'));
  // only once the email is known -- scoped by it, and "" is a 401
  assert.ok(html.includes('if (!brokerEmail) { return; }'));
});

test('a handoff from Customer Approvals is a convenience, not the only way in', () => {
  // Storage can be blocked or cleared; the banner is the fallback, so both
  // run and the throw is swallowed.
  const fn = html.split("r.then(function(p) {")[1].split('\n  }')[0];
  assert.ok(fn.includes("sessionStorage.getItem('operfi.resumeSubmission')"));
  assert.ok(fn.includes('removeItem'));
  assert.ok(fn.includes('catch (e) {}'));
  assert.ok(fn.includes('loadMyDrafts()'));
});

test('resuming does NOT carry the previous session file flag', () => {
  // 🚨 draftFilesLanded exists to stop the SAME files uploading twice in one
  // session. Setting it from has_agreement would silently drop the PO or MSA
  // the broker came back specifically to attach.
  const fn = html.split('function applyResume')[1].split('\nfunction ')[0];
  assert.ok(fn.includes('draftFilesLanded = false'));
  assert.ok(!/draftFilesLanded = !!j\.has_agreement/.test(html));
});

test('fields the server will refuse are shown read-only', () => {
  // An editable box over an immutable value is a lie the user only discovers
  // after typing into it.
  const fn = html.split('function applyResume')[1].split('\nfunction ')[0];
  assert.ok(fn.includes('resumeLocked.forEach'));
  assert.ok(fn.includes('readOnly = true'));
  assert.ok(html.includes('.field-input.locked'));
});

test('a resumed lock does not leak onto the next customer', () => {
  const fn = html.split('function resetCustomerType')[1].split('\nfunction ')[0];
  assert.ok(fn.includes("querySelectorAll('.locked')"));
  assert.ok(fn.includes('readOnly = false'));
  assert.ok(fn.includes('resumeIsDraft = true'));
});

test('adding to a submitted record is not reported as a resubmission', () => {
  // Saying "submitted" over it would imply credit is looking at it again.
  const fin = html.split('function finalizeDraft')[1].split('\nfunction ')[0];
  assert.ok(fin.includes('if (!resumeIsDraft)'));
  assert.ok(/left as it is/.test(fin));
  assert.ok(fin.includes('j.kept'));
});

test('uploads carry the broker identity', () => {
  // /upload-doc ownership-checks All_Customer_Submissions, because the
  // co-broker gate reads the field these files land in.
  const fn = html.split('function uploadFiles')[1].split('\nfunction ')[0];
  assert.ok(fn.includes("fd.append('email', brokerEmail)"));
});

test('files attach once per draft, not once per retry', () => {
  // A 409 sends them back to fix a blocker; re-uploading would leave credit
  // three copies of the agreement to read.
  const fin = html.split('function finalizeDraft')[1].split('\nfunction ')[0];
  assert.ok(fin.includes('!draftFilesLanded'));
  assert.ok(fin.includes('draftFilesLanded = true'));
});
