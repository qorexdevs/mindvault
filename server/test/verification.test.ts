import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVerification } from "../src/utils/verification.js";

test("parseVerification reads a plain json object", () => {
  const out = parseVerification('{"is_original": true, "confidence": 0.8, "flags": ["looks real"]}');
  assert.deepEqual(out, { isOriginal: true, confidence: 0.8, flags: ["looks real"] });
});

test("parseVerification strips a markdown code fence", () => {
  const out = parseVerification('```json\n{"is_original": false, "confidence": 0.2, "flags": []}\n```');
  assert.deepEqual(out, { isOriginal: false, confidence: 0.2, flags: [] });
});

test("parseVerification clamps an out-of-range confidence into 0..1", () => {
  assert.equal(parseVerification('{"is_original": true, "confidence": 95}').confidence, 1);
  assert.equal(parseVerification('{"is_original": true, "confidence": -3}').confidence, 0);
});

test("parseVerification falls back to 0 when confidence is not a number", () => {
  assert.equal(parseVerification('{"is_original": true, "confidence": "high"}').confidence, 0);
});

test("parseVerification reports an empty response", () => {
  assert.deepEqual(parseVerification("  "), {
    isOriginal: false,
    confidence: 0,
    flags: ["No response from verification model"],
  });
});

test("parseVerification reports unparseable json", () => {
  assert.deepEqual(parseVerification("not json at all"), {
    isOriginal: false,
    confidence: 0,
    flags: ["Failed to parse verification response"],
  });
});

test("parseVerification ignores a non-array flags field", () => {
  assert.deepEqual(parseVerification('{"is_original": true, "confidence": 0.5, "flags": "nope"}').flags, []);
});
