import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";

// integration coverage for the db-backed publisher routes. same trick as
// resources.test.ts: mount the real router and hit the guards that return
// before any query - bad leaderboard paging, a register with a junk body, the
// authenticated endpoints without a key. the happy paths need a real postgres
// and stay in the e2e script.
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

  const { default: publishersRouter } = await import("../src/routes/publishers.js");
  const app = express();
  app.use(express.json());
  app.use(publishersRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  base = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  server.close();
});

test("GET /publishers/leaderboard rejects an over-cap limit before querying", async () => {
  const res = await fetch(`${base}/publishers/leaderboard?limit=101`);
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);
});

test("GET /publishers/leaderboard rejects a negative offset before querying", async () => {
  const res = await fetch(`${base}/publishers/leaderboard?offset=-1`);
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);
});

test("GET /publishers/leaderboard rejects a bad sort before querying", async () => {
  const res = await fetch(`${base}/publishers/leaderboard?sort=richest`);
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);
});

test("POST /publishers rejects a junk body before querying", async () => {
  const res = await fetch(`${base}/publishers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "", email: "not-an-email" }),
  });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);
});

test("GET /publishers/me needs an api key", async () => {
  const res = await fetch(`${base}/publishers/me`);
  assert.equal(res.status, 401);
});

test("GET /publishers/me/resources needs an api key", async () => {
  const res = await fetch(`${base}/publishers/me/resources`);
  assert.equal(res.status, 401);
});

test("GET /publishers/me/analytics needs an api key", async () => {
  const res = await fetch(`${base}/publishers/me/analytics`);
  assert.equal(res.status, 401);
});
