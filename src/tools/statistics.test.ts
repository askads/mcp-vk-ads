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

test("get_statistics defaults to the summary grouping (period-aggregate, not daily)", async () => {
  const { calls, tools } = harness();
  await tools.get_statistics({ entity: "banners" });
  assert.match(calls[0].path, /v3\/statistics\/banners\/summary\.json/);
  assert.equal(calls[0].kind, "get");
});

test("get_statistics maps sortBy/order to VK sort_by/d (server-side top-N)", async () => {
  const { calls, tools } = harness();
  await tools.get_statistics({ entity: "banners", sortBy: "base.spent", order: "desc" });
  assert.equal(calls[0].query.sort_by, "base.spent");
  assert.equal(calls[0].query.d, "desc");
});

test("get_statistics requires dates for day/week/month grouping (no request)", async () => {
  const { calls, tools } = harness();
  const res = await tools.get_statistics({ period: "day" });
  assert.equal(res.isError, true);
  assert.equal(calls.length, 0);
});

test("get_statistics fails loud when an ids filter returns 0 objects", async () => {
  const { tools } = harness({ getResult: { count: 0, items: [] } });
  const res = await tools.get_statistics({ entity: "banners", ids: [123] });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /0 объектов/);
});

test("get_statistics routes autoPaginate through getAll", async () => {
  const { calls, tools } = harness({ getAllResult: { count: 1, items: [{ id: 1 }] } });
  await tools.get_statistics({ entity: "banners", autoPaginate: true });
  assert.equal(calls[0].kind, "getAll");
});
