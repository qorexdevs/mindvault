import { eq, ne, and, or, ilike, asc, desc, count, countDistinct, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { resources, publishers, verifications } from "../db/schema.js";
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
} = {}) {
  const { column, direction } = resolveSort(opts.sort);
  const col =
    column === "price"
      ? sql`cast(${resources.price} as numeric)`
      : column === "title"
        ? sql`lower(${resources.title})`
        : resources.createdAt;
  const order = direction === "asc" ? asc(col) : desc(col);
  // price and title tie often, and equal sort keys have no inherent order in
  // postgres, so limit/offset paging could repeat or drop rows between pages.
  // break ties on the primary key for a stable order across requests.
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
    .orderBy(order, asc(resources.id))
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
  // min/max/avg/sum; avg and sum come
  // back rounded to USDC's 7 places, sum being the catalog value of the current view.
  // avgPaid is the average over paid items only, so free uploads don't drag it to 0.
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
      sum: row?.sumPrice ?? null,
    },
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
