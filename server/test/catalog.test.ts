import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogPriceSchema } from "../src/validation.js";

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
