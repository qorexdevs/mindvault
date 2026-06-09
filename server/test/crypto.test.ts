import { test } from "node:test";
import assert from "node:assert/strict";
import { generateApiKey, hashApiKey } from "../src/utils/crypto.js";

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
