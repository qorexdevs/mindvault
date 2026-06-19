import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";

// the api key gate is what stands in front of every write route, but its reject
// path was untested. mount it on a throwaway app and hit it through express so
// we cover the wiring, not just the function. the missing-key branch returns
// before any db query, so this needs no real database - just enough fake env
// that config.ts doesn't bail on import.
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

  const { apiKeyAuth } = await import("../src/middleware/apiKeyAuth.js");
  const app = express();
  app.post("/guarded", apiKeyAuth, (_req, res) => {
    res.json({ ok: true });
  });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  base = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  server.close();
});

test("a request with no x-api-key is rejected before any lookup", async () => {
  const res = await fetch(`${base}/guarded`, { method: "POST" });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, "Missing x-api-key header");
});

test("an empty x-api-key counts as missing", async () => {
  const res = await fetch(`${base}/guarded`, {
    method: "POST",
    headers: { "x-api-key": "" },
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, "Missing x-api-key header");
});
