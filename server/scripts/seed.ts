/**
 * Seed the catalog with a couple of publishers and a handful of listed
 * resources so a fresh install isn't an empty marketplace on first run.
 *
 * Usage: npm run db:seed
 *
 * Idempotent: if any resource already exists it does nothing, so it's safe
 * to run more than once.
 */

import { count } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { publishers, resources } from "../src/db/schema.js";
import { config } from "../src/config.js";
import { generateApiKey, hashApiKey } from "../src/utils/crypto.js";

const SAMPLE_PUBLISHERS = [
  { name: "Aria Labs", email: "aria@example.com" },
  { name: "Ledger Notes", email: "ledger@example.com" },
];

const SAMPLE_RESOURCES = [
  {
    publisher: 0,
    title: "Agent prompt patterns cheatsheet",
    description: "One-page reference of prompt patterns that hold up in production agents.",
    price: "0.50",
    externalUrl: "https://example.com/agent-prompt-patterns",
  },
  {
    publisher: 0,
    title: "Stellar testnet quickstart",
    description: "Spin up a funded testnet wallet and send your first payment in ten minutes.",
    price: "0.25",
    externalUrl: "https://example.com/stellar-quickstart",
  },
  {
    publisher: 1,
    title: "USDC micropayments dataset",
    description: "Anonymized sample of on-chain micropayment flows for backtesting.",
    price: "1.00",
    externalUrl: "https://example.com/usdc-micropayments-dataset",
  },
  {
    publisher: 1,
    title: "x402 integration walkthrough",
    description: "Wire the x402 paywall into an existing API, with a working example repo.",
    price: "0.75",
    externalUrl: "https://example.com/x402-walkthrough",
  },
];

async function main() {
  const [{ value: existing }] = await db
    .select({ value: count() })
    .from(resources);
  if (existing > 0) {
    console.log(`catalog already has ${existing} resources, nothing to seed`);
    process.exit(0);
  }

  const created: string[] = [];
  for (const p of SAMPLE_PUBLISHERS) {
    const apiKey = generateApiKey();
    const [row] = await db
      .insert(publishers)
      .values({
        name: p.name,
        email: p.email,
        walletAddress: config.PAY_TO,
        apiKeyHash: hashApiKey(apiKey),
      })
      .returning();
    created.push(row.id);
    console.log(`publisher ${p.name} -> api key ${apiKey}`);
  }

  for (const r of SAMPLE_RESOURCES) {
    await db.insert(resources).values({
      publisherId: created[r.publisher],
      title: r.title,
      description: r.description,
      price: r.price,
      walletAddress: config.PAY_TO,
      resourceType: "link",
      externalUrl: r.externalUrl,
      verificationStatus: "verified",
      listed: true,
    });
  }

  console.log(
    `seeded ${SAMPLE_PUBLISHERS.length} publishers and ${SAMPLE_RESOURCES.length} listed resources`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
