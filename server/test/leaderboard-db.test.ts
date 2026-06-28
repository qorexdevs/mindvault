import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";

// db-backed leaderboard happy path the guard tests can't reach: seed publishers,
// resources and payments on an in-memory pglite postgres and check the earnings
// sums come back from SQL numeric, not a JS reduce. covers the per-publisher
// join, the zero-payment default and the earnings ranking end to end.
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

  const [acme, globex, initech] = await db
    .insert(schema.publishers)
    .values([
      { name: "Acme", email: "a@acme.dev", walletAddress: "GA", apiKeyHash: "h1" },
      { name: "Globex", email: "g@globex.dev", walletAddress: "GG", apiKeyHash: "h2" },
      { name: "Initech", email: "i@initech.dev", walletAddress: "GI", apiKeyHash: "h3" },
    ])
    .returning();

  const [a1, b1] = await db
    .insert(schema.resources)
    .values([
      { publisherId: acme.id, title: "A1", price: "1.5", walletAddress: "GA", resourceType: "link", externalUrl: "https://a1", listed: true, verificationStatus: "verified" },
      { publisherId: globex.id, title: "B1", price: "10", walletAddress: "GG", resourceType: "link", externalUrl: "https://b1", listed: true, verificationStatus: "verified" },
      { publisherId: initech.id, title: "C1", price: "3", walletAddress: "GI", resourceType: "link", externalUrl: "https://c1", listed: false, verificationStatus: "pending" },
    ])
    .returning();

  // Acme earns 1.5 + 2.25 + 0.25 = 4.0 over 3 sales, Globex 10.0 over 1, Initech nothing.
  await db.insert(schema.payments).values([
    { resourceId: a1.id, payerAddress: "P1", recipientAddress: "GA", amount: "1.5" },
    { resourceId: a1.id, payerAddress: "P2", recipientAddress: "GA", amount: "2.25" },
    { resourceId: a1.id, payerAddress: "P1", recipientAddress: "GA", amount: "0.25" },
    { resourceId: b1.id, payerAddress: "P3", recipientAddress: "GG", amount: "10" },
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

test("leaderboard sums earnings in SQL numeric and ranks by them", async () => {
  const res = await fetch(`${base}/publishers/leaderboard`);
  assert.equal(res.status, 200);
  const board = (await res.json()) as Array<{
    name: string;
    totalEarned: string;
    totalSales: number;
    totalResources: number;
    listedResources: number;
    verifiedResources: number;
  }>;

  assert.deepEqual(board.map((e) => e.name), ["Globex", "Acme", "Initech"]);

  const acme = board.find((e) => e.name === "Acme")!;
  assert.equal(acme.totalEarned, "4.0000000");
  assert.equal(acme.totalSales, 3);
  // resource counts come from the SQL group-by, not a JS filter
  assert.equal(acme.totalResources, 1);
  assert.equal(acme.listedResources, 1);
  assert.equal(acme.verifiedResources, 1);

  const globex = board.find((e) => e.name === "Globex")!;
  assert.equal(globex.totalEarned, "10.0000000");
  assert.equal(globex.totalSales, 1);

  // a publisher with no payments must read zero, not fall out of the board
  const initech = board.find((e) => e.name === "Initech")!;
  assert.equal(initech.totalEarned, "0.0000000");
  assert.equal(initech.totalSales, 0);
  assert.equal(initech.totalResources, 1);
  // C1 is unlisted and pending, so it counts toward neither
  assert.equal(initech.listedResources, 0);
  assert.equal(initech.verifiedResources, 0);
});
