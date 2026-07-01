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

test("catalogAll drains every page into one array", async () => {
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
    return pages[path];
  }) as typeof globalThis.fetch;

  const c = new MindVaultClient({ baseUrl: "http://x:4021", fetch });
  const items = (await c.catalogAll({ limit: 2 })) as { id: string }[];
  assert.deepEqual(items.map((i) => i.id), ["a", "b", "c"]);
});

test("catalogItems streams items and stops fetching on early break", async () => {
  const seen: string[] = [];
  const pages: Record<string, Response> = {
    "/resources?limit=2": jsonResponse([{ id: "a" }, { id: "b" }], {
      headers: { "X-Total-Count": "4", Link: '</resources?offset=2&limit=2>; rel="next"' },
    }),
    "/resources?offset=2&limit=2": jsonResponse([{ id: "c" }, { id: "d" }], {
      headers: { "X-Total-Count": "4" },
    }),
  };
  const fetch = (async (url: string | URL | Request) => {
    const path = String(url).replace("http://x:4021", "");
    seen.push(path);
    return pages[path];
  }) as typeof globalThis.fetch;

  const c = new MindVaultClient({ baseUrl: "http://x:4021", fetch });
  const ids: string[] = [];
  for await (const item of c.catalogItems({ limit: 2 })) {
    ids.push((item as { id: string }).id);
    if (ids.length === 2) break;
  }

  assert.deepEqual(ids, ["a", "b"]);
  assert.deepEqual(seen, ["/resources?limit=2"]);
});

test("catalogCount reads the total from one capped request", async () => {
  let seen = "";
  const fetch = (async (url: string | URL | Request) => {
    seen = String(url);
    return jsonResponse([{ id: "a" }], { headers: { "X-Total-Count": "137" } });
  }) as typeof globalThis.fetch;

  const c = new MindVaultClient({ baseUrl: "http://x:4021", fetch });
  const total = await c.catalogCount({ verified: true });

  assert.equal(total, 137);
  assert.equal(seen, "http://x:4021/resources?verified=true&limit=1");
});

test("catalogTake stops fetching once it has enough items", async () => {
  const seen: string[] = [];
  const pages: Record<string, Response> = {
    "/resources?limit=2": jsonResponse([{ id: "a" }, { id: "b" }], {
      headers: { "X-Total-Count": "4", Link: '</resources?offset=2&limit=2>; rel="next"' },
    }),
    "/resources?offset=2&limit=2": jsonResponse([{ id: "c" }, { id: "d" }], {
      headers: { "X-Total-Count": "4" },
    }),
  };
  const fetch = (async (url: string | URL | Request) => {
    const path = String(url).replace("http://x:4021", "");
    seen.push(path);
    return pages[path];
  }) as typeof globalThis.fetch;

  const c = new MindVaultClient({ baseUrl: "http://x:4021", fetch });
  const items = await c.catalogTake(3, { limit: 2 });

  assert.deepEqual(items, [{ id: "a" }, { id: "b" }, { id: "c" }]);
  assert.deepEqual(seen, ["/resources?limit=2", "/resources?offset=2&limit=2"]);
});

test("catalogTake returns nothing for a non-positive count without fetching", async () => {
  let called = false;
  const c = new MindVaultClient({
    baseUrl: "http://x:4021",
    fetch: (async () => {
      called = true;
      return jsonResponse([{ id: "a" }], { headers: { "X-Total-Count": "1" } });
    }) as typeof globalThis.fetch,
  });
  assert.deepEqual(await c.catalogTake(0), []);
  assert.equal(called, false);
});

test("catalogFind returns the first match and stops paging early", async () => {
  const seen: string[] = [];
  const pages: Record<string, Response> = {
    "/resources?limit=2": jsonResponse([{ id: "a" }, { id: "b" }], {
      headers: { "X-Total-Count": "4", Link: '</resources?offset=2&limit=2>; rel="next"' },
    }),
    "/resources?offset=2&limit=2": jsonResponse([{ id: "c" }, { id: "d" }], {
      headers: { "X-Total-Count": "4" },
    }),
  };
  const fetch = (async (url: string | URL | Request) => {
    const path = String(url).replace("http://x:4021", "");
    seen.push(path);
    return pages[path];
  }) as typeof globalThis.fetch;

  const c = new MindVaultClient({ baseUrl: "http://x:4021", fetch });
  const hit = await c.catalogFind((item) => (item as { id: string }).id === "b", { limit: 2 });

  assert.deepEqual(hit, { id: "b" });
  assert.deepEqual(seen, ["/resources?limit=2"]);
});

test("catalogFind returns undefined when nothing matches", async () => {
  const c = new MindVaultClient({
    baseUrl: "http://x:4021",
    fetch: (async () =>
      jsonResponse([{ id: "a" }], { headers: { "X-Total-Count": "1" } })) as typeof globalThis.fetch,
  });
  const hit = await c.catalogFind((item) => (item as { id: string }).id === "zzz");
  assert.equal(hit, undefined);
});

test("catalogTakeWhile keeps the leading run and stops paging at the first miss", async () => {
  const seen: string[] = [];
  const pages: Record<string, Response> = {
    "/resources?limit=2": jsonResponse([{ score: 9 }, { score: 7 }], {
      headers: { "X-Total-Count": "4", Link: '</resources?offset=2&limit=2>; rel="next"' },
    }),
    "/resources?offset=2&limit=2": jsonResponse([{ score: 3 }, { score: 1 }], {
      headers: { "X-Total-Count": "4" },
    }),
  };
  const fetch = (async (url: string | URL | Request) => {
    const path = String(url).replace("http://x:4021", "");
    seen.push(path);
    return pages[path];
  }) as typeof globalThis.fetch;

  const c = new MindVaultClient({ baseUrl: "http://x:4021", fetch });
  const items = await c.catalogTakeWhile((item) => (item as { score: number }).score >= 5, {
    limit: 2,
  });

  assert.deepEqual(items, [{ score: 9 }, { score: 7 }]);
  assert.deepEqual(seen, ["/resources?limit=2", "/resources?offset=2&limit=2"]);
});

test("catalogTakeWhile returns nothing when the first item already fails", async () => {
  const c = new MindVaultClient({
    baseUrl: "http://x:4021",
    fetch: (async () =>
      jsonResponse([{ score: 1 }], { headers: { "X-Total-Count": "1" } })) as typeof globalThis.fetch,
  });
  const items = await c.catalogTakeWhile((item) => (item as { score: number }).score >= 5);
  assert.deepEqual(items, []);
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
