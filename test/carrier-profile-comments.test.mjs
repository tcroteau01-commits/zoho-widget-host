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

const RICH = {
  account_vendor: { av_id: 'av_1' },
  vendor: { ID: '9001' },
  comments: [
    { ID: '200', Comment_Text: 'Newer note', Comment_Type: 'Risk',
      Author_Name: 'Sarah Kobylinski', Added_Time: '2026-05-20T09:00:00', Pinned: 'false' },
    { ID: '100', Comment_Text: 'Pinned note', Comment_Type: 'Operational',
      Author_Name: 'Mark Rinaldi', Added_Time: '2026-05-01T09:00:00', Pinned: 'true' }
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
  window.brokerEmail = 'broker@op.com';
  // Stub the contact resolver so we do not depend on getRecords matching.
  window.resolveBrokerContact = () => Promise.resolve({ id: 'c_77', name: 'Test Broker' });
  window.document.getElementById('cp-comment-text').value = 'Reliable on PA->NJ runs';
  window.document.getElementById('cp-comment-type').value = 'Operational';
  await window.addComment();
  assert.equal(addCalls.length, 1);
  assert.equal(addCalls[0].form_name, 'Carrier_Comment');
  const d = addCalls[0].payload.data;
  assert.equal(d.Account_Vendor, 'av_1');
  assert.equal(d.Vendor, '9001');
  assert.equal(d.Comment_Text, 'Reliable on PA->NJ runs');
  assert.equal(d.Comment_Type, 'Operational');
  assert.equal(d.Author_Contact, 'c_77');
  assert.equal(d.Author_Name, 'Test Broker');
  assert.equal(window.document.getElementById('cp-comment-text').value, '');
});

test('addComment surfaces an error and does not write when the contact cannot be resolved', async () => {
  const { window, addCalls } = makeWidget();
  window.profilePayload = RICH;
  window.renderComments(RICH);
  window.brokerEmail = 'broker@op.com';
  window.resolveBrokerContact = () => Promise.resolve(null);
  window.document.getElementById('cp-comment-text').value = 'Some note';
  await window.addComment();
  assert.equal(addCalls.length, 0);
  assert.match(window.document.getElementById('cp-comment-feedback').textContent, /contact/i);
  assert.equal(window.document.getElementById('cp-comment-submit').disabled, false);
});
