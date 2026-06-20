import { test } from "node:test";
import assert from "node:assert/strict";
import { priceSchema, resourcePatchSchema, catalogQuerySchema } from "../src/validation.js";

test("priceSchema accepts up to 7 decimals", () => {
  for (const v of ["1", "0.5", "10.1234567"]) {
    assert.equal(priceSchema.safeParse(v).success, true);
  }
});

test("priceSchema rejects zero, negative and bad input", () => {
  for (const v of ["0", "-1", "abc", "1.12345678", ""]) {
    assert.equal(priceSchema.safeParse(v).success, false);
  }
});

test("resourcePatchSchema accepts a single field and validates price", () => {
  assert.equal(resourcePatchSchema.safeParse({ title: "new" }).success, true);
  assert.equal(resourcePatchSchema.safeParse({ price: "2.5" }).success, true);
  assert.equal(resourcePatchSchema.safeParse({ price: "0" }).success, false);
});

test("resourcePatchSchema rejects an empty body", () => {
  const parsed = resourcePatchSchema.safeParse({});
  assert.equal(parsed.success, false);
  assert.equal(parsed.success === false && parsed.error.issues[0].message, "nothing to update");
});

test("catalogQuerySchema trims q and publisher and drops blanks", () => {
  const parsed = catalogQuerySchema.safeParse({ q: "  notes  ", publisher: "   " });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.q, "notes");
    assert.equal(parsed.data.publisher, undefined);
  }
});
