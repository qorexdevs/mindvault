import { test } from "node:test";
import assert from "node:assert/strict";
import { pageLinks } from "../src/utils/page.js";

const base = { path: "/resources", query: { sort: "newest" } };

test("first page only points forward to next and last", () => {
  const links = pageLinks({ ...base, limit: 20, offset: 0, total: 100 });
  assert.match(links, /offset=20>; rel="next"/);
  assert.match(links, /offset=80>; rel="last"/);
  assert.doesNotMatch(links, /rel="prev"/);
  assert.doesNotMatch(links, /rel="first"/);
});

test("a middle page exposes all four rels", () => {
  const links = pageLinks({ ...base, limit: 20, offset: 40, total: 100 });
  assert.match(links, /offset=0>; rel="first"/);
  assert.match(links, /offset=20>; rel="prev"/);
  assert.match(links, /offset=60>; rel="next"/);
  assert.match(links, /offset=80>; rel="last"/);
});

test("last page only points back to first and prev", () => {
  const links = pageLinks({ ...base, limit: 20, offset: 80, total: 100 });
  assert.match(links, /offset=0>; rel="first"/);
  assert.match(links, /offset=60>; rel="prev"/);
  assert.doesNotMatch(links, /rel="next"/);
  assert.doesNotMatch(links, /rel="last"/);
});

test("an uneven last page lands on the right last offset", () => {
  const links = pageLinks({ ...base, limit: 20, offset: 0, total: 95 });
  assert.match(links, /offset=80>; rel="last"/);
});

test("a single page has no links at all", () => {
  assert.equal(pageLinks({ ...base, limit: 20, offset: 0, total: 10 }), "");
});
