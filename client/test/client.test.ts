import { test } from "node:test";
import assert from "node:assert/strict";
import { MindVaultClient, MindVaultError } from "../src/index.js";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
}

test("catalog sends filters and returns items, total and links", async () => {
  let seen = "";
  const fetch = (async (url: string | URL | Request) => {
    seen = String(url);
    return jsonResponse([{ id: "a" }, { id: "b" }], {
      headers: {
        "X-Total-Count": "42",
        Link: '</resources?offset=50>; rel="next"',
      },
    });
  }) as typeof globalThis.fetch;

  const c = new MindVaultClient({ baseUrl: "http://x:4021/", fetch });
  const page = await c.catalog({ q: "ml", verified: true, limit: 2 });

  assert.equal(seen, "http://x:4021/resources?q=ml&verified=true&limit=2");
  assert.equal(page.total, 42);
  assert.equal(page.items.length, 2);
  assert.deepEqual(page.links, { next: "/resources?offset=50" });
});

test("catalogPages follows the next link until it runs out", async () => {
  const seen: string[] = [];
  const pages: Record<string, Response> = {
    "/resources?limit=2": jsonResponse([{ id: "a" }, { id: "b" }], {
      headers: { "X-Total-Count": "3", Link: '</resources?offset=2&limit=2>; rel="next"' },
    }),
    "/resources?offset=2&limit=2": jsonResponse([{ id: "c" }], {
      headers: { "X-Total-Count": "3" },
    }),
  };
  const fetch = (async (url: string | URL | Request) => {
    const path = String(url).replace("http://x:4021", "");
    seen.push(path);
    return pages[path];
  }) as typeof globalThis.fetch;

  const c = new MindVaultClient({ baseUrl: "http://x:4021", fetch });
  const ids: string[] = [];
  for await (const page of c.catalogPages({ limit: 2 })) {
    for (const item of page.items as { id: string }[]) ids.push(item.id);
  }

  assert.deepEqual(seen, ["/resources?limit=2", "/resources?offset=2&limit=2"]);
  assert.deepEqual(ids, ["a", "b", "c"]);
});

test("meta hits the preview route", async () => {
  let seen = "";
  const fetch = (async (url: string | URL | Request) => {
    seen = String(url);
    return jsonResponse({ id: "r1", title: "t" });
  }) as typeof globalThis.fetch;

  const c = new MindVaultClient({ baseUrl: "http://x:4021", fetch });
  const meta = (await c.meta("r1")) as { id: string };
  assert.equal(seen, "http://x:4021/resources/r1/meta");
  assert.equal(meta.id, "r1");
});

test("non-ok responses throw MindVaultError carrying status and message", async () => {
  const fetch = (async () =>
    new Response(JSON.stringify({ error: "Resource not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })) as typeof globalThis.fetch;

  const c = new MindVaultClient({ baseUrl: "http://x:4021", fetch });
  await assert.rejects(c.meta("missing"), (err: unknown) => {
    assert.ok(err instanceof MindVaultError);
    assert.equal(err.status, 404);
    assert.equal(err.message, "Resource not found");
    return true;
  });
});

test("buy without a secret key fails fast", async () => {
  const c = new MindVaultClient({ baseUrl: "http://x:4021" });
  await assert.rejects(c.buy("r1"), /secretKey is required/);
});
