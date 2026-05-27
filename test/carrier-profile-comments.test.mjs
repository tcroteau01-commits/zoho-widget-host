import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../carrier-profile.html', import.meta.url), 'utf8');

// Build a jsdom window with the widget's script executed, ZOHO + fetch stubbed
// so boot() can't throw or make network calls. Returns { window, addCalls }.
function makeWidget() {
  const addCalls = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    beforeParse(window) {
      window.ZOHO = {
        CREATOR: {
          UTIL: { getInitParams: () => new Promise(() => {}) }, // never resolves; boot stalls harmlessly
          DATA: {
            getRecords: () => Promise.resolve({ data: [] }),
            addRecords: (args) => { addCalls.push(args); return Promise.resolve({ code: 3000, result: [{}] }); }
          }
        }
      };
      window.fetch = () => new Promise(() => {});
    }
  });
  return { window: dom.window, addCalls };
}

// comments[] is the backend-normalized shape (flat Author_Name, Comment, Created_At).
// broker_contact_id is the logged-in broker's Contact ID, resolved server-side.
const RICH = {
  account_vendor: { av_id: 'av_1' },
  vendor: { ID: '9001' },
  broker_contact_id: 'c_77',
  comments: [
    { ID: '200', Comment: 'Newer note', Comment_Type: 'Risk',
      Author_Name: 'Sarah Kobylinski', Created_At: '20-May-2026 09:00:00', Pinned: 'false' },
    { ID: '100', Comment: 'Pinned note', Comment_Type: 'Operational',
      Author_Name: 'Mark Rinaldi', Created_At: '01-May-2026 09:00:00', Pinned: 'true' }
  ]
};

test('renderComments lists comments with author, type pill, and pinned first', () => {
  const { window } = makeWidget();
  window.profilePayload = RICH;
  window.renderComments(RICH);
  const list = window.document.getElementById('cp-comments');
  const items = list.querySelectorAll('.comment');
  assert.equal(items.length, 2);
  // Pinned sorts first
  assert.match(items[0].textContent, /Pinned note/);
  assert.match(items[0].textContent, /Mark Rinaldi/);
  assert.ok(items[0].querySelector('.comment-pinned-marker'));
  // Type pill class maps Risk -> risk
  assert.ok(items[1].querySelector('.comment-type-pill.risk'));
});

test('renderComments shows empty state when no comments', () => {
  const { window } = makeWidget();
  const p = { account_vendor: { av_id: 'av_1' }, vendor: { ID: '9001' }, comments: [] };
  window.profilePayload = p;
  window.renderComments(p);
  const list = window.document.getElementById('cp-comments');
  assert.match(list.textContent, /No comments yet/);
});

test('compose form is disabled when there is no account_vendor', () => {
  const { window } = makeWidget();
  const p = { account_vendor: null, vendor: { ID: '9001' }, comments: [] };
  window.profilePayload = p;
  window.renderComments(p);
  assert.equal(window.document.getElementById('cp-comment-text').disabled, true);
  assert.equal(window.document.getElementById('cp-comment-submit').disabled, true);
});

test('compose form is enabled and wired when account_vendor is present', () => {
  const { window } = makeWidget();
  window.profilePayload = RICH;
  window.renderComments(RICH);
  assert.equal(window.document.getElementById('cp-comment-text').disabled, false);
  assert.equal(window.document.getElementById('cp-comment-submit').disabled, false);
  assert.equal(window.document.getElementById('cp-comment-submit').onclick, window.addComment);
});

test('addComment rejects empty text without calling the SDK', () => {
  const { window, addCalls } = makeWidget();
  window.profilePayload = RICH;
  window.renderComments(RICH);
  window.brokerEmail = 'broker@op.com';
  window.document.getElementById('cp-comment-text').value = '   ';
  window.addComment();
  assert.equal(addCalls.length, 0);
  assert.match(window.document.getElementById('cp-comment-feedback').textContent, /comment/i);
});

test('addComment builds the correct ADD payload', async () => {
  const { window, addCalls } = makeWidget();
  window.profilePayload = RICH;
  window.renderComments(RICH);
  window.document.getElementById('cp-comment-text').value = 'Reliable on PA->NJ runs';
  window.document.getElementById('cp-comment-type').value = 'Operational';
  await window.addComment();
  assert.equal(addCalls.length, 1);
  assert.equal(addCalls[0].form_name, 'Vendor_Comments');
  const d = addCalls[0].payload.data;
  assert.equal(d.Account_Vendor, 'av_1');
  assert.equal(d.Comment, 'Reliable on PA->NJ runs');
  assert.equal(d.Comment_Type, 'Operational');
  assert.equal(d.Author, 'c_77');   // from payload broker_contact_id, not a client lookup
  assert.equal(window.document.getElementById('cp-comment-text').value, '');
});

test('addComment surfaces an error and does not write when broker_contact_id is missing', async () => {
  const { window, addCalls } = makeWidget();
  // Payload with a relationship but no resolved contact id (e.g. stale backend).
  const p = { account_vendor: { av_id: 'av_1' }, vendor: { ID: '9001' }, comments: [] };
  window.profilePayload = p;
  window.renderComments(p);
  window.document.getElementById('cp-comment-text').value = 'Some note';
  await window.addComment();
  assert.equal(addCalls.length, 0);
  assert.match(window.document.getElementById('cp-comment-feedback').textContent, /contact/i);
  assert.equal(window.document.getElementById('cp-comment-submit').disabled, false);
});
