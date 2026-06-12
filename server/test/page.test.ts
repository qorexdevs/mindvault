import { test } from "node:test";
import assert from "node:assert/strict";
import { pageLinks } from "../src/utils/page.js";

const base = { path: "/resources", query: { q: "art" }, limit: 10 };

test("pageLinks gives only next on the first page", () => {
  const links = pageLinks({ ...base, offset: 0, total: 30 });
  assert.equal(links.includes('rel="prev"'), false);
  assert.match(links, /offset=10>; rel="next"/);
  assert.match(links, /q=art/);
});

test("pageLinks gives prev and next in the middle", () => {
  const links = pageLinks({ ...base, offset: 10, total: 30 });
  assert.match(links, /offset=0>; rel="prev"/);
  assert.match(links, /offset=20>; rel="next"/);
});

test("pageLinks drops next on the last page", () => {
  const links = pageLinks({ ...base, offset: 20, total: 30 });
  assert.match(links, /offset=10>; rel="prev"/);
  assert.equal(links.includes('rel="next"'), false);
});

test("pageLinks is empty when everything fits on one page", () => {
  assert.equal(pageLinks({ ...base, offset: 0, total: 5 }), "");
});
