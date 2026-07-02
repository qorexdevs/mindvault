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

export const LEADERBOARD_SORTS = [
  "earnings",
  "sales",
  "resources",
  "avg_sale",
  "avg_resource",
  "verified",
] as const;

export type LeaderboardSort = (typeof LEADERBOARD_SORTS)[number];

export interface CatalogFilter {
  q?: string;
  type?: "file" | "link";
  mime?: string;
  publisher?: string;
  verified?: boolean;
  status?: "pending" | "verified" | "rejected";
  free?: boolean;
  minPrice?: number | string;
  maxPrice?: number | string;
  createdAfter?: string | Date;
  createdBefore?: string | Date;
  sort?: CatalogSort;
  trendingDays?: number;
  limit?: number;
  offset?: number;
}

export interface LeaderboardQuery {
  sort?: LeaderboardSort;
  limit?: number;
  offset?: number;
}

// Turn a filter object into a query string the server's zod schema accepts.
// Booleans become "true"/"false", Dates become ISO strings, undefined/null and
// empty strings are dropped so they don't override server defaults.
export function buildQuery(filter: Record<string, unknown> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "boolean") {
      params.set(key, value ? "true" : "false");
    } else if (value instanceof Date) {
      params.set(key, value.toISOString());
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

// Parse RFC 5988 Link header into a { rel: url } map, so a caller can page
// without rebuilding the query. Returns {} when the header is absent.
//
// Commas are legal inside a URL (RFC 3986), so splitting the header on "," drops
// any link whose target carries one. Split on the commas between entries instead
// (the ones outside the <...> target), then read rel from anywhere in the params,
// quoted or not.
export function parseLinkHeader(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  let inUrl = false;
  let start = 0;
  const entries: string[] = [];
  for (let i = 0; i < header.length; i++) {
    const c = header[i];
    if (c === "<") inUrl = true;
    else if (c === ">") inUrl = false;
    else if (c === "," && !inUrl) {
      entries.push(header.slice(start, i));
      start = i + 1;
    }
  }
  entries.push(header.slice(start));
  for (const entry of entries) {
    const url = entry.match(/<([^>]*)>/);
    const rel = entry.match(/;\s*rel\s*=\s*"?([^",;]+)"?/);
    if (url && rel) out[rel[1].trim()] = url[1];
  }
  return out;
}
