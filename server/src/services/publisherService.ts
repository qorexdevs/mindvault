import { eq, inArray, desc, and, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { publishers, resources, payments } from "../db/schema.js";
import { generateApiKey, hashApiKey } from "../utils/crypto.js";

export async function registerPublisher(data: {
  name: string;
  email: string;
  walletAddress: string;
}) {
  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);

  const [publisher] = await db
    .insert(publishers)
    .values({
      name: data.name,
      email: data.email,
      walletAddress: data.walletAddress,
      apiKeyHash,
    })
    .returning();

  return { publisher, apiKey };
}

export async function getPublisherById(id: string) {
  return db
    .select()
    .from(publishers)
    .where(eq(publishers.id, id))
    .then((rows) => rows[0] ?? null);
}

export async function getPublisherResources(publisherId: string) {
  return db
    .select()
    .from(resources)
    .where(eq(resources.publisherId, publisherId));
}

// Public storefront for vetting a seller before buying. Returns the same
// non-PII profile fields as the wallet lookup plus trust stats: how much they
// have published, how much of it passed verification, and how many sales they
// have made. Deliberately excludes earnings, buyer addresses and email — those
// stay behind apiKeyAuth in /me/analytics. Null when the publisher is unknown.
export async function getPublisherStorefront(id: string) {
  const publisher = await db
    .select({
      id: publishers.id,
      name: publishers.name,
      walletAddress: publishers.walletAddress,
      createdAt: publishers.createdAt,
    })
    .from(publishers)
    .where(eq(publishers.id, id))
    .then((rows) => rows[0] ?? null);

  if (!publisher) return null;

  // listed is what the catalog shows; verified scopes to listed too so it reads
  // as "x of the listed total passed verification" — a delisted resource can't
  // push verified past listed and break the trust ratio. firstListedAt/lastListedAt
  // frame how active the seller is, all three scoped to listed resources only.
  const [counts] = await db
    .select({
      listed: sql<number>`count(*) filter (where ${resources.listed})`,
      verified: sql<number>`count(*) filter (where ${resources.listed} and ${resources.verificationStatus} = 'verified')`,
      firstListedAt: sql<Date | null>`min(${resources.createdAt}) filter (where ${resources.listed})`,
      lastListedAt: sql<Date | null>`max(${resources.createdAt}) filter (where ${resources.listed})`,
    })
    .from(resources)
    .where(eq(resources.publisherId, id));

  // Sale count over every resource they ever published, not just the listed
  // ones, so delisting a sold resource doesn't erase its track record.
  const resourceIds = await db
    .select({ id: resources.id })
    .from(resources)
    .where(eq(resources.publisherId, id))
    .then((rows) => rows.map((r) => r.id));

  let totalSales = 0;
  if (resourceIds.length > 0) {
    const [sales] = await db
      .select({ n: sql<number>`count(*)` })
      .from(payments)
      .where(inArray(payments.resourceId, resourceIds));
    totalSales = Number(sales?.n ?? 0);
  }

  // A sample of what they actually sell, so vetting a seller is one call
  // instead of a storefront read plus a /resources?publisher= follow-up. Only
  // listed resources, newest first, capped — the full set is the catalog's job.
  const recentListings = await db
    .select({
      id: resources.id,
      title: resources.title,
      resourceType: resources.resourceType,
      price: resources.price,
      verificationStatus: resources.verificationStatus,
      createdAt: resources.createdAt,
    })
    .from(resources)
    .where(and(eq(resources.publisherId, id), eq(resources.listed, true)))
    .orderBy(desc(resources.createdAt))
    .limit(5);

  return {
    id: publisher.id,
    name: publisher.name,
    walletAddress: publisher.walletAddress,
    memberSince: publisher.createdAt,
    stats: {
      listed: Number(counts?.listed ?? 0),
      verified: Number(counts?.verified ?? 0),
      totalSales,
      firstListedAt: counts?.firstListedAt ?? null,
      lastListedAt: counts?.lastListedAt ?? null,
    },
    recentListings,
  };
}
