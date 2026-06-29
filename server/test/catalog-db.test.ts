import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// the db-backed happy paths the route guard tests can't reach: catalog list,
// publish and the price patch run here against an in-memory pglite postgres so
// the queries, ordering, paging and filters execute for real without a live db.
let svc: typeof import("../src/services/resourceService.js");
let schema: typeof import("../src/db/schema.js");
let db: typeof import("../src/db/client.js")["db"];
let pubId: string;

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
  schema = await import("../src/db/schema.js");

  const pg = new PGlite();
  const tdb = drizzle(pg, { schema });
  for (const file of ["0000_unusual_klaw.sql", "0001_supreme_raza.sql"]) {
    const sql = readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    await pg.exec(sql.replace(/-->\s*statement-breakpoint/g, ""));
  }

  const client = await import("../src/db/client.js");
  client.__setTestDb(tdb as unknown as typeof client.db);
  db = client.db;
  svc = await import("../src/services/resourceService.js");

  const [pub] = await db
    .insert(schema.publishers)
    .values({ name: "Acme", email: "a@acme.dev", walletAddress: "GW", apiKeyHash: "h" })
    .returning();
  pubId = pub.id;

  await db.insert(schema.resources).values([
    { publisherId: pubId, title: "Alpha guide", description: "intro", price: "0", walletAddress: "GW", resourceType: "link", externalUrl: "https://a", listed: true, verificationStatus: "verified" },
    { publisherId: pubId, title: "Beta deck", description: "slides", price: "5.0", walletAddress: "GW", resourceType: "link", externalUrl: "https://b", listed: true, verificationStatus: "verified" },
    { publisherId: pubId, title: "Gamma pack", description: "bundle", price: "12.5", walletAddress: "GW", resourceType: "file", mimeType: "application/zip", listed: true, verificationStatus: "pending" },
    { publisherId: pubId, title: "Hidden draft", price: "9.0", walletAddress: "GW", resourceType: "link", externalUrl: "https://h", listed: false, verificationStatus: "verified" },
  ]);
});

test("listCatalog returns only listed rows", async () => {
  const rows = await svc.listCatalog();
  assert.equal(rows.length, 3);
  assert.ok(!rows.some((r) => r.title === "Hidden draft"));
});

test("countCatalog matches the listed total under the same filters", async () => {
  assert.equal(await svc.countCatalog(), 3);
  assert.equal(await svc.countCatalog({ free: true }), 1);
});

test("price sort orders numerically, not as text", async () => {
  const asc = await svc.listCatalog({ sort: "price_asc" });
  assert.deepEqual(asc.map((r) => r.price), ["0", "5.0", "12.5"]);
  const desc = await svc.listCatalog({ sort: "price_desc" });
  assert.deepEqual(desc.map((r) => r.price), ["12.5", "5.0", "0"]);
});

test("popular sort orders by sale count, newest breaks ties", async () => {
  const byTitle = Object.fromEntries(
    (await svc.listCatalog()).map((r) => [r.title, r.id])
  );
  // Beta deck sells twice, Gamma pack once, Alpha guide never
  await db.insert(schema.payments).values([
    { resourceId: byTitle["Beta deck"], payerAddress: "GP1", recipientAddress: "GW", amount: "5.0" },
    { resourceId: byTitle["Beta deck"], payerAddress: "GP2", recipientAddress: "GW", amount: "5.0" },
    { resourceId: byTitle["Gamma pack"], payerAddress: "GP3", recipientAddress: "GW", amount: "12.5" },
  ]);
  const rows = await svc.listCatalog({ sort: "popular" });
  assert.deepEqual(rows.map((r) => r.title), ["Beta deck", "Gamma pack", "Alpha guide"]);
});

test("trending sort counts only sales inside the window", async () => {
  const byTitle = Object.fromEntries(
    (await svc.listCatalog()).map((r) => [r.title, r.id])
  );
  // Alpha guide sold 3 times but 40 days ago; Beta and Gamma sold recently in
  // the popular test above. the default 7-day window ignores Alpha's old sales.
  const old = new Date(Date.now() - 40 * 86_400_000);
  await db.insert(schema.payments).values([
    { resourceId: byTitle["Alpha guide"], payerAddress: "GO1", recipientAddress: "GW", amount: "0", paidAt: old },
    { resourceId: byTitle["Alpha guide"], payerAddress: "GO2", recipientAddress: "GW", amount: "0", paidAt: old },
    { resourceId: byTitle["Alpha guide"], payerAddress: "GO3", recipientAddress: "GW", amount: "0", paidAt: old },
  ]);
  // all-time, Alpha leads with three sales
  const popular = await svc.listCatalog({ sort: "popular" });
  assert.equal(popular[0].title, "Alpha guide");
  // last 7 days, the old sales drop off so recent sellers lead and Alpha is last
  const trending = await svc.listCatalog({ sort: "trending" });
  assert.deepEqual(trending.map((r) => r.title), ["Beta deck", "Gamma pack", "Alpha guide"]);
  // a wide window pulls the old sales back in, Alpha leads again
  const wide = await svc.listCatalog({ sort: "trending", trendingDays: 90 });
  assert.equal(wide[0].title, "Alpha guide");
});

test("paging is stable across the limit and offset window", async () => {
  const first = await svc.listCatalog({ sort: "price_asc", limit: 2, offset: 0 });
  const second = await svc.listCatalog({ sort: "price_asc", limit: 2, offset: 2 });
  assert.equal(first.length, 2);
  assert.equal(second.length, 1);
  const ids = new Set([...first, ...second].map((r) => r.id));
  assert.equal(ids.size, 3);
});

test("filters narrow the catalog", async () => {
  assert.equal((await svc.listCatalog({ type: "file" })).length, 1);
  assert.equal((await svc.listCatalog({ free: true })).length, 1);
  assert.equal((await svc.listCatalog({ minPrice: 5 })).length, 2);
  assert.equal((await svc.listCatalog({ q: "deck" })).length, 1);
  assert.equal((await svc.listCatalog({ verified: false })).length, 1);
});

test("catalogStats aggregates over the filtered view", async () => {
  const stats = await svc.catalogStats();
  assert.equal(stats.total, 3);
  assert.equal(stats.sellers, 1);
  assert.equal(stats.byType.file, 1);
  assert.equal(stats.byPrice.free, 1);
  assert.equal(stats.price.max, "12.5");
});

test("catalogFacets lists distinct mimes and publishers under the filter", async () => {
  const facets = await svc.catalogFacets();
  assert.deepEqual(facets.mimeTypes, [{ value: "application/zip", count: 1 }]);
  assert.deepEqual(facets.publishers, [{ value: "Acme", count: 3 }]);
  // 0, 5.0 and 12.5 fall in free and 5_to_20, kept in ascending order
  assert.deepEqual(facets.priceRanges, [
    { value: "free", count: 1 },
    { value: "5_to_20", count: 2 },
  ]);
});

test("catalogFacets narrows with the catalog filters", async () => {
  // free=true drops the two paid rows, leaving the free link with no mimeType
  const free = await svc.catalogFacets({ free: true });
  assert.equal(free.mimeTypes.length, 0);
  assert.deepEqual(free.publishers, [{ value: "Acme", count: 1 }]);
  assert.deepEqual(free.priceRanges, [{ value: "free", count: 1 }]);
});

test("createLinkResource publishes an unlisted link", async () => {
  const r = await svc.createLinkResource({
    publisherId: pubId,
    title: "Delta notes",
    price: "1.0",
    walletAddress: "GW",
    externalUrl: "https://d",
  });
  assert.equal(r.resourceType, "link");
  assert.equal(r.listed, false);
  assert.equal(r.externalUrl, "https://d");
});

test("updateResource patches the price for the owner only", async () => {
  const [target] = await db
    .insert(schema.resources)
    .values({ publisherId: pubId, title: "Patch me", price: "2.0", walletAddress: "GW", resourceType: "link", externalUrl: "https://p", listed: true })
    .returning();

  const ok = await svc.updateResource(target.id, pubId, { price: "3.5", title: "Patched" });
  assert.equal(ok?.price, "3.5");
  assert.equal(ok?.title, "Patched");

  const wrong = await svc.updateResource(target.id, "someone-else", { price: "9.9" });
  assert.equal(wrong, null);
});
