import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../credit-check.html', import.meta.url), 'utf8');

test('submit POSTs plain-string fields to /credit-submit and never calls addRecords', async () => {
  const posts = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://tcroteau01-commits.github.io/credit-check.html',
    beforeParse(window) {
      window.scrollTo = () => {};
      window.ZOHO = { CREATOR: {
        UTIL: { getInitParams: () => Promise.resolve({ loginUser: 'broker@op.com' }) },
        DATA: { addRecords: () => { throw new Error('addRecords must not be called'); } },
      }};
      window.fetch = (url, opts) => {
        if (typeof url === 'string' && url.indexOf('/credit-submit') !== -1) {
          posts.push({ url, body: JSON.parse(opts.body) });
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 'r1' }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      };
    }
  });
  const window = dom.window;
  await new Promise(r => setTimeout(r, 0));
  const set = (id, v) => { window.document.getElementById(id).value = v; };
  set('Customer_Company_Name', 'ACME'); set('address_line_1', '1 St'); set('district_city', 'PHX');
  set('state_province', 'AZ'); set('postal_Code', '85001'); set('Phone_Number', '602-555-0123');
  set('Company_Website', 'acme.com'); set('Customer_Point_of_Contact', 'Jane');
  set('Phone_Number1', '602-555-0123'); set('Email', 'jane@acme.com');
  window.document.getElementById('submitBtn').click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(posts.length, 1, 'should POST once to /credit-submit');
  assert.match(posts[0].url, /\/credit-submit/);
  assert.equal(posts[0].body.email, 'broker@op.com');
  assert.equal(posts[0].body.Company_Website, 'acme.com');
  assert.equal(posts[0].body.Customer_Company_Name, 'ACME');
});
