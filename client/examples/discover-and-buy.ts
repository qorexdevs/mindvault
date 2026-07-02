// Runnable end-to-end walk through the SDK: browse the catalog with no wallet,
// narrow it down, preview one resource, then pay for it. Point it at a server:
//
//   MINDVAULT_URL=https://your-mindvault-server \
//   STELLAR_SECRET_KEY=S... \
//   node --import tsx examples/discover-and-buy.ts
//
// STELLAR_SECRET_KEY is optional. Without it the script does the whole discovery
// pass and stops right before paying, so you can try it against any server.
import { MindVaultClient, MindVaultError } from "../src/index.js";

// The catalog returns items as `unknown`; this is the shape the server sends.
type CatalogItem = {
  id: string;
  title: string;
  description: string | null;
  price: string; // USDC amount as a string, e.g. "0.50"
  resourceType: "file" | "link";
  mimeType: string | null;
  publisherName: string;
  createdAt: string;
  accessUrl: string;
};

const baseUrl = process.env.MINDVAULT_URL ?? "http://localhost:4021";
const secretKey = process.env.STELLAR_SECRET_KEY;

const mv = new MindVaultClient({ baseUrl, secretKey });

async function main() {
  console.log(`catalog @ ${baseUrl}\n`);

  // Counting reads X-Total-Count from one capped request, no draining.
  const total = await mv.catalogCount({ verified: true });
  console.log(`${total} verified resource(s) listed`);

  // First page of the verified catalog, cheapest first.
  const page = await mv.catalog({ verified: true, sort: "price_asc", limit: 5 });
  const items = page.items as CatalogItem[];
  for (const r of items) {
    console.log(`  $${r.price}  ${r.title}  (${r.resourceType}, ${r.publisherName})`);
  }

  if (items.length === 0) {
    console.log("\nnothing to buy yet, seed the server and re-run");
    return;
  }

  // facets() gives the mime/publisher breakdown for the same filter, handy for
  // building a discovery UI without a second pass over the data.
  const facets = await mv.facets({ verified: true });
  console.log(`\nfacets: ${JSON.stringify(facets)}`);

  // Cheapest paid resource on the first page.
  const target =
    items.find((r) => Number(r.price) > 0) ?? items[0];

  const preview = await mv.meta(target.id);
  console.log(`\npreview ${target.id}: ${JSON.stringify(preview)}`);

  if (!secretKey) {
    console.log("\nset STELLAR_SECRET_KEY to pay and unlock this resource");
    return;
  }

  // buy() makes the request, signs the USDC payment when the server answers 402,
  // and retries. It throws MindVaultError on a non-2xx (e.g. underfunded wallet).
  try {
    const bought = await mv.buy(target.id);
    if (bought.url) {
      console.log(`\nunlocked link: ${bought.url}`);
    } else if (bought.bytes) {
      console.log(`\ndownloaded ${bought.bytes.length} bytes`);
    }
    console.log(`receipt: ${JSON.stringify(bought.receipt)}`);
  } catch (err) {
    if (err instanceof MindVaultError) {
      console.error(`\nbuy failed (${err.status}): ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
