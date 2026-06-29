import { Router, type Router as RouterType } from "express";
import { z } from "zod/v4";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import {
  registerPublisher,
  getPublisherResources,
  getPublisherStorefront,
} from "../services/publisherService.js";
import { eq, inArray, desc, count, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { publishers, resources, payments } from "../db/schema.js";
import { config } from "../config.js";
import { leaderboardQuerySchema } from "../validation.js";
import { rankLeaderboard } from "../utils/leaderboard.js";
import { pageLinks } from "../utils/page.js";

const router: RouterType = Router();

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  walletAddress: z.string().min(1),
});

// POST /publishers — register a new publisher (public)
router.post("/publishers", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.format() });
    return;
  }

  try {
    const { publisher, apiKey } = await registerPublisher(parsed.data);
    res.status(201).json({
      id: publisher.id,
      name: publisher.name,
      email: publisher.email,
      walletAddress: publisher.walletAddress,
      apiKey, // shown once — store it securely
      createdAt: publisher.createdAt,
    });
  } catch (err: any) {
    if (err.message?.includes("unique")) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }
    throw err;
  }
});

// GET /publishers/wallet/:address — look up publisher by wallet (public)
router.get("/publishers/wallet/:address", async (req, res) => {
  const address = req.params.address as string;
  const publisher = await db
    .select({
      id: publishers.id,
      name: publishers.name,
      email: publishers.email,
      walletAddress: publishers.walletAddress,
      createdAt: publishers.createdAt,
    })
    .from(publishers)
    .where(eq(publishers.walletAddress, address))
    .then((rows) => rows[0] ?? null);

  if (!publisher) {
    res.status(404).json({ error: "No publisher found for this wallet" });
    return;
  }

  res.json(publisher);
});

// GET /publishers/me — own profile (authenticated)
router.get("/publishers/me", apiKeyAuth, async (req, res) => {
  const pub = req.publisher!;
  res.json({
    id: pub.id,
    name: pub.name,
    email: pub.email,
    walletAddress: pub.walletAddress,
    createdAt: pub.createdAt,
  });
});

// GET /publishers/me/resources — own resources (authenticated)
router.get("/publishers/me/resources", apiKeyAuth, async (req, res) => {
  const resources = await getPublisherResources(req.publisher!.id);
  res.json(resources);
});

// GET /publishers/me/analytics — earnings and stats (authenticated)
router.get("/publishers/me/analytics", apiKeyAuth, async (req, res) => {
  const publisherId = req.publisher!.id;

  // Get all resources for this publisher
  const pubResources = await db
    .select({
      id: resources.id,
      title: resources.title,
      price: resources.price,
      verificationStatus: resources.verificationStatus,
      listed: resources.listed,
      createdAt: resources.createdAt,
    })
    .from(resources)
    .where(eq(resources.publisherId, publisherId));

  const resourceIds = pubResources.map((r) => r.id);

  // Get all payments for these resources, newest first so recentPayments below
  // actually shows the latest sales instead of whatever order the db returns.
  let allPayments: any[] = [];
  if (resourceIds.length > 0) {
    allPayments = await db
      .select({
        id: payments.id,
        resourceId: payments.resourceId,
        payerAddress: payments.payerAddress,
        amount: payments.amount,
        paidAt: payments.paidAt,
      })
      .from(payments)
      .where(inArray(payments.resourceId, resourceIds))
      .orderBy(desc(payments.paidAt));
  }

  // Sum earnings in SQL numeric, not a JS parseFloat reduce, so a big catalog
  // can't drift the cents. Per-resource here, grand total below.
  const earnedByResource = new Map<string, string>();
  let summaryEarned = "0.0000000";
  if (resourceIds.length > 0) {
    const earnedRows = await db
      .select({
        resourceId: payments.resourceId,
        earned: sql<string>`round(sum(cast(${payments.amount} as numeric)), 7)`,
      })
      .from(payments)
      .where(inArray(payments.resourceId, resourceIds))
      .groupBy(payments.resourceId);
    for (const row of earnedRows) earnedByResource.set(row.resourceId, row.earned);

    const [tot] = await db
      .select({
        earned: sql<string>`round(sum(cast(${payments.amount} as numeric)), 7)`,
      })
      .from(payments)
      .where(inArray(payments.resourceId, resourceIds));
    summaryEarned = tot?.earned ?? "0.0000000";
  }

  // Compute per-resource stats
  const resourceStats = pubResources.map((r) => {
    const resourcePayments = allPayments.filter((p) => p.resourceId === r.id);
    return {
      id: r.id,
      title: r.title,
      price: r.price,
      accessUrl: `${config.BASE_URL}/resources/${r.id}`,
      verificationStatus: r.verificationStatus,
      listed: r.listed,
      createdAt: r.createdAt,
      totalSales: resourcePayments.length,
      totalEarned: earnedByResource.get(r.id) ?? "0.0000000",
      recentPayments: resourcePayments.slice(0, 5).map((p) => ({
        payerAddress: p.payerAddress,
        amount: p.amount,
        paidAt: p.paidAt,
      })),
    };
  });

  // Summary
  const totalEarned = summaryEarned;
  const totalSales = allPayments.length;
  // distinct wallets, so repeat buyers don't inflate the audience size
  const uniqueBuyers = new Set(allPayments.map((p) => p.payerAddress)).size;
  const totalResources = pubResources.length;
  const listedResources = pubResources.filter((r) => r.listed).length;
  const verifiedResources = pubResources.filter(
    (r) => r.verificationStatus === "verified"
  ).length;
  const rejectedResources = pubResources.filter(
    (r) => r.verificationStatus === "rejected"
  ).length;
  const pendingResources = pubResources.filter(
    (r) => r.verificationStatus === "pending"
  ).length;

  res.json({
    summary: {
      totalEarned,
      currency: "USDC",
      totalSales,
      uniqueBuyers,
      totalResources,
      listedResources,
      verification: {
        verified: verifiedResources,
        rejected: rejectedResources,
        pending: pendingResources,
      },
    },
    resources: resourceStats,
  });
});

// GET /publishers/leaderboard — public creator leaderboard
router.get("/publishers/leaderboard", async (req, res) => {
  const parsed = leaderboardQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  // Get all publishers with their resource and payment stats
  const allPublishers = await db.select().from(publishers);
  // resource counts per publisher in SQL, so the board doesn't pull every
  // resource row and re-count listed/verified in JS as the catalog grows.
  const resourceRows = await db
    .select({
      publisherId: resources.publisherId,
      totalResources: count(resources.id),
      listedResources: sql<number>`count(*) filter (where ${resources.listed})`,
      verifiedResources: sql<number>`count(*) filter (where ${resources.verificationStatus} = 'verified')`,
    })
    .from(resources)
    .groupBy(resources.publisherId);
  const statsByPublisher = new Map(resourceRows.map((r) => [r.publisherId, r]));
  // earnings and sale counts per publisher, summed in SQL numeric so the board
  // can't drift on a big catalog the way a parseFloat reduce would.
  const earnedRows = await db
    .select({
      publisherId: resources.publisherId,
      earned: sql<string>`round(sum(cast(${payments.amount} as numeric)), 7)`,
      sales: count(payments.id),
    })
    .from(payments)
    .innerJoin(resources, eq(payments.resourceId, resources.id))
    .groupBy(resources.publisherId);
  const earnedByPublisher = new Map(earnedRows.map((r) => [r.publisherId, r]));

  const leaderboard = allPublishers.map((pub) => {
    const stats = statsByPublisher.get(pub.id);
    const earned = earnedByPublisher.get(pub.id);

    return {
      id: pub.id,
      name: pub.name,
      walletAddress: pub.walletAddress,
      joinedAt: pub.createdAt,
      totalResources: Number(stats?.totalResources ?? 0),
      listedResources: Number(stats?.listedResources ?? 0),
      verifiedResources: Number(stats?.verifiedResources ?? 0),
      totalSales: Number(earned?.sales ?? 0),
      totalEarned: earned?.earned ?? "0.0000000",
    };
  });

  const total = leaderboard.length;
  res.set("X-Total-Count", String(total));
  if (parsed.data.limit !== undefined) {
    const links = pageLinks({
      path: "/publishers/leaderboard",
      query: { sort: parsed.data.sort },
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      total,
    });
    if (links) res.set("Link", links);
  }
  res.json(rankLeaderboard(leaderboard, parsed.data));
});

// GET /publishers/:id — public storefront for vetting a seller. Registered
// last so the static /publishers/* routes above win over the :id param.
router.get("/publishers/:id", async (req, res) => {
  const storefront = await getPublisherStorefront(req.params.id as string);
  if (!storefront) {
    res.status(404).json({ error: "Publisher not found" });
    return;
  }
  res.json({
    ...storefront,
    recentListings: storefront.recentListings.map((r) => ({
      ...r,
      accessUrl: `${config.BASE_URL}/resources/${r.id}`,
    })),
  });
});

export default router;
