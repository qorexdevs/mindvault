import { test } from "node:test";
import assert from "node:assert/strict";
import { priceSchema, resourcePatchSchema, catalogQuerySchema, linkSchema } from "../src/validation.js";

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

test("linkSchema needs a title, a valid price and a real url", () => {
  const ok = linkSchema.safeParse({ title: "notes", price: "1.5", externalUrl: "https://x.io/a" });
  assert.equal(ok.success, true);
  assert.equal(linkSchema.safeParse({ price: "1", externalUrl: "https://x.io" }).success, false);
  assert.equal(linkSchema.safeParse({ title: "x", price: "0", externalUrl: "https://x.io" }).success, false);
  assert.equal(linkSchema.safeParse({ title: "x", price: "1", externalUrl: "not a url" }).success, false);
});

test("linkSchema rejects non-http(s) urls", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,x", "ftp://x.io/a"]) {
    assert.equal(linkSchema.safeParse({ title: "x", price: "1", externalUrl: url }).success, false);
  }
});

test("linkSchema keeps optional description and walletAddress", () => {
  const parsed = linkSchema.safeParse({
    title: "notes",
    price: "1",
    externalUrl: "https://x.io",
    description: "a guide",
    walletAddress: "G...",
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.description, "a guide");
    assert.equal(parsed.data.walletAddress, "G...");
  }
});
