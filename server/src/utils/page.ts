// pagination links for GET /resources. the catalog already returns
// X-Total-Count, but a client still has to do the offset math itself to walk
// the pages. build the RFC5988 Link header so prev/next are discoverable.
export type PageParams = {
  path: string;
  query: Record<string, string | number | undefined>;
  limit: number;
  offset: number;
  total: number;
};

function withOffset(p: PageParams, offset: number): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(p.query)) {
    if (v !== undefined && v !== "") usp.set(k, String(v));
  }
  usp.set("limit", String(p.limit));
  usp.set("offset", String(offset));
  return `${p.path}?${usp.toString()}`;
}

export function pageLinks(p: PageParams): string {
  const parts: string[] = [];
  if (p.offset > 0) {
    const prev = Math.max(0, p.offset - p.limit);
    parts.push(`<${withOffset(p, prev)}>; rel="prev"`);
  }
  if (p.offset + p.limit < p.total) {
    parts.push(`<${withOffset(p, p.offset + p.limit)}>; rel="next"`);
  }
  return parts.join(", ");
}
