import { z } from "zod/v4";
import { CATALOG_SORTS } from "./utils/sort.js";

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
    publisher: textFilter,
    // verified=true narrows the catalog to resources that passed verification
    verified: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === "true")),
    // status pins the exact verification state. more precise than verified, which
    // can only split passed vs everything-else; status wins when both are sent.
    status: z.enum(["pending", "verified", "rejected"]).optional(),
    sort: z.enum(CATALOG_SORTS).default("newest"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .and(catalogPriceSchema);

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
