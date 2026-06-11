// catalog sort options exposed on GET /resources. price is stored as text, so
// the service casts it to numeric before ordering.
export const CATALOG_SORTS = ["newest", "oldest", "price_asc", "price_desc"] as const;

export type CatalogSort = (typeof CATALOG_SORTS)[number];

export function resolveSort(sort: CatalogSort = "newest"): {
  column: "createdAt" | "price";
  direction: "asc" | "desc";
} {
  switch (sort) {
    case "oldest":
      return { column: "createdAt", direction: "asc" };
    case "price_asc":
      return { column: "price", direction: "asc" };
    case "price_desc":
      return { column: "price", direction: "desc" };
    default:
      return { column: "createdAt", direction: "desc" };
  }
}
