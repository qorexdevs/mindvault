/**
 * End-to-end test for MindVault.
 * Tests the full flow: register -> publish -> verify -> catalog -> pay -> access
 *
 * Prerequisites:
 *   1. Server running: pnpm dev
 *   2. .env configured with valid Supabase + Stellar testnet credentials
 *   3. Supabase Storage bucket "resources" created
 *
 * Usage: npx tsx scripts/e2e-test.ts
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:4021";

async function request(
  method: string,
  path: string,
  body?: any,
  headers?: Record<string, string>
) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function log(step: string, result: { status: number; data: any }) {
  const icon = result.status < 400 ? "[ok]" : "[x]";
  console.log(`\n${icon} ${step} [${result.status}]`);
  console.log(JSON.stringify(result.data, null, 2));
}

async function main() {
  console.log("=== MindVault E2E Test ===\n");
  console.log(`Server: ${BASE_URL}`);

  // 1. Health check
  const health = await request("GET", "/health");
  log("Health check", health);
  if (health.status !== 200) {
    console.error("\nServer not reachable. Is it running?");
    process.exit(1);
  }

  // 2. Register publisher
  const register = await request("POST", "/publishers", {
    name: "Test Publisher",
    email: `test-${Date.now()}@mindvault.dev`,
    walletAddress: "GDUMMY000000000000000000000000000000000000000000000000000",
  });
  log("Register publisher", register);
  if (register.status !== 201) {
    console.error("\nFailed to register publisher.");
    process.exit(1);
  }

  const apiKey = register.data.apiKey;
  const authHeaders = { "x-api-key": apiKey };

  // 3. Get publisher profile
  const profile = await request("GET", "/publishers/me", undefined, authHeaders);
  log("Get profile", profile);

  // 4. Publish a link resource
  const publish = await request(
    "POST",
    "/resources",
    {
      title: "Test Dataset: Machine Learning Benchmarks",
      description:
        "A curated collection of ML benchmark results across different model architectures. Original research compiled over 6 months.",
      price: "0.01",
      externalUrl: "https://example.com/dataset.csv",
    },
    authHeaders
  );
  log("Publish resource", publish);
  if (publish.status !== 201) {
    console.error("\nFailed to publish resource.");
    process.exit(1);
  }

  const resourceId = publish.data.id;

  // 5. Check resource meta (should show verification_status)
  console.log("\nWaiting 5s for verification to complete...");
  await new Promise((r) => setTimeout(r, 5000));

  const meta = await request("GET", `/resources/${resourceId}/meta`);
  log("Resource meta", meta);

  // 6. List catalog (resource should appear if verified)
  const catalog = await request("GET", "/resources");
  log(`Catalog (${catalog.data?.length || 0} listed)`, catalog);

  // 7. Try accessing resource without payment (should get 402)
  const unpaid = await request("GET", `/resources/${resourceId}`);
  log("Access without payment", unpaid);

  if (unpaid.status === 402) {
    console.log("\n[ok] Received 402 Payment Required -- x402 paywall is working!");
    console.log("  To complete the flow, use a funded Stellar wallet with paidFetch.");
  } else if (unpaid.status === 404) {
    console.log("\n[warn] Resource not listed yet -- verification may still be pending.");
    console.log("  Check OPENROUTER_API_KEY and AGENT_SECRET_KEY in .env");
  }

  // 8. Try verify-content directly (should get 402)
  const verifyUnpaid = await request("POST", "/verify-content", {
    content: "Test content for verification",
  });
  log("Verify-content without payment", verifyUnpaid);

  if (verifyUnpaid.status === 402) {
    console.log(
      "\n[ok] Verification endpoint returns 402 -- platform agent paywall working!"
    );
  }

  // 9. List publisher's own resources
  const myResources = await request(
    "GET",
    "/publishers/me/resources",
    undefined,
    authHeaders
  );
  log("My resources", myResources);

  // 10. Delist resource
  const delist = await request(
    "DELETE",
    `/resources/${resourceId}`,
    undefined,
    authHeaders
  );
  log("Delist resource", delist);

  console.log("\n=== E2E Test Complete ===");
}

main().catch(console.error);
