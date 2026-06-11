import { z } from "zod/v4";

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
