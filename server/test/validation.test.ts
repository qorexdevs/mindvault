import { test } from "node:test";
import assert from "node:assert/strict";
import { priceSchema } from "../src/validation.js";

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
