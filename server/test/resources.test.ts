import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";

// integration coverage for the db-backed catalog routes. we mount the real
// resources router through express and hit the guards that return before any
// query - bad paging on the list, a write without a key - so the route wiring
// and middleware order are covered without a live database. the happy paths
// still need a real postgres and are left to the e2e script.
let server: Server;
let base: string;

before(async () => {
  const env: Record<string, string> = {
    PAY_TO: "GTEST",
    AGENT_SECRET_KEY: "test-secret",
    OPENROUTER_API_KEY: "test-key",
    DATABASE_URL: "postgres://user:pass@localhost:5432/test",
    SUPABASE_URL: "http://localhost:54321",
    SUPABASE_SERVICE_KEY: "test-service-key",
  };
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const { default: resourcesRouter } = await import("../src/routes/resources.js");
  const app = express();
  app.use(express.json());
  app.use(resourcesRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  base = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  server.close();
});

test("GET /resources rejects an over-cap limit before querying", async () => {
  const res = await fetch(`${base}/resources?limit=101`);
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);
});

test("GET /resources/stats rejects a bad sort before querying", async () => {
  const res = await fetch(`${base}/resources/stats?sort=cheapest`);
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);
});

test("POST /resources needs an api key", async () => {
  const res = await fetch(`${base}/resources`, { method: "POST" });
  assert.equal(res.status, 401);
});

test("PATCH /resources/:id needs an api key", async () => {
  const res = await fetch(`${base}/resources/abc`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ price: "1.0" }),
  });
  assert.equal(res.status, 401);
});

test("DELETE /resources/:id needs an api key", async () => {
  const res = await fetch(`${base}/resources/abc`, { method: "DELETE" });
  assert.equal(res.status, 401);
});
