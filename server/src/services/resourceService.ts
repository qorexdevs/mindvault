import { eq, and, or, ilike, asc, desc, count, sql } from "drizzle-orm";
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
  minPrice?: number;
  maxPrice?: number;
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
  // price is stored as text, cast to numeric so the bounds compare like numbers
  if (opts.minPrice !== undefined) {
    conditions.push(sql`cast(${resources.price} as numeric) >= ${opts.minPrice}`);
  }
  if (opts.maxPrice !== undefined) {
    conditions.push(sql`cast(${resources.price} as numeric) <= ${opts.maxPrice}`);
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
    column === "price" ? sql`cast(${resources.price} as numeric)` : resources.createdAt;
  const order = direction === "asc" ? asc(col) : desc(col);
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
    .orderBy(order)
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
}

export async function countCatalog(opts: CatalogFilter = {}) {
  const [row] = await db
    .select({ total: count() })
    .from(resources)
    .where(catalogConditions(opts));
  return row?.total ?? 0;
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
