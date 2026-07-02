import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuery, parseLinkHeader } from "../src/query.js";

test("buildQuery drops empty values and keeps defaults to the server", () => {
  assert.equal(buildQuery({}), "");
  assert.equal(buildQuery({ q: undefined, type: null, mime: "" }), "");
});

test("buildQuery encodes booleans as true/false", () => {
  assert.equal(buildQuery({ verified: true, free: false }), "?verified=true&free=false");
});

test("buildQuery serializes Date to ISO", () => {
  const d = new Date("2026-01-02T03:04:05.000Z");
  assert.equal(buildQuery({ createdAfter: d }), "?createdAfter=2026-01-02T03%3A04%3A05.000Z");
});

test("buildQuery stringifies numbers and text, url-encoding values", () => {
  assert.equal(
    buildQuery({ q: "machine learning", limit: 10, offset: 20 }),
    "?q=machine+learning&limit=10&offset=20"
  );
});

test("parseLinkHeader returns {} for missing header", () => {
  assert.deepEqual(parseLinkHeader(null), {});
});

test("parseLinkHeader maps rel to url", () => {
  const h =
    '</resources?offset=50>; rel="next", </resources?offset=0>; rel="prev"';
  assert.deepEqual(parseLinkHeader(h), {
    next: "/resources?offset=50",
    prev: "/resources?offset=0",
  });
});

test("parseLinkHeader keeps urls that contain a comma", () => {
  const h =
    '</resources?q=a,b&offset=50>; rel="next", </resources?q=a,b>; rel="prev"';
  assert.deepEqual(parseLinkHeader(h), {
    next: "/resources?q=a,b&offset=50",
    prev: "/resources?q=a,b",
  });
});

test("parseLinkHeader reads rel that is unquoted or not first", () => {
  const h = '</resources?offset=50>; title="page 2"; rel=next';
  assert.deepEqual(parseLinkHeader(h), { next: "/resources?offset=50" });
});
