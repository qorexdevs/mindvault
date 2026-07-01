# @mindvault/client

Client SDK for [MindVault](../README.md). Wraps catalog discovery and the x402
pay-and-fetch dance so a buyer (human script or AI agent) gets a resource in one
call instead of hand-rolling the 402 -> sign -> retry flow.

## Install

```bash
pnpm add @mindvault/client
```

## Discover

No wallet needed to browse. Discovery methods are plain reads.

```ts
import { MindVaultClient } from "@mindvault/client";

const mv = new MindVaultClient({ baseUrl: "https://your-mindvault-server" });

const page = await mv.catalog({ q: "benchmarks", verified: true, limit: 20 });
console.log(page.total, page.items, page.links.next);

const facets = await mv.facets({ type: "file" }); // mime types + publishers
const preview = await mv.meta(page.items[0].id);   // price, title, status
const seller = await mv.storefront(preview.publisherId);
```

## Buy

`buy()` handles the payment: it makes the request, signs the USDC payment on
Stellar when the server answers 402, and retries. Pass a Stellar secret key.

```ts
const mv = new MindVaultClient({
  baseUrl: "https://your-mindvault-server",
  secretKey: process.env.STELLAR_SECRET_KEY, // S...
  network: "stellar:testnet",                // default
});

const bought = await mv.buy(resourceId);

if (bought.url) {
  // link resource: the unlocked external URL
  console.log(bought.url, bought.receipt);
} else if (bought.bytes) {
  // file resource: the downloaded bytes
  await fs.writeFile("out.bin", bought.bytes);
  console.log(bought.receipt);
}
```

Failures throw `MindVaultError` with `status` and the server's error body.

## API

- `catalog(filter)` -> `{ items, total, links }` over `GET /resources`
- `catalogPages(filter)` async generator that follows the `Link` next rel and
  yields every page, e.g. `for await (const page of mv.catalogPages({}))`
- `catalogAll(filter)` -> `unknown[]` drains every page into one array; use
  `catalogPages` instead for a large catalog you'd rather stream
- `catalogItems(filter)` async generator that yields one item at a time across
  page boundaries, so `break` stops early without fetching the rest
- `catalogCount(filter)` -> `number` reads `X-Total-Count` from one capped
  request, so counting a large catalog skips draining it
- `catalogTake(n, filter)` -> `unknown[]` first `n` items across pages, stopping
  once it has them instead of walking the whole catalog
- `catalogFind(predicate, filter)` -> first item matching `predicate`, streaming
  page by page and stopping on the first hit, `undefined` when none match
- `catalogTakeWhile(predicate, filter)` -> `unknown[]` leading items while
  `predicate` holds, stopping at the first miss; on a sorted catalog it grabs the
  run at the front without draining the tail
- `facets(filter)` / `stats(filter)` over the matching catalog filter
- `meta(id)` / `verification(id)` resource preview and verification state
- `storefront(publisherId)` public seller profile
- `leaderboard(query)` ranked publishers
- `buy(id)` paid access, returns `{ url? , bytes?, receipt }`

`filter` matches the server query schema: `q`, `type`, `mime`, `publisher`,
`verified`, `status`, `free`, `minPrice`, `maxPrice`, `createdAfter`,
`createdBefore`, `sort`, `trendingDays`, `limit`, `offset`.
