import { z } from "zod/v4";
import { CATALOG_SORTS } from "./utils/sort.js";
import { LEADERBOARD_SORTS } from "./utils/leaderboard.js";

// USDC on Stellar has 7 decimal places; contract rejects zero/negative prices too
export const priceSchema = z
  .string()
  .regex(/^\d+(\.\d{1,7})?$/, "price must be a decimal number")
  .refine((v) => Number(v) > 0, "price must be greater than zero");

// minPrice/maxPrice on the catalog. allow zero so a 0 floor is valid, and reject
// an inverted range up front instead of letting it return an empty page.
export const catalogPriceSchema = z
  .object({
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
  })
  .refine(
    (v) => v.minPrice === undefined || v.maxPrice === undefined || v.maxPrice >= v.minPrice,
    { message: "maxPrice must be >= minPrice", path: ["maxPrice"] }
  );

// createdAfter/createdBefore on the catalog. coerce accepts an ISO date or
// datetime from the querystring; reject an inverted range up front like the
// price bounds do, so it never silently returns an empty page.
export const catalogDateSchema = z
  .object({
    createdAfter: z.coerce.date().optional(),
    createdBefore: z.coerce.date().optional(),
  })
  .refine(
    (v) =>
      v.createdAfter === undefined ||
      v.createdBefore === undefined ||
      v.createdBefore >= v.createdAfter,
    { message: "createdBefore must be >= createdAfter", path: ["createdBefore"] }
  );

// trim a text filter and drop it if nothing's left, so a whitespace-only q or
// publisher is ignored instead of building a useless '%   %' ilike pattern and
// leaking the blank value into the pagination Link header.
const textFilter = z
  .string()
  .optional()
  .transform((v) => v?.trim() || undefined);

// full GET /resources query: paging + filters + sort, on top of the price range.
// limit is capped so a client can't ask for the whole table in one page.
export const catalogQuerySchema = z
  .object({
    q: textFilter,
    type: z.enum(["file", "link"]).optional(),
    // mime matches a content-type prefix, so "image" catches image/png and
    // "application/pdf" pins an exact type. link resources have no mime, so this
    // narrows to files.
    mime: textFilter,
    publisher: textFilter,
    // verified=true narrows the catalog to resources that passed verification
    verified: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === "true")),
    // status pins the exact verification state. more precise than verified, which
    // can only split passed vs everything-else; status wins when both are sent.
    status: z.enum(["pending", "verified", "rejected"]).optional(),
    // free=true narrows to price 0 uploads, free=false to paid ones. composes
    // with minPrice/maxPrice, so free=false plus a floor still applies the floor.
    free: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === "true")),
    sort: z.enum(CATALOG_SORTS).default("newest"),
    // trendingDays is the look-back window for sort=trending. ignored by other
    // sorts. capped at a year so the subquery can't be asked for the whole table.
    trendingDays: z.coerce.number().int().min(1).max(365).default(7),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .and(catalogPriceSchema)
  .and(catalogDateSchema);

// GET /publishers/leaderboard query. sort picks the ranking key; limit is
// optional so the default stays the full board, but caps a top-N request.
// offset walks the board past the first page when a limit is set.
export const leaderboardQuerySchema = z.object({
  sort: z.enum(LEADERBOARD_SORTS).default("earnings"),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).default(0),
});

// PATCH /resources/:id body. every field is optional but at least one must be
// present, otherwise the update is a no-op that still evicts the paywall cache.
export const resourcePatchSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    price: priceSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "nothing to update");

// POST /resources body for a link resource (the file branch reads multipart
// fields by hand). externalUrl must be a real url, walletAddress falls back to
// the publisher's when omitted.
export const linkSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  price: priceSchema,
  walletAddress: z.string().optional(),
  // only http(s), so a javascript:/data: url can't be stored and later handed
  // to whoever paid for the link.
  externalUrl: z.url({ protocol: /^https?$/ }),
});
