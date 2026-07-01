import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactStellarScheme, createEd25519Signer } from "@x402/stellar";
import type { Network } from "@x402/core/types";
import {
  buildQuery,
  parseLinkHeader,
  type CatalogFilter,
  type LeaderboardQuery,
} from "./query.js";

export * from "./query.js";

export interface MindVaultClientOptions {
  // Base URL of a MindVault server, e.g. http://localhost:4021
  baseUrl: string;
  // Stellar secret key (S...) used to sign payments. Required only for buy().
  secretKey?: string;
  // CAIP-2 network id, defaults to stellar:testnet to match the server default.
  network?: string;
  // Optional custom Soroban RPC url for signing.
  rpcUrl?: string;
  // Override fetch (tests, custom agents). Defaults to global fetch.
  fetch?: typeof globalThis.fetch;
}

export interface Receipt {
  paymentId?: string;
  amount: string;
  currency: string;
  paidTo: string;
  paidAt?: string;
}

export interface Purchase {
  contentType: string;
  receipt: Receipt | null;
  // Set for "link" resources: the unlocked external URL.
  url?: string;
  // Set for "file" resources: the downloaded bytes.
  bytes?: Uint8Array;
}

export interface Page<T> {
  items: T[];
  total: number;
  links: Record<string, string>;
}

export class MindVaultError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    const msg =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `request failed with ${status}`;
    super(msg);
    this.name = "MindVaultError";
    this.status = status;
    this.body = body;
  }
}

export class MindVaultClient {
  private readonly baseUrl: string;
  private readonly fetch: typeof globalThis.fetch;
  private readonly secretKey?: string;
  private readonly network: string;
  private readonly rpcUrl?: string;
  private payFetch?: ReturnType<typeof wrapFetchWithPayment>;

  constructor(opts: MindVaultClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.secretKey = opts.secretKey;
    this.network = opts.network ?? "stellar:testnet";
    this.rpcUrl = opts.rpcUrl;
  }

  private async getJson<T>(path: string): Promise<Response> {
    const res = await this.fetch(`${this.baseUrl}${path}`);
    if (!res.ok) throw new MindVaultError(res.status, await safeJson(res));
    return res;
  }

  // GET /resources — paged catalog. Returns the listings plus the total count
  // and parsed Link header so a caller can walk pages.
  async catalog(filter: CatalogFilter = {}): Promise<Page<unknown>> {
    const res = await this.getJson(`/resources${buildQuery(filter as Record<string, unknown>)}`);
    return {
      items: (await res.json()) as unknown[],
      total: Number(res.headers.get("X-Total-Count") ?? 0),
      links: parseLinkHeader(res.headers.get("Link")),
    };
  }

  // Walk the whole catalog, following the Link "next" rel. Yields one page at a
  // time so a caller can stream a large catalog without holding every row:
  // `for await (const page of client.catalogPages({ verified: true })) ...`.
  async *catalogPages(filter: CatalogFilter = {}): AsyncGenerator<Page<unknown>> {
    let path: string = `/resources${buildQuery(filter as Record<string, unknown>)}`;
    while (path) {
      const res = await this.getJson(path);
      const page: Page<unknown> = {
        items: (await res.json()) as unknown[],
        total: Number(res.headers.get("X-Total-Count") ?? 0),
        links: parseLinkHeader(res.headers.get("Link")),
      };
      yield page;
      path = page.links.next ?? "";
    }
  }

  // Collect every catalog item across all pages into one array. The convenience
  // counterpart to catalogPages for callers that do want the whole list in
  // memory; for a large catalog prefer catalogPages to stream it page by page.
  async catalogAll(filter: CatalogFilter = {}): Promise<unknown[]> {
    const items: unknown[] = [];
    for await (const page of this.catalogPages(filter)) {
      items.push(...page.items);
    }
    return items;
  }

  // Stream the catalog one item at a time across page boundaries, so a caller
  // can `for await (const item of client.catalogItems(...))` and break early
  // without draining the rest: `break` stops the next page from being fetched.
  async *catalogItems(filter: CatalogFilter = {}): AsyncGenerator<unknown> {
    for await (const page of this.catalogPages(filter)) {
      yield* page.items;
    }
  }

  // GET /resources/facets — distinct mime types and publishers under a filter,
  // for building dropdowns.
  async facets(filter: CatalogFilter = {}): Promise<unknown> {
    const res = await this.getJson(`/resources/facets${buildQuery(filter as Record<string, unknown>)}`);
    return res.json();
  }

  // GET /resources/stats — catalog totals under a filter.
  async stats(filter: CatalogFilter = {}): Promise<unknown> {
    const res = await this.getJson(`/resources/stats${buildQuery(filter as Record<string, unknown>)}`);
    return res.json();
  }

  // GET /resources/:id/meta — public preview without paying.
  async meta(id: string): Promise<unknown> {
    return (await this.getJson(`/resources/${id}/meta`)).json();
  }

  // GET /resources/:id/verification — verification status and details.
  async verification(id: string): Promise<unknown> {
    return (await this.getJson(`/resources/${id}/verification`)).json();
  }

  // GET /publishers/:id — public storefront for vetting a seller.
  async storefront(publisherId: string): Promise<unknown> {
    return (await this.getJson(`/publishers/${publisherId}`)).json();
  }

  // GET /publishers/leaderboard — ranked publishers.
  async leaderboard(query: LeaderboardQuery = {}): Promise<Page<unknown>> {
    const res = await this.getJson(`/publishers/leaderboard${buildQuery(query as Record<string, unknown>)}`);
    return {
      items: (await res.json()) as unknown[],
      total: Number(res.headers.get("X-Total-Count") ?? 0),
      links: parseLinkHeader(res.headers.get("Link")),
    };
  }

  private getPayFetch(): ReturnType<typeof wrapFetchWithPayment> {
    if (this.payFetch) return this.payFetch;
    if (!this.secretKey) {
      throw new Error("secretKey is required to buy a resource");
    }
    const signer = createEd25519Signer(this.secretKey, this.network as Network);
    const client = new x402Client().register(
      this.network as Network,
      new ExactStellarScheme(signer, this.rpcUrl ? { url: this.rpcUrl } : undefined)
    );
    this.payFetch = wrapFetchWithPayment(this.fetch, client);
    return this.payFetch;
  }

  // GET /resources/:id behind the paywall: handles the 402 -> sign -> retry
  // dance and returns the unlocked resource. Links come back as { url, receipt },
  // files as { bytes, receipt }.
  async buy(id: string): Promise<Purchase> {
    const res = await this.getPayFetch()(`${this.baseUrl}/resources/${id}`);
    if (!res.ok) throw new MindVaultError(res.status, await safeJson(res));

    const contentType = res.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await res.json()) as { url?: string; receipt?: Receipt };
      return { contentType, url: body.url, receipt: body.receipt ?? null };
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    const amount = res.headers.get("X-Payment-Amount");
    const receipt: Receipt | null = amount
      ? {
          paymentId: res.headers.get("X-Payment-Id") ?? undefined,
          amount: amount.replace(/\s*USDC$/, ""),
          currency: "USDC",
          paidTo: res.headers.get("X-Payment-Recipient") ?? "",
        }
      : null;
    return { contentType, bytes, receipt };
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
