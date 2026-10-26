// SUBMITTIME1 -- "Submitted" is when the credit check went live, not when its draft was
// started. The API adds Submitted_Time (Added_Time's own format) from the go-live event;
// a row without one is an older check whose Added_Time already IS its submit time.
import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('customer-approvals.html'), 'utf8');

function boot() {
  return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true }).window;
}

const DRAFTED = { ID: '1', Added_Time: '16-Oct-2026 11:40:34', Submitted_Time: '24-Oct-2026 10:19:05' };
const STRAIGHT = { ID: '2', Added_Time: '20-Oct-2026 09:00:00' };

test('a finished draft reads its go-live time', () => {
  const d = boot().submittedAt(DRAFTED);
  assert.strictEqual(d.getDate(), 24);
  assert.strictEqual(d.getHours(), 10);
});

test('a row with no Submitted_Time falls back to Added_Time', () => {
  assert.strictEqual(boot().submittedAt(STRAIGHT).getDate(), 20);
});

test('newest-first sorts on the go-live time, not the draft start', () => {
  const ids = boot().sortRecords([STRAIGHT, DRAFTED], 'newest').map((r) => r.ID);
  assert.deepStrictEqual(ids, ['1', '2']);
});
