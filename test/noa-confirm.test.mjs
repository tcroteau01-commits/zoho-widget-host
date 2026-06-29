import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWidget } from './noa-management.test.mjs';

// The confirmation ("Update Received") screen hardcoded "ROADWAY EXPRESS LOGISTICS"
// and "NOA Update" — so it showed the wrong carrier/type for every submission.
// showTrack() must fill in the actually-selected carrier and update type.
test('confirmation shows the selected carrier + update type, not a hardcoded placeholder', () => {
  const { window } = makeWidget();
  window.scrollTo = () => {};
  window.selectedType = 'Factoring Company Change';
  window.showOnFile({ carrier_name: 'BRENNAN TRUCKING', pay_term: 'Factoring Company' });
  window.showTrack();
  assert.equal(window.document.getElementById('track-carrier').textContent, 'BRENNAN TRUCKING');
  assert.equal(window.document.getElementById('track-type').textContent, 'Factoring Company Change');
});
