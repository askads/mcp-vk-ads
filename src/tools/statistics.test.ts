import { test } from "node:test";
import assert from "node:assert/strict";
import { registerStatisticsTools } from "./statistics.js";

type Args = Record<string, unknown>;
type Handler = (args: Args) => Promise<{ content: { text: string }[]; isError?: boolean }>;

/** Fake server + mock client (get/getAll) so the handler runs without network. */
function harness(opts: { getResult?: unknown; getAllResult?: unknown } = {}) {
  const calls: { path: string; query: Record<string, unknown>; kind: "get" | "getAll" }[] = [];
  const client = {
    get: async (path: string, query: Record<string, unknown>) => {
      calls.push({ path, query, kind: "get" });
      return opts.getResult ?? { count: 1, items: [{ id: 1 }] };
    },
    getAll: async (path: string, query: Record<string, unknown>) => {
      calls.push({ path, query, kind: "getAll" });
      return opts.getAllResult ?? { count: 1, items: [{ id: 1 }] };
    },
  };
  const tools: Record<string, Handler> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: Handler) => {
      tools[name] = handler;
    },
  };
  registerStatisticsTools(server as never, client as never);
  return { calls, tools };
}

const PERIOD = { dateFrom: "2026-10-01", dateTo: "2026-10-21" };

// v3 summary.json is a 404 for every entity; v3 day.json is the per-period total.
test("get_statistics summary with dates goes to v3 day.json (period total per object)", async () => {
  const { calls, tools } = harness();
  await tools.get_statistics({ entity: "ad_plans", ...PERIOD });
  assert.equal(calls[0].path, "v3/statistics/ad_plans/day.json");
  assert.equal(calls[0].query.date_from, "2026-10-01");
  assert.equal(calls[0].kind, "get");
});

test("get_statistics summary without dates goes to v2 summary.json (all-time)", async () => {
  const { calls, tools } = harness();
  await tools.get_statistics({ entity: "banners" });
  assert.equal(calls[0].path, "v2/statistics/banners/summary.json");
});

test("get_statistics day goes to v2 day.json (daily rows)", async () => {
  const { calls, tools } = harness();
  await tools.get_statistics({ entity: "ad_groups", period: "day", ...PERIOD });
  assert.equal(calls[0].path, "v2/statistics/ad_groups/day.json");
});

test("get_statistics maps sortBy/order to VK sort_by/d (server-side top-N)", async () => {
  const { calls, tools } = harness();
  await tools.get_statistics({ entity: "banners", sortBy: "base.spent", order: "desc", ...PERIOD });
  assert.equal(calls[0].query.sort_by, "base.spent");
  assert.equal(calls[0].query.d, "desc");
});

test("get_statistics refuses sort/paging where VK would silently ignore it (no request)", async () => {
  const { calls, tools } = harness();
  const noDates = await tools.get_statistics({ sortBy: "base.spent" });
  const daily = await tools.get_statistics({ period: "day", limit: 10, ...PERIOD });
  assert.equal(noDates.isError, true);
  assert.equal(daily.isError, true);
  assert.equal(calls.length, 0);
});

test("get_statistics requires both dates for day, and both or none for summary (no request)", async () => {
  const { calls, tools } = harness();
  assert.equal((await tools.get_statistics({ period: "day" })).isError, true);
  assert.equal((await tools.get_statistics({ dateFrom: "2026-10-01" })).isError, true);
  assert.equal(calls.length, 0);
});

test("get_statistics fails loud when an ids filter returns 0 objects", async () => {
  const { tools } = harness({ getResult: { count: 0, items: [] } });
  const res = await tools.get_statistics({ entity: "banners", ids: [123] });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /0 объектов/);
});

test("get_statistics routes autoPaginate through getAll and drops the last-page total", async () => {
  const { calls, tools } = harness({ getAllResult: { count: 1, items: [{ id: 1 }], total: { base: {} } } });
  const res = await tools.get_statistics({ entity: "banners", autoPaginate: true, ...PERIOD });
  assert.equal(calls[0].kind, "getAll");
  assert.doesNotMatch(res.content[0].text, /"total"/);
});
