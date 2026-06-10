/* NOA management call-reduction: two Creator-backed reads were fired needlessly.
   - selectCarrier re-read /noa-status for a carrier whose on-file status was
     already in the worklist loaded on boot.
   - searchCarriers re-fetched /noa-carriers for a query string already searched.
   These pin that the redundant reads are gone, with a safe fallback preserved. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWidget } from './noa-management.test.mjs';

function withCountingFetch(window, payload) {
  const calls = [];
  window.fetch = (url) => {
    calls.push(String(url));
    return Promise.resolve({ json: () => Promise.resolve(payload || { carriers: [] }) });
  };
  return calls;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

test('selectCarrier reuses the loaded worklist and skips the /noa-status refetch', async () => {
  const { window } = makeWidget();
  const calls = withCountingFetch(window);
  window.statusPayload = { carriers: [
    { vendor_id: '1001', carrier_name: 'ROADWAY', mc: '1', dot: '2', factoring_company: 'Triumph' },
  ] };
  window.selectCarrier({ vendor_id: '1001', carrier_name: 'ROADWAY', mc: '1', dot: '2' });
  await flush();
  assert.equal(calls.filter((u) => u.includes('/noa-status')).length, 0);
});

test('selectCarrier still fetches /noa-status for a carrier not in the loaded worklist', async () => {
  const { window } = makeWidget();
  const calls = withCountingFetch(window);
  window.statusPayload = { carriers: [] };
  window.selectCarrier({ vendor_id: '9999', carrier_name: 'NEW CARRIER', mc: '1', dot: '2' });
  await flush();
  assert.equal(calls.filter((u) => u.includes('/noa-status')).length, 1);
});

test('searchCarriers caches an identical query (no duplicate /noa-carriers read)', async () => {
  const { window } = makeWidget();
  const calls = withCountingFetch(window, { carriers: [{ vendor_id: '1', carrier_name: 'ROADWAY', mc: '1', dot: '2' }] });
  await window.searchCarriers('roadway');
  await window.searchCarriers('roadway');
  assert.equal(calls.filter((u) => u.includes('/noa-carriers')).length, 1);
});
