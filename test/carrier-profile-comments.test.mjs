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
