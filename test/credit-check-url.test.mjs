import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../credit-check.html', import.meta.url), 'utf8');

// Creator URL fields (type 17) reject a plain string with code 3001
// "Invalid column value for Company_Website". They require a {url} object.
function makeWidget() {
  const addCalls = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/credit-check.html',
    beforeParse(window) {
      window.scrollTo = () => {};
      window.ZOHO = { CREATOR: {
        UTIL: { getInitParams: () => Promise.resolve({ loginUser: 'broker@op.com' }) },
        DATA: { addRecords: (a) => { addCalls.push(a); return Promise.resolve({ code: 3000, data: { ID: 'r1' } }); } },
      }};
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
  });
  return { window: dom.window, addCalls };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('Company_Website is sent as a URL object {url}, not a plain string', async () => {
  const { window, addCalls } = makeWidget();
  await tick();
  const set = (id, val) => { window.document.getElementById(id).value = val; };
  set('Customer_Company_Name', 'R.K. STEEL INC');
  set('address_line_1', '1222 North 6th Street');
  set('district_city', 'Phoenix');
  set('state_province', 'AZ');
  set('postal_Code', '85001');
  set('Phone_Number', '602-555-0123');
  set('Company_Website', 'https://rksteel.com');
  set('Customer_Point_of_Contact', 'Jane Smith');
  set('Phone_Number1', '602-555-0123');
  set('Email', 'jane@rksteel.com');

  window.document.getElementById('submitBtn').click();
  await tick();

  assert.equal(addCalls.length, 1, 'addRecords should fire once after a valid form');
  const web = addCalls[0].payload.data.Company_Website;
  assert.equal(typeof web, 'object', 'Company_Website must be a URL object, got: ' + JSON.stringify(web));
  assert.equal(web.url, 'https://rksteel.com');
});
