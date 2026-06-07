import type { Request, Response, NextFunction } from "express";
import {
  paymentMiddleware,
  x402ResourceServer,
} from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { resources } from "../db/schema.js";
import type { Network } from "@x402/core/types";
import type { RoutesConfig } from "@x402/core/server";
import { config } from "../config.js";

const network = config.NETWORK as Network;

const facilitatorClient = new HTTPFacilitatorClient({
  url: config.FACILITATOR_URL,
});

const resourceServer = new x402ResourceServer(facilitatorClient).register(
  network,
  new ExactStellarScheme()
);

// Cache middleware instances by resource ID to avoid re-creating on every request
const middlewareCache = new Map<
  string,
  { mw: ReturnType<typeof paymentMiddleware>; expiresAt: number }
>();
const CACHE_TTL_MS = 60_000; // 1 minute

// Expired entries were only replaced on re-access, so the map kept one
// middleware per resource ever requested. Sweep them out periodically.
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of middlewareCache) {
    if (entry.expiresAt <= now) middlewareCache.delete(id);
  }
}, CACHE_TTL_MS).unref();

// Drop a cached middleware so price changes apply immediately instead of
// waiting out the TTL
export function evictPaywallCache(resourceId: string) {
  middlewareCache.delete(resourceId);
}

export async function dynamicPaywall(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const resourceId = req.params.id as string;

  const resource = await db
    .select()
    .from(resources)
    .where(eq(resources.id, resourceId))
    .then((rows) => rows[0] ?? null);

  if (!resource) {
    res.status(404).json({ error: "Resource not found" });
    return;
  }

  if (!resource.listed) {
    res.status(404).json({ error: "Resource not listed" });
    return;
  }

  // Attach resource to request for the delivery handler
  (req as any).resource = resource;

  // Check cache
  const cached = middlewareCache.get(resourceId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.mw(req, res, next);
  }

  // Build route config for this specific resource
  const routePath = `GET /resources/${resourceId}`;
  const routes: RoutesConfig = {
    [routePath]: {
      accepts: {
        scheme: "exact" as const,
        network,
        payTo: resource.walletAddress,
        price: `$${resource.price}`,
      },
      description: resource.title,
    },
  };

  const mw = paymentMiddleware(routes, resourceServer);

  // Cache it
  middlewareCache.set(resourceId, {
    mw,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return mw(req, res, next);
}
