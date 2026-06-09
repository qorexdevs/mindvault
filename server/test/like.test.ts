import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeLike } from "../src/utils/like.js";

test("escapeLike escapes LIKE wildcards", () => {
  assert.equal(escapeLike("50%"), "50\\%");
  assert.equal(escapeLike("a_b"), "a\\_b");
  assert.equal(escapeLike("c:\\path"), "c:\\\\path");
});

test("escapeLike leaves plain text untouched", () => {
  assert.equal(escapeLike("hello world"), "hello world");
});
