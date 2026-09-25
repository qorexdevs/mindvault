import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";

let server: Server;
let base: string;
let listedId: string;
let hiddenId: string;

before(async () => {
  const env: Record<string, string> = {
    PAY_TO: "GTEST",
    AGENT_SECRET_KEY: "test-secret",
    OPENROUTER_API_KEY: "test-key",
    DATABASE_URL: "postgres://user:pass@localhost:5432/test",
    SUPABASE_URL: "http://localhost:54321",
    SUPABASE_SERVICE_KEY: "test-service-key",
  };
  for (const [key, value] of Object.entries(env)) {
    if (!process.env[key]) process.env[key] = value;
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("../src/db/schema.js");
  const pg = new PGlite();
  const testDb = drizzle(pg, { schema });
  for (const file of ["0000_unusual_klaw.sql", "0001_supreme_raza.sql"]) {
    const sql = readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    await pg.exec(sql.replace(/-->\s*statement-breakpoint/g, ""));
  }

  const client = await import("../src/db/client.js");
  client.__setTestDb(testDb as unknown as typeof client.db);
  const [publisher] = await client.db
    .insert(schema.publishers)
    .values({ name: "Acme", email: "a@acme.dev", walletAddress: "GW", apiKeyHash: "h" })
    .returning();
  const rows = await client.db
    .insert(schema.resources)
    .values([
      {
        publisherId: publisher.id,
        title: "Paid guide",
        price: "1",
        walletAddress: "GW",
        resourceType: "link",
        externalUrl: "https://example.com/paid",
        listed: true,
      },
      {
        publisherId: publisher.id,
        title: "Hidden draft",
        price: "1",
        walletAddress: "GW",
        resourceType: "link",
        externalUrl: "https://example.com/hidden",
        listed: false,
      },
    ])
    .returning();
  listedId = rows[0].id;
  hiddenId = rows[1].id;

  const { default: resourceRouter } = await import("../src/routes/resources.js");
  const express = (await import("express")).default;
  const app = express();
  app.use(resourceRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  base = `http://127.0.0.1:${address.port}`;
});

after(() => {
  server.close();
});

test("GET /resources/:id returns payment requirements for a listed resource", async () => {
  const res = await fetch(`${base}/resources/${listedId}`);
  assert.equal(res.status, 402);
  assert.ok(res.headers.get("payment-required"));
});

test("GET /resources/:id keeps unlisted resources behind a 404", async () => {
  const res = await fetch(`${base}/resources/${hiddenId}`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "Resource not listed" });
});
