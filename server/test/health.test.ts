import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";

// config.ts validates env at import time and exits on missing vars, so fill in
// dummies before pulling in createApp. /health touches no db, so they can be fake.
for (const [k, v] of Object.entries({
  PAY_TO: "GTEST",
  AGENT_SECRET_KEY: "STEST",
  OPENROUTER_API_KEY: "test",
  DATABASE_URL: "postgres://test",
  SUPABASE_URL: "http://localhost",
  SUPABASE_SERVICE_KEY: "test",
})) {
  process.env[k] ??= v;
}

let server: Server;
let base: string;

before(async () => {
  const { createApp } = await import("../src/app.js");
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  base = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  server.close();
});

test("GET /health reports ok with the service name", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(body.service, "mindvault");
  assert.ok(Date.parse(body.timestamp));
});

test("unknown routes fall through to 404", async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
});
