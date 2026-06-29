import { eq, ne, and, or, ilike, asc, desc, count, countDistinct, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { resources, publishers, verifications, payments } from "../db/schema.js";
import { uploadFile, deleteFile } from "../storage/supabaseStorage.js";
import { escapeLike } from "../utils/like.js";
import { resolveSort, type CatalogSort } from "../utils/sort.js";

export async function createFileResource(data: {
  publisherId: string;
  title: string;
  description?: string;
  price: string;
  walletAddress: string;
  fileBuffer: Buffer;
  filename: string;
  mimeType: string;
}) {
  const [resource] = await db
    .insert(resources)
    .values({
      publisherId: data.publisherId,
      title: data.title,
      description: data.description,
      price: data.price,
      walletAddress: data.walletAddress,
      resourceType: "file",
      mimeType: data.mimeType,
    })
    .returning();

  const storagePath = await uploadFile(
    resource.id,
    data.fileBuffer,
    data.filename,
    data.mimeType
  );

  const [updated] = await db
    .update(resources)
    .set({ storagePath })
    .where(eq(resources.id, resource.id))
    .returning();

  return updated;
}

export async function createLinkResource(data: {
  publisherId: string;
  title: string;
  description?: string;
  price: string;
  walletAddress: string;
  externalUrl: string;
}) {
  const [resource] = await db
    .insert(resources)
    .values({
      publisherId: data.publisherId,
      title: data.title,
      description: data.description,
      price: data.price,
      walletAddress: data.walletAddress,
      resourceType: "link",
      externalUrl: data.externalUrl,
    })
    .returning();

  return resource;
}

export async function getResourceById(id: string) {
  return db
    .select()
    .from(resources)
    .where(eq(resources.id, id))
    .then((rows) => rows[0] ?? null);
}

type CatalogFilter = {
  q?: string;
  type?: "file" | "link";
  mime?: string;
  publisher?: string;
  verified?: boolean;
  status?: "pending" | "verified" | "rejected";
  free?: boolean;
  minPrice?: number;
  maxPrice?: number;
  createdAfter?: Date;
  createdBefore?: Date;
};

function catalogConditions(opts: CatalogFilter) {
  const conditions = [eq(resources.listed, true)];
  if (opts.q) {
    const pattern = `%${escapeLike(opts.q)}%`;
    conditions.push(
      or(ilike(resources.title, pattern), ilike(resources.description, pattern))!
    );
  }
  if (opts.type) {
    conditions.push(eq(resources.resourceType, opts.type));
  }
  if (opts.mime) {
    conditions.push(ilike(resources.mimeType, `${escapeLike(opts.mime)}%`));
  }
  if (opts.publisher) {
    conditions.push(ilike(publishers.name, `%${escapeLike(opts.publisher)}%`));
  }
  // status is the exact match; verified is the coarse true/everything-else split.
  // when both arrive status takes over, so verified can't fight it into an empty page.
  if (opts.status !== undefined) {
    conditions.push(eq(resources.verificationStatus, opts.status));
  } else if (opts.verified !== undefined) {
    // verified=false means "show the rest", not "ignore the filter", so it has to
    // exclude verified rows explicitly instead of falling through like a truthy check would
    conditions.push(
      opts.verified
        ? eq(resources.verificationStatus, "verified")
        : ne(resources.verificationStatus, "verified")
    );
  }
  // free splits on price 0 vs anything above it; price is text so cast to numeric
  if (opts.free !== undefined) {
    conditions.push(
      opts.free
        ? sql`cast(${resources.price} as numeric) = 0`
        : sql`cast(${resources.price} as numeric) > 0`
    );
  }
  // price is stored as text, cast to numeric so the bounds compare like numbers
  if (opts.minPrice !== undefined) {
    conditions.push(sql`cast(${resources.price} as numeric) >= ${opts.minPrice}`);
  }
  if (opts.maxPrice !== undefined) {
    conditions.push(sql`cast(${resources.price} as numeric) <= ${opts.maxPrice}`);
  }
  if (opts.createdAfter !== undefined) {
    conditions.push(gte(resources.createdAt, opts.createdAfter));
  }
  if (opts.createdBefore !== undefined) {
    conditions.push(lte(resources.createdAt, opts.createdBefore));
  }
  return and(...conditions);
}

export async function listCatalog(opts: CatalogFilter & {
  limit?: number;
  offset?: number;
  sort?: CatalogSort;
  trendingDays?: number;
} = {}) {
  const { column, direction } = resolveSort(opts.sort);
  // trending counts only payments newer than the cutoff, so what's selling this
  // week outranks an all-time leader that's gone quiet. window defaults to 7 days.
  const trendingCutoff = new Date(Date.now() - (opts.trendingDays ?? 7) * 86_400_000);
  const col =
    column === "price"
      ? sql`cast(${resources.price} as numeric)`
      : column === "title"
        ? sql`lower(${resources.title})`
        : column === "sales"
          ? sql`(select count(*) from ${payments} where ${payments.resourceId} = ${resources.id})`
          : column === "recent_sales"
            ? sql`(select count(*) from ${payments} where ${payments.resourceId} = ${resources.id} and ${payments.paidAt} >= ${trendingCutoff})`
            : resources.createdAt;
  const order = direction === "asc" ? asc(col) : desc(col);
  // price and title tie often, and equal sort keys have no inherent order in
  // postgres, so limit/offset paging could repeat or drop rows between pages.
  // break ties on the primary key for a stable order across requests. sale-count
  // ties are common (most resources have zero), so settle them by newest first
  // before the id, so the order reads sensibly.
  const tiebreak =
    column === "sales" || column === "recent_sales"
      ? [desc(resources.createdAt), asc(resources.id)]
      : [asc(resources.id)];
  return db
    .select({
      id: resources.id,
      title: resources.title,
      description: resources.description,
      price: resources.price,
      resourceType: resources.resourceType,
      mimeType: resources.mimeType,
      publisherName: publishers.name,
      createdAt: resources.createdAt,
    })
    .from(resources)
    .innerJoin(publishers, eq(resources.publisherId, publishers.id))
    .where(catalogConditions(opts))
    .orderBy(order, ...tiebreak)
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
}

export async function countCatalog(opts: CatalogFilter = {}) {
  const [row] = await db
    .select({ total: count() })
    .from(resources)
    .innerJoin(publishers, eq(resources.publisherId, publishers.id))
    .where(catalogConditions(opts));
  return row?.total ?? 0;
}

export async function catalogStats(opts: CatalogFilter = {}) {
  // one-pass dashboard counters over the same filters as the catalog: total,
  // the distinct seller count, the file/link split, the verification split, the
  // free/paid split, and the price range. price is text, so cast it for
  // min/max/avg/median/sum; avg, median and sum come
  // back rounded to USDC's 7 places, sum being the catalog value of the current view.
  // avgPaid is the average over paid items only, so free uploads don't drag it to 0.
  // median is the 50th percentile, less skewed by a handful of pricey items than avg.
  const [row] = await db
    .select({
      total: count(),
      sellers: countDistinct(resources.publisherId),
      files: sql<number>`count(*) filter (where ${resources.resourceType} = 'file')`,
      links: sql<number>`count(*) filter (where ${resources.resourceType} = 'link')`,
      pending: sql<number>`count(*) filter (where ${resources.verificationStatus} = 'pending')`,
      verified: sql<number>`count(*) filter (where ${resources.verificationStatus} = 'verified')`,
      rejected: sql<number>`count(*) filter (where ${resources.verificationStatus} = 'rejected')`,
      free: sql<number>`count(*) filter (where cast(${resources.price} as numeric) = 0)`,
      minPrice: sql<string | null>`min(cast(${resources.price} as numeric))`,
      maxPrice: sql<string | null>`max(cast(${resources.price} as numeric))`,
      avgPrice: sql<string | null>`round(avg(cast(${resources.price} as numeric)), 7)`,
      avgPaidPrice: sql<string | null>`round(avg(cast(${resources.price} as numeric)) filter (where cast(${resources.price} as numeric) > 0), 7)`,
      medianPrice: sql<string | null>`round(percentile_cont(0.5) within group (order by cast(${resources.price} as numeric))::numeric, 7)`,
      sumPrice: sql<string | null>`round(sum(cast(${resources.price} as numeric)), 7)`,
    })
    .from(resources)
    .innerJoin(publishers, eq(resources.publisherId, publishers.id))
    .where(catalogConditions(opts));

  return {
    total: Number(row?.total ?? 0),
    sellers: Number(row?.sellers ?? 0),
    byType: { file: Number(row?.files ?? 0), link: Number(row?.links ?? 0) },
    byStatus: {
      pending: Number(row?.pending ?? 0),
      verified: Number(row?.verified ?? 0),
      rejected: Number(row?.rejected ?? 0),
    },
    byPrice: {
      free: Number(row?.free ?? 0),
      paid: Number(row?.total ?? 0) - Number(row?.free ?? 0),
    },
    price: {
      min: row?.minPrice ?? null,
      max: row?.maxPrice ?? null,
      avg: row?.avgPrice ?? null,
      avgPaid: row?.avgPaidPrice ?? null,
      median: row?.medianPrice ?? null,
      sum: row?.sumPrice ?? null,
    },
  };
}

// price ranges in ascending order, so a client can build a price filter
// without guessing the catalog's spread. boundaries are in USDC.
const PRICE_BUCKETS = ["free", "under_1", "1_to_5", "5_to_20", "20_plus"] as const;

export async function catalogFacets(opts: CatalogFilter = {}) {
  // the distinct values available under the current filter so a client can
  // build mime/publisher dropdowns without scanning the whole catalog. each
  // facet is its own grouped count, ordered by frequency then value so the
  // list is stable across requests. links have no mimeType, drop those nulls.
  // priceRanges is a fixed taxonomy, so it keeps the ascending order and only
  // returns ranges that actually hold something under the filter.
  const where = catalogConditions(opts);
  const priceBucket = sql<string>`case
    when cast(${resources.price} as numeric) = 0 then 'free'
    when cast(${resources.price} as numeric) < 1 then 'under_1'
    when cast(${resources.price} as numeric) < 5 then '1_to_5'
    when cast(${resources.price} as numeric) < 20 then '5_to_20'
    else '20_plus' end`;
  const [mimeTypes, pubs, prices] = await Promise.all([
    db
      .select({ value: resources.mimeType, count: count() })
      .from(resources)
      .innerJoin(publishers, eq(resources.publisherId, publishers.id))
      .where(and(where, sql`${resources.mimeType} is not null`))
      .groupBy(resources.mimeType)
      .orderBy(desc(count()), asc(resources.mimeType)),
    db
      .select({ value: publishers.name, count: count() })
      .from(resources)
      .innerJoin(publishers, eq(resources.publisherId, publishers.id))
      .where(where)
      .groupBy(publishers.name)
      .orderBy(desc(count()), asc(publishers.name)),
    db
      .select({ value: priceBucket, count: count() })
      .from(resources)
      .innerJoin(publishers, eq(resources.publisherId, publishers.id))
      .where(where)
      .groupBy(priceBucket),
  ]);
  const priceCounts = new Map(prices.map((r) => [r.value, Number(r.count)]));
  return {
    mimeTypes: mimeTypes.map((r) => ({ value: r.value, count: Number(r.count) })),
    publishers: pubs.map((r) => ({ value: r.value, count: Number(r.count) })),
    priceRanges: PRICE_BUCKETS.filter((b) => priceCounts.has(b)).map((b) => ({
      value: b,
      count: priceCounts.get(b)!,
    })),
  };
}

export async function getResourceMeta(id: string) {
  const result = await db
    .select({
      id: resources.id,
      title: resources.title,
      description: resources.description,
      price: resources.price,
      resourceType: resources.resourceType,
      mimeType: resources.mimeType,
      verificationStatus: resources.verificationStatus,
      publisherName: publishers.name,
      publisherWallet: resources.walletAddress,
      createdAt: resources.createdAt,
    })
    .from(resources)
    .innerJoin(publishers, eq(resources.publisherId, publishers.id))
    .where(eq(resources.id, id))
    .then((rows) => rows[0] ?? null);

  return result;
}

export async function updateResource(
  id: string,
  publisherId: string,
  fields: { title?: string; description?: string; price?: string }
) {
  const [resource] = await db
    .update(resources)
    .set(fields)
    .where(and(eq(resources.id, id), eq(resources.publisherId, publisherId)))
    .returning();

  return resource ?? null;
}

export async function delistResource(id: string, publisherId: string) {
  const [resource] = await db
    .update(resources)
    .set({ listed: false })
    .where(and(eq(resources.id, id), eq(resources.publisherId, publisherId)))
    .returning();

  if (!resource) return null;

  if (resource.storagePath) {
    await deleteFile(resource.storagePath);
  }

  return resource;
}

export async function getVerificationDetails(resourceId: string) {
  const resource = await db
    .select({
      id: resources.id,
      title: resources.title,
      verificationStatus: resources.verificationStatus,
      verificationId: resources.verificationId,
      listed: resources.listed,
      createdAt: resources.createdAt,
    })
    .from(resources)
    .where(eq(resources.id, resourceId))
    .then((rows) => rows[0] ?? null);

  if (!resource) return null;

  let verification = null;
  if (resource.verificationId) {
    verification = await db
      .select()
      .from(verifications)
      .where(eq(verifications.id, resource.verificationId))
      .then((rows) => rows[0] ?? null);
  }

  return {
    resourceId: resource.id,
    title: resource.title,
    status: resource.verificationStatus,
    listed: resource.listed,
    publishedAt: resource.createdAt,
    verification: verification
      ? {
          isOriginal: verification.isOriginal,
          confidence: verification.confidence,
          flags: verification.flags ? JSON.parse(verification.flags) : [],
          checkedAt: verification.checkedAt,
        }
      : null,
  };
}
