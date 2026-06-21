import { Router, type Router as RouterType } from "express";
import multer from "multer";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { dynamicPaywall, evictPaywallCache } from "../middleware/dynamicPaywall.js";
import {
  createFileResource,
  createLinkResource,
  listCatalog,
  countCatalog,
  getResourceMeta,
  getVerificationDetails,
  updateResource,
  delistResource,
} from "../services/resourceService.js";
import { downloadFile } from "../storage/supabaseStorage.js";
import { db } from "../db/client.js";
import { payments } from "../db/schema.js";
import { config } from "../config.js";
import { priceSchema, catalogQuerySchema, resourcePatchSchema, linkSchema } from "../validation.js";
import { pageLinks } from "../utils/page.js";

const router: RouterType = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_FILE_SIZE_MB * 1024 * 1024 },
});

// POST /resources — publish a resource (authenticated)
router.post("/resources", apiKeyAuth, upload.single("file"), async (req, res) => {
  const publisher = req.publisher!;

  // File upload
  if (req.file) {
    const { title, description, price, walletAddress } = req.body;

    if (!title || !price) {
      res.status(400).json({ error: "title and price are required" });
      return;
    }

    const priceCheck = priceSchema.safeParse(price);
    if (!priceCheck.success) {
      res.status(400).json({ error: priceCheck.error.issues[0].message });
      return;
    }

    const resource = await createFileResource({
      publisherId: publisher.id,
      title,
      description,
      price,
      walletAddress: walletAddress || publisher.walletAddress,
      fileBuffer: req.file.buffer,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
    });

    res.status(201).json({
      ...resource,
      accessUrl: `${config.BASE_URL}/resources/${resource.id}`,
    });
    return;
  }

  // Link resource
  const parsed = linkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.format() });
    return;
  }

  const resource = await createLinkResource({
    publisherId: publisher.id,
    title: parsed.data.title,
    description: parsed.data.description,
    price: parsed.data.price,
    walletAddress: parsed.data.walletAddress || publisher.walletAddress,
    externalUrl: parsed.data.externalUrl,
  });

  res.status(201).json({
    ...resource,
    accessUrl: `${config.BASE_URL}/resources/${resource.id}`,
  });
});

// GET /resources — browse catalog (public)
router.get("/resources", async (req, res) => {
  const parsed = catalogQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const { q, type, publisher, verified, minPrice, maxPrice } = parsed.data;
  const filter = { q, type, publisher, verified, minPrice, maxPrice };
  const [catalog, total] = await Promise.all([
    listCatalog(parsed.data),
    countCatalog(filter),
  ]);
  res.set("X-Total-Count", String(total));
  const links = pageLinks({
    path: "/resources",
    query: { q, type, publisher, verified, minPrice, maxPrice, sort: parsed.data.sort },
    limit: parsed.data.limit,
    offset: parsed.data.offset,
    total,
  });
  if (links) res.set("Link", links);
  res.json(
    catalog.map((r) => ({
      ...r,
      accessUrl: `${config.BASE_URL}/resources/${r.id}`,
    }))
  );
});

// GET /resources/:id/meta — resource preview (public)
router.get("/resources/:id/meta", async (req, res) => {
  const meta = await getResourceMeta(req.params.id as string);
  if (!meta) {
    res.status(404).json({ error: "Resource not found" });
    return;
  }
  res.json({
    ...meta,
    accessUrl: `${config.BASE_URL}/resources/${meta.id}`,
  });
});

// GET /resources/:id/verification — verification status and details (public)
router.get("/resources/:id/verification", async (req, res) => {
  const details = await getVerificationDetails(req.params.id as string);
  if (!details) {
    res.status(404).json({ error: "Resource not found" });
    return;
  }
  res.json(details);
});

// GET /resources/:id — access resource (x402 paywalled)
router.get("/resources/:id", dynamicPaywall, async (req, res) => {
  const resource = (req as any).resource;

  // Record payment
  let payerAddress = "unknown";
  try {
    const paymentHeader = req.headers["x-payment"] as string;
    if (paymentHeader) {
      const decoded = JSON.parse(
        Buffer.from(paymentHeader, "base64").toString()
      );
      payerAddress = decoded?.payload?.authorization?.address || decoded?.clientAddress || "unknown";
    }
  } catch {
    // Best effort — don't fail delivery if we can't parse
  }

  const [payment] = await db
    .insert(payments)
    .values({
      resourceId: resource.id,
      payerAddress,
      recipientAddress: resource.walletAddress,
      amount: resource.price,
    })
    .returning();

  if (resource.resourceType === "link") {
    res.json({
      url: resource.externalUrl,
      receipt: {
        paymentId: payment.id,
        amount: payment.amount,
        currency: "USDC",
        paidTo: payment.recipientAddress,
        paidAt: payment.paidAt,
      },
    });
    return;
  }

  // Stream file from Supabase Storage
  if (!resource.storagePath) {
    res.status(500).json({ error: "Resource file not found" });
    return;
  }

  // Add receipt info in headers for file downloads
  res.setHeader("X-Payment-Id", payment.id);
  res.setHeader("X-Payment-Amount", `${payment.amount} USDC`);
  res.setHeader("X-Payment-Recipient", payment.recipientAddress);

  const { buffer, mimeType } = await downloadFile(resource.storagePath);
  res.setHeader("Content-Type", mimeType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${resource.storagePath.split("/").pop()}"`
  );
  res.send(buffer);
});

// PATCH /resources/:id — update title/description/price (authenticated, owner only)
router.patch("/resources/:id", apiKeyAuth, async (req, res) => {
  const parsed = resourcePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const resource = await updateResource(
    req.params.id as string,
    req.publisher!.id,
    parsed.data
  );
  if (!resource) {
    res.status(404).json({ error: "Resource not found or not owned by you" });
    return;
  }

  // paywall cache would keep charging the old price until the TTL runs out
  if (parsed.data.price) evictPaywallCache(resource.id);

  res.json(resource);
});

// DELETE /resources/:id — delist a resource (authenticated, owner only)
router.delete("/resources/:id", apiKeyAuth, async (req, res) => {
  const resource = await delistResource(req.params.id as string, req.publisher!.id);
  if (!resource) {
    res.status(404).json({ error: "Resource not found or not owned by you" });
    return;
  }
  res.json({ message: "Resource delisted", id: resource.id });
});

export default router;
