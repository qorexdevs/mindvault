import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";

let schema: typeof import("../src/db/schema.js");
let db: typeof import("../src/db/client.js")["db"];
let getVerificationDetails: typeof import("../src/services/resourceService.js")["getVerificationDetails"];
let resourceId: string;

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
  schema = await import("../src/db/schema.js");

  const pg = new PGlite();
  const testDb = drizzle(pg, { schema });
  for (const file of ["0000_unusual_klaw.sql", "0001_supreme_raza.sql"]) {
    const sql = readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    await pg.exec(sql.replace(/-->\s*statement-breakpoint/g, ""));
  }

  const client = await import("../src/db/client.js");
  client.__setTestDb(testDb as unknown as typeof client.db);
  db = client.db;
  ({ getVerificationDetails } = await import("../src/services/resourceService.js"));

  const [publisher] = await db
    .insert(schema.publishers)
    .values({ name: "Acme", email: "a@acme.dev", walletAddress: "GW", apiKeyHash: "h" })
    .returning();
  const [resource] = await db
    .insert(schema.resources)
    .values({
      publisherId: publisher.id,
      title: "Guide",
      price: "1",
      walletAddress: "GW",
      resourceType: "link",
      externalUrl: "https://example.com/guide",
    })
    .returning();
  const [verification] = await db
    .insert(schema.verifications)
    .values({
      resourceId: resource.id,
      isOriginal: false,
      confidence: 0.2,
      flags: "not valid json",
    })
    .returning();
  await db
    .update(schema.resources)
    .set({ verificationId: verification.id })
    .where(eq(schema.resources.id, resource.id));
  resourceId = resource.id;
});

test("getVerificationDetails tolerates malformed stored verification flags", async () => {
  const details = await getVerificationDetails(resourceId);
  assert.deepEqual(details?.verification?.flags, []);
});
