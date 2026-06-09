import { z } from "zod/v4";

// USDC on Stellar has 7 decimal places; contract rejects zero/negative prices too
export const priceSchema = z
  .string()
  .regex(/^\d+(\.\d{1,7})?$/, "price must be a decimal number")
  .refine((v) => Number(v) > 0, "price must be greater than zero");
