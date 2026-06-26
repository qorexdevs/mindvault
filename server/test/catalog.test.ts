import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogDateSchema, catalogPriceSchema, catalogQuerySchema } from "../src/validation.js";

test("catalogPriceSchema coerces string bounds and allows a zero floor", () => {
  const parsed = catalogPriceSchema.safeParse({ minPrice: "0", maxPrice: "10.5" });
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.success && parsed.data, { minPrice: 0, maxPrice: 10.5 });
});

test("catalogPriceSchema accepts a missing or single bound", () => {
  assert.equal(catalogPriceSchema.safeParse({}).success, true);
  assert.equal(catalogPriceSchema.safeParse({ minPrice: "5" }).success, true);
  assert.equal(catalogPriceSchema.safeParse({ maxPrice: "5" }).success, true);
});

test("catalogPriceSchema rejects an inverted range and negatives", () => {
  assert.equal(catalogPriceSchema.safeParse({ minPrice: "10", maxPrice: "5" }).success, false);
  assert.equal(catalogPriceSchema.safeParse({ minPrice: "-1" }).success, false);
});

test("catalogQuerySchema fills paging and sort defaults on an empty query", () => {
  const parsed = catalogQuerySchema.safeParse({});
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.limit, 50);
    assert.equal(parsed.data.offset, 0);
    assert.equal(parsed.data.sort, "newest");
  }
});

test("catalogQuerySchema coerces string paging from the querystring", () => {
  const parsed = catalogQuerySchema.safeParse({ limit: "10", offset: "20", sort: "price_asc" });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.limit, 10);
    assert.equal(parsed.data.offset, 20);
    assert.equal(parsed.data.sort, "price_asc");
  }
});

test("catalogQuerySchema caps limit, rejects a negative offset and bad sort", () => {
  assert.equal(catalogQuerySchema.safeParse({ limit: "101" }).success, false);
  assert.equal(catalogQuerySchema.safeParse({ limit: "0" }).success, false);
  assert.equal(catalogQuerySchema.safeParse({ offset: "-1" }).success, false);
  assert.equal(catalogQuerySchema.safeParse({ sort: "cheapest" }).success, false);
});

test("catalogDateSchema coerces ISO bounds and allows a single one", () => {
  const parsed = catalogDateSchema.safeParse({
    createdAfter: "2026-01-01",
    createdBefore: "2026-06-01",
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.ok(parsed.data.createdAfter instanceof Date);
    assert.ok(parsed.data.createdBefore instanceof Date);
  }
  assert.equal(catalogDateSchema.safeParse({ createdAfter: "2026-01-01" }).success, true);
  assert.equal(catalogDateSchema.safeParse({}).success, true);
});

test("catalogDateSchema rejects an inverted range and junk dates", () => {
  assert.equal(
    catalogDateSchema.safeParse({ createdAfter: "2026-06-01", createdBefore: "2026-01-01" }).success,
    false
  );
  assert.equal(catalogDateSchema.safeParse({ createdAfter: "not-a-date" }).success, false);
});

test("catalogQuerySchema coerces verified to a boolean and rejects junk", () => {
  const on = catalogQuerySchema.safeParse({ verified: "true" });
  assert.equal(on.success && on.data.verified, true);
  const off = catalogQuerySchema.safeParse({ verified: "false" });
  assert.equal(off.success && off.data.verified, false);
  assert.equal(catalogQuerySchema.safeParse({}).success && catalogQuerySchema.parse({}).verified, undefined);
  assert.equal(catalogQuerySchema.safeParse({ verified: "yes" }).success, false);
});

test("catalogQuerySchema coerces free to a boolean and rejects junk", () => {
  const on = catalogQuerySchema.safeParse({ free: "true" });
  assert.equal(on.success && on.data.free, true);
  const off = catalogQuerySchema.safeParse({ free: "false" });
  assert.equal(off.success && off.data.free, false);
  assert.equal(catalogQuerySchema.parse({}).free, undefined);
  assert.equal(catalogQuerySchema.safeParse({ free: "1" }).success, false);
});
