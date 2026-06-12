import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import healthRouter from "../src/routes/health.js";

// mount the health router on its own app: it depends on nothing but express,
// so the test stays free of db/supabase config and runs anywhere.
let server: Server;
let base: string;

before(async () => {
  const app = express();
  app.use(healthRouter);
  server = app.listen(0);
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
