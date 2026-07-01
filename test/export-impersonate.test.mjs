import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

// Widgets that download CSV/PDF via window.open(). Because window.open is a
// top-level navigation it never passes through the operfi-impersonate.js fetch
// wrapper, so their export URLs must be run through OPERFI_IMP.decorate() to
// carry the admin's impersonation target. Otherwise an impersonated export
// falls back to the admin's own FV client (the 2099 TESTING OPERFI bug).
//
// Note: these widgets also have window.open calls that navigate to Zoho
// #Page: routes (not the broker API); those must NOT be decorated. So we only
// require that the API export open is wired, i.e. at least one window.open
// whose argument goes through decorate().
const EXPORT_WIDGETS = ['reserve-report', 'loads-margins', 'aging'];

test('each export widget wires its API export window.open through OPERFI_IMP.decorate', () => {
  EXPORT_WIDGETS.forEach(function (name) {
    const html = fs.readFileSync(new URL('../' + name + '.html', import.meta.url), 'utf8');
    const opens = html.match(/window\.open\([^;]*?\)/g) || [];
    const decorated = opens.filter(function (call) { return /decorate/i.test(call); });
    assert.ok(
      decorated.length > 0,
      name + ' has no window.open export wrapped in OPERFI_IMP.decorate'
    );
  });
});
