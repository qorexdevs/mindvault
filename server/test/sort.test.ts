import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSort } from "../src/utils/sort.js";

test("resolveSort defaults to newest first", () => {
  assert.deepEqual(resolveSort(), { column: "createdAt", direction: "desc" });
  assert.deepEqual(resolveSort("newest"), { column: "createdAt", direction: "desc" });
});

test("resolveSort maps oldest and price options", () => {
  assert.deepEqual(resolveSort("oldest"), { column: "createdAt", direction: "asc" });
  assert.deepEqual(resolveSort("price_asc"), { column: "price", direction: "asc" });
  assert.deepEqual(resolveSort("price_desc"), { column: "price", direction: "desc" });
});

test("resolveSort maps title options", () => {
  assert.deepEqual(resolveSort("title_asc"), { column: "title", direction: "asc" });
  assert.deepEqual(resolveSort("title_desc"), { column: "title", direction: "desc" });
});

test("resolveSort maps popular to sales desc", () => {
  assert.deepEqual(resolveSort("popular"), { column: "sales", direction: "desc" });
});

test("resolveSort maps trending to recent_sales desc", () => {
  assert.deepEqual(resolveSort("trending"), { column: "recent_sales", direction: "desc" });
});
