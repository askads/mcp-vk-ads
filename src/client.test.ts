import { test } from "node:test";
import assert from "node:assert/strict";
import { VkAdsClient, MAX_PAGE_LIMIT, MAX_AUTO_ITEMS } from "./client.js";
import { VkAdsError } from "./types.js";

const BASE = "https://ads.vk.com/api";

function makeClient(overrides: Partial<ConstructorParameters<typeof VkAdsClient>[0]> = {}) {
  return new VkAdsClient({
    token: "T",
    lang: "ru",
    apiBase: BASE,
    retryBaseMs: 0,
    ...overrides,
  });
}

function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    const u = String(url);
    const i = (init ?? {}) as RequestInit;
    calls.push({ url: u, init: i });
    return handler(u, i);
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

test("get() hits the versioned path, sends the bearer token and parses JSON", async () => {
  const mock = mockFetch(
    () => new Response(JSON.stringify({ count: 0, items: [] }), { status: 200 }),
  );
  try {
    const client = makeClient();
    const result = await client.get("v2/ad_plans.json", { fields: "id,name", limit: 250 });

    assert.deepEqual(result, { count: 0, items: [] });
    assert.equal(mock.calls[0].url, "https://ads.vk.com/api/v2/ad_plans.json?fields=id%2Cname&limit=250");
    assert.equal(mock.calls[0].init.method, "GET");

    const headers = mock.calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer T");
    assert.equal(headers["Accept-Language"], "ru");
  } finally {
    mock.restore();
  }
});

test("get() drops undefined and empty query values", async () => {
  const mock = mockFetch(() => new Response(JSON.stringify({}), { status: 200 }));
  try {
    await makeClient().get("v2/ad_plans.json", { a: undefined, b: "", c: 0, d: "x" });
    assert.equal(mock.calls[0].url, "https://ads.vk.com/api/v2/ad_plans.json?c=0&d=x");
  } finally {
    mock.restore();
  }
});

test("post() sends a JSON body with the content-type header", async () => {
  const mock = mockFetch(() => new Response(JSON.stringify({ id: 5 }), { status: 200 }));
  try {
    const result = await makeClient().post("v2/ad_plans/5.json", { status: "blocked" });
    assert.deepEqual(result, { id: 5 });

    const init = mock.calls[0].init;
    assert.equal(init.method, "POST");
    assert.equal((init.headers as Record<string, string>)["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(init.body as string), { status: "blocked" });
  } finally {
    mock.restore();
  }
});

test("request() throws VkAdsError with the status and parsed body on 4xx", async () => {
  const mock = mockFetch(
    () => new Response(JSON.stringify({ name: ["This field is required."] }), { status: 400 }),
  );
  try {
    const client = makeClient();
    await assert.rejects(
      () => client.post("v2/ad_plans.json", {}),
      (err: unknown) =>
        err instanceof VkAdsError &&
        err.status === 400 &&
        /This field is required/.test(err.message),
    );
  } finally {
    mock.restore();
  }
});

test("request() formats an OAuth-style error body", async () => {
  const mock = mockFetch(
    () =>
      new Response(
        JSON.stringify({ error: "invalid_token", error_description: "Token expired" }),
        { status: 401 },
      ),
  );
  try {
    await assert.rejects(
      () => makeClient().get("v2/ad_plans.json"),
      /invalid_token: Token expired/,
    );
  } finally {
    mock.restore();
  }
});

test("getAll() pages at MAX_PAGE_LIMIT, merges items and carries `total`", async () => {
  let calls = 0;
  const mock = mockFetch((url) => {
    calls++;
    const offset = Number(new URL(url).searchParams.get("offset"));
    if (offset === 0) {
      const items = Array.from({ length: MAX_PAGE_LIMIT }, (_, i) => ({ id: i }));
      return new Response(
        JSON.stringify({ count: MAX_PAGE_LIMIT + 1, items, total: { base: { spent: 99 } } }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ count: MAX_PAGE_LIMIT + 1, items: [{ id: 999 }] }), {
      status: 200,
    });
  });
  try {
    // caller limit:2 is ignored for the autoPaginate page size (deterministic capacity).
    const result = await makeClient().getAll<{ id: number }>("v2/ad_plans.json", { limit: 2 });
    assert.equal(result.items.length, MAX_PAGE_LIMIT + 1);
    assert.equal(result.count, MAX_PAGE_LIMIT + 1);
    assert.deepEqual(result.total, { base: { spent: 99 } }); // grand total carried through
    assert.equal(calls, 2);
    assert.equal(new URL(mock.calls[0].url).searchParams.get("limit"), String(MAX_PAGE_LIMIT));
    assert.equal(new URL(mock.calls[1].url).searchParams.get("offset"), String(MAX_PAGE_LIMIT));
  } finally {
    mock.restore();
  }
});

test("getAll() flags truncation loudly at the maxPages cap", async () => {
  const mock = mockFetch(() => {
    const items = Array.from({ length: MAX_PAGE_LIMIT }, (_, i) => ({ id: i }));
    return new Response(JSON.stringify({ count: 100000, items }), { status: 200 });
  });
  try {
    const result = await makeClient().getAll("v2/banners.json", {}, 2);
    assert.equal((result as { _truncated?: boolean })._truncated, true);
    assert.match((result as { _truncatedNote?: string })._truncatedNote ?? "", /из 100000/);
  } finally {
    mock.restore();
  }
});

test("getAll() stops on a short page even when count is larger", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    return new Response(JSON.stringify({ count: 999, items: [{ id: calls }] }), { status: 200 });
  });
  try {
    // limit 250 but only 1 item returned -> short page -> stop after one call.
    const result = await makeClient().getAll("v2/banners.json");
    assert.equal(calls, 1);
    assert.equal(result.items.length, 1);
  } finally {
    mock.restore();
  }
});

test("getAll() respects maxPages as a hard cap", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    // Always a full page with more remaining, so only maxPages stops it.
    const items = Array.from({ length: MAX_PAGE_LIMIT }, (_, i) => ({ id: i }));
    return new Response(JSON.stringify({ count: 100000, items }), { status: 200 });
  });
  try {
    await makeClient().getAll("v2/banners.json", {}, 2);
    assert.equal(calls, 2);
  } finally {
    mock.restore();
  }
});

test("request() retries a 429 rate limit then returns the result", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    if (calls === 1) return new Response("rate limited", { status: 429 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  try {
    const result = await makeClient().get("v2/ad_plans.json");
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2);
  } finally {
    mock.restore();
  }
});

test("request() retries a 5xx on a GET then returns the result", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    if (calls === 1) return new Response("bad gateway", { status: 502 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  try {
    const result = await makeClient().get("v2/ad_plans.json");
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2);
  } finally {
    mock.restore();
  }
});

test("request() does NOT retry a 5xx on a POST (avoids duplicate writes)", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    return new Response("bad gateway", { status: 502 });
  });
  try {
    // A 502/504 after a create may have committed; replaying it risks a duplicate.
    await assert.rejects(() => makeClient().post("v2/ad_plans.json", { name: "X" }), /HTTP 502/);
    assert.equal(calls, 1); // one attempt, no retry
  } finally {
    mock.restore();
  }
});

test("request() retries a 429 on a POST (request was not processed)", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    if (calls === 1) return new Response("slow down", { status: 429 });
    return new Response(JSON.stringify({ id: 1 }), { status: 200 });
  });
  try {
    const result = await makeClient().post("v2/ad_plans.json", { name: "X" });
    assert.deepEqual(result, { id: 1 });
    assert.equal(calls, 2);
  } finally {
    mock.restore();
  }
});

test("request() retries a network error on a GET, then gives up on a POST", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    if (calls === 1) throw Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  try {
    const result = await makeClient().get("v2/ad_plans.json");
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2); // errored once, retried, succeeded
  } finally {
    mock.restore();
  }

  calls = 0;
  const mock2 = mockFetch(() => {
    calls++;
    throw Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" });
  });
  try {
    // A non-GET network error is not retried (the write may have landed).
    await assert.rejects(() => makeClient().post("v2/ad_plans.json", { name: "X" }), /ECONNRESET/);
    assert.equal(calls, 1);
  } finally {
    mock2.restore();
  }
});

test("request() does not retry a 400 and gives up after maxRetries on 429", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    return new Response("nope", { status: 400 });
  });
  try {
    await assert.rejects(() => makeClient().get("v2/ad_plans.json"), /HTTP 400/);
    assert.equal(calls, 1);
  } finally {
    mock.restore();
  }

  calls = 0;
  const mock2 = mockFetch(() => {
    calls++;
    return new Response("slow down", { status: 429 });
  });
  try {
    await assert.rejects(() => makeClient({ maxRetries: 2 }).get("v2/ad_plans.json"), /HTTP 429/);
    assert.equal(calls, 3); // initial + 2 retries
  } finally {
    mock2.restore();
  }
});

test("request() aborts and reports a timeout when the request hangs", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = ((_url: unknown, init: unknown) =>
    new Promise((_resolve, reject) => {
      const signal = (init as RequestInit).signal as AbortSignal;
      signal.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      );
    })) as typeof fetch;
  try {
    const client = makeClient({ timeoutMs: 10 });
    await assert.rejects(() => client.get("v2/ad_plans.json"), /превысил таймаут 10 мс/);
  } finally {
    globalThis.fetch = original;
  }
});

test("request() refuses an absolute path that resolves to a foreign origin (SSRF)", async () => {
  for (const evil of [
    "https://evil.example/steal",
    "http://evil.example/x",
    "\\\\evil.example/x", // "\\evil.example/x": WHATWG URL treats "\\" like "//" for http(s)
  ]) {
    const mock = mockFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    try {
      await assert.rejects(
        () => makeClient().get(evil),
        /чужой origin/,
        `expected "${evil}" to be rejected`,
      );
      // Crucially, the Bearer token never left for the foreign host.
      assert.equal(mock.calls.length, 0, `expected no fetch for "${evil}"`);
    } finally {
      mock.restore();
    }
  }
});

test("request() still allows a normal relative API path", async () => {
  const mock = mockFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  try {
    await makeClient().get("v2/ad_plans.json");
    assert.equal(mock.calls[0].url, "https://ads.vk.com/api/v2/ad_plans.json");
  } finally {
    mock.restore();
  }
});

test("getAll() caps the total items at MAX_AUTO_ITEMS and flags truncation", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    // Always a full page with far more remaining than the item cap allows.
    const items = Array.from({ length: MAX_PAGE_LIMIT }, (_, i) => ({ id: i }));
    return new Response(JSON.stringify({ count: 100000, items }), { status: 200 });
  });
  try {
    const result = await makeClient().getAll("v2/banners.json");
    assert.equal(result.items.length, MAX_AUTO_ITEMS);
    assert.equal((result as { _truncated?: boolean })._truncated, true);
    assert.match((result as { _truncatedNote?: string })._truncatedNote ?? "", /из 100000/);
    // Stopped by the item cap, not the 100-page default cap.
    assert.equal(calls, Math.ceil(MAX_AUTO_ITEMS / MAX_PAGE_LIMIT));
  } finally {
    mock.restore();
  }
});
