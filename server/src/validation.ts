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
