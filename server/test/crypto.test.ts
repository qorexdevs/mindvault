import { test } from "node:test";
import assert from "node:assert/strict";
import { generateApiKey, hashApiKey, validateApiKey } from "../src/utils/crypto.js";

test("generateApiKey is prefixed and unique", () => {
  const a = generateApiKey();
  const b = generateApiKey();
  assert.match(a, /^mv_[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

test("hashApiKey is stable and not the key itself", () => {
  const key = "mv_test";
  const h = hashApiKey(key);
  assert.equal(h, hashApiKey(key));
  assert.notEqual(h, key);
  assert.match(h, /^[0-9a-f]{64}$/);
});

test("validateApiKey accepts a freshly generated key", () => {
  assert.equal(validateApiKey(generateApiKey()), true);
});

test("validateApiKey rejects malformed keys", () => {
  assert.equal(validateApiKey(""), false);
  assert.equal(validateApiKey("mv_test"), false);
  assert.equal(validateApiKey("sk_" + "a".repeat(64)), false);
  assert.equal(validateApiKey("mv_" + "a".repeat(63)), false);
  assert.equal(validateApiKey("mv_" + "A".repeat(64)), false);
  assert.equal(validateApiKey(`mv_${"a".repeat(64)} `), false);
});
