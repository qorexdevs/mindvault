import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";

// db-backed public storefront happy path. seed two publishers with a mix of
// listed/unlisted and verified/pending resources plus a few sales, then check
// GET /publishers/:id returns the trust stats from SQL and never leaks email,
// earnings or buyer addresses. a delisted-but-sold resource must still count
// toward totalSales, and an unknown id must 404.
let server: Server;
let base: string;
let acmeId: string;

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

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("../src/db/schema.js");

  const pg = new PGlite();
  const tdb = drizzle(pg, { schema });
  for (const file of ["0000_unusual_klaw.sql", "0001_supreme_raza.sql"]) {
    const sql = readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    await pg.exec(sql.replace(/-->\s*statement-breakpoint/g, ""));
  }

  const client = await import("../src/db/client.js");
  client.__setTestDb(tdb as unknown as typeof client.db);
  const db = client.db;

  const [acme] = await db
    .insert(schema.publishers)
    .values([
      { name: "Acme", email: "secret@acme.dev", walletAddress: "GA", apiKeyHash: "h1" },
    ])
    .returning();
  acmeId = acme.id;

  // A1 listed+verified, A2 listed+pending, A3 unlisted+verified (sold then
  // delisted). listed=2, verified=2, and A3's sale still counts.
  const [a1, , a3] = await db
    .insert(schema.resources)
    .values([
      { publisherId: acme.id, title: "A1", price: "1.5", walletAddress: "GA", resourceType: "link", externalUrl: "https://a1", listed: true, verificationStatus: "verified" },
      { publisherId: acme.id, title: "A2", price: "2", walletAddress: "GA", resourceType: "link", externalUrl: "https://a2", listed: true, verificationStatus: "pending" },
      { publisherId: acme.id, title: "A3", price: "3", walletAddress: "GA", resourceType: "link", externalUrl: "https://a3", listed: false, verificationStatus: "verified" },
    ])
    .returning();

  await db.insert(schema.payments).values([
    { resourceId: a1.id, payerAddress: "P1", recipientAddress: "GA", amount: "1.5" },
    { resourceId: a1.id, payerAddress: "P2", recipientAddress: "GA", amount: "1.5" },
    { resourceId: a3.id, payerAddress: "P3", recipientAddress: "GA", amount: "3" },
  ]);

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

test("storefront returns public profile and SQL trust stats", async () => {
  const res = await fetch(`${base}/publishers/${acmeId}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    id: string;
    name: string;
    walletAddress: string;
    email?: string;
    stats: { listed: number; verified: number; totalSales: number; firstListedAt: string | null; lastListedAt: string | null };
  };

  assert.equal(body.name, "Acme");
  assert.equal(body.walletAddress, "GA");
  // only listed resources count toward the public listed total
  assert.equal(body.stats.listed, 2);
  assert.equal(body.stats.verified, 2);
  // A3 was delisted but its sale still counts: 2 on A1 + 1 on A3
  assert.equal(body.stats.totalSales, 3);
  assert.ok(body.stats.firstListedAt);
  assert.ok(body.stats.lastListedAt);
});

test("storefront previews listed resources only, with accessUrl", async () => {
  const res = await fetch(`${base}/publishers/${acmeId}`);
  const body = (await res.json()) as {
    recentListings: { title: string; accessUrl: string }[];
  };
  // A1 and A2 are listed, A3 is delisted and must not show in the storefront
  const titles = body.recentListings.map((r) => r.title).sort();
  assert.deepEqual(titles, ["A1", "A2"]);
  assert.ok(body.recentListings.every((r) => r.accessUrl.includes("/resources/")));
});

test("storefront never leaks email, earnings or buyer addresses", async () => {
  const res = await fetch(`${base}/publishers/${acmeId}`);
  const raw = await res.text();
  assert.ok(!raw.includes("secret@acme.dev"));
  assert.ok(!raw.includes("totalEarned"));
  assert.ok(!raw.includes("payerAddress"));
});

test("storefront 404s on an unknown publisher", async () => {
  const res = await fetch(`${base}/publishers/does-not-exist`);
  assert.equal(res.status, 404);
  assert.ok((await res.json()).error);
});
