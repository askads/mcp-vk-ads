import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAccountTools } from "./account.js";

type Args = Record<string, unknown>;
type Handler = (args: Args) => Promise<{ content: { text: string }[]; isError?: boolean }>;

/** Fake server + mock client (getAll) so the handler runs without network. */
function harness(regions: Array<{ id: number; name: string; type: string }>) {
  let getAllCalls = 0;
  const getAllArgs: unknown[][] = [];
  const client = {
    get: async () => ({}),
    getAll: async (...args: unknown[]) => {
      getAllCalls++;
      getAllArgs.push(args);
      return { count: regions.length, items: regions };
    },
  };
  const tools: Record<string, Handler> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: Handler) => {
      tools[name] = handler;
    },
  };
  registerAccountTools(server as never, client as never);
  return { tools, getAllCalls: () => getAllCalls, getAllArgs };
}

test("get_regions caches the dictionary and does not re-fetch on the second call", async () => {
  const regions = [
    { id: 1, name: "Москва", type: "region" },
    { id: 2, name: "Санкт-Петербург", type: "region" },
  ];
  const { tools, getAllCalls } = harness(regions);

  const first = await tools.get_regions({ query: "москва" });
  assert.match(first.content[0].text, /Москва/);
  assert.equal(getAllCalls(), 1);

  // Second call is served from cache — the region dictionary is static per process.
  const second = await tools.get_regions({});
  assert.match(second.content[0].text, /Санкт-Петербург/);
  assert.equal(getAllCalls(), 1);
});

test("get_regions fetches the FULL dictionary (opts out of the MAX_AUTO_ITEMS cap)", async () => {
  const { tools, getAllArgs } = harness([{ id: 1, name: "Москва", type: "region" }]);
  await tools.get_regions({});
  // getAll(path, query, maxPages, maxItems) — the 4th arg lifts the item cap so a
  // dictionary larger than MAX_AUTO_ITEMS is not silently truncated for local search.
  assert.equal(getAllArgs[0][0], "v2/regions.json");
  assert.equal(getAllArgs[0][3], Number.POSITIVE_INFINITY);
});

/** Fake server + mock client (get) capturing path/query, for the balance tool. */
function getHarness(getResult: unknown) {
  const getCalls: { path: string; query?: Record<string, unknown> }[] = [];
  const client = {
    get: async (path: string, query?: Record<string, unknown>) => {
      getCalls.push({ path, query });
      return getResult;
    },
    getAll: async () => ({ count: 0, items: [] }),
  };
  const tools: Record<string, Handler> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: Handler) => {
      tools[name] = handler;
    },
  };
  registerAccountTools(server as never, client as never);
  return { tools, getCalls };
}

test("get_balance calls user.json with account+currency and passes the raw response through", async () => {
  // Fixture mirrors the myTarget/VK Ads object model: user.account = { id, balance, type, flags }
  // with balance as a Decimal STRING in rubles (major units, no micro-units), plus top-level currency.
  const fixture = {
    id: 42,
    username: "advertiser",
    account: { id: 777, balance: "1234.56", type: "standard", flags: [] },
    currency: "RUB",
  };
  const { tools, getCalls } = getHarness(fixture);

  const res = await tools.get_balance({});

  // The request must hit user.json with fields that include `account` (the wallet).
  assert.equal(getCalls.length, 1);
  assert.equal(getCalls[0].path, "v3/user.json");
  const fields = String(getCalls[0].query?.fields ?? "");
  assert.match(fields, /\baccount\b/);
  assert.match(fields, /\bcurrency\b/);

  // The RAW VK response is forwarded verbatim through ok() — no normalization.
  assert.equal(res.isError, undefined);
  assert.deepEqual(JSON.parse(res.content[0].text), fixture);
});
