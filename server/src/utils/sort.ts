// catalog sort options exposed on GET /resources. price is stored as text, so
// the service casts it to numeric before ordering; title sorts case-insensitively;
// popular orders by how many payments a resource has, most sold first; trending
// is the same count but only over a recent window, so it favours what's selling
// now over all-time leaders.
export const CATALOG_SORTS = [
  "newest",
  "oldest",
  "price_asc",
  "price_desc",
  "title_asc",
  "title_desc",
  "popular",
  "trending",
] as const;

export type CatalogSort = (typeof CATALOG_SORTS)[number];

export function resolveSort(sort: CatalogSort = "newest"): {
  column: "createdAt" | "price" | "title" | "sales" | "recent_sales";
  direction: "asc" | "desc";
} {
  switch (sort) {
    case "oldest":
      return { column: "createdAt", direction: "asc" };
    case "price_asc":
      return { column: "price", direction: "asc" };
    case "price_desc":
      return { column: "price", direction: "desc" };
    case "title_asc":
      return { column: "title", direction: "asc" };
    case "title_desc":
      return { column: "title", direction: "desc" };
    case "popular":
      return { column: "sales", direction: "desc" };
    case "trending":
      return { column: "recent_sales", direction: "desc" };
    default:
      return { column: "createdAt", direction: "desc" };
  }
}
