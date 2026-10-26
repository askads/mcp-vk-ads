import { test } from "node:test";
import assert from "node:assert/strict";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { VkAdsClient } from "../client.js";
import { registerAdPlanTools } from "./adPlans.js";

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

function captureTool(name: string, client: VkAdsClient): Handler {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (toolName: string, _def: unknown, h: Handler) => {
      handlers.set(toolName, h);
    },
  } as unknown as McpServer;
  registerAdPlanTools(server, client);
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} was not registered`);
  return handler;
}

function text(result: CallToolResult): string {
  return (result.content[0] as { text: string }).text;
}

function recordingClient(calls: unknown[][]): VkAdsClient {
  return {
    post: async (...args: unknown[]) => {
      calls.push(args);
      return { id: 1, campaigns: [{ id: 2 }] };
    },
  } as unknown as VkAdsClient;
}

const GROUP = {
  name: "g",
  package_id: 3229,
  status: "blocked",
  priced_goal: { source_id: 1, name: "goal" },
  targetings: { geo: { regions: [188] } },
};

test("create_ad_plan refuses budgetLimit together with budgetLimitDay before calling VK", async () => {
  const calls: unknown[][] = [];
  const create = captureTool("create_ad_plan", recordingClient(calls));
  const result = await create({ name: "X", budgetLimit: 5000, budgetLimitDay: 500, extra: { campaigns: [GROUP] } });

  assert.equal(result.isError, true);
  assert.match(text(result), /только одно из двух/);
  assert.equal(calls.length, 0);
});

test("create_ad_plan refuses a plan without ad groups before calling VK", async () => {
  const calls: unknown[][] = [];
  const create = captureTool("create_ad_plan", recordingClient(calls));
  const result = await create({ name: "X", extra: { status: "blocked" } });

  assert.equal(result.isError, true);
  assert.match(text(result), /adGroups/);
  assert.equal(calls.length, 0);
});

test("create_ad_plan sends a paused plan with snake_case fields and extra merged in", async () => {
  const calls: unknown[][] = [];
  const create = captureTool("create_ad_plan", recordingClient(calls));
  const result = await create({
    name: "X",
    objective: "site_conversions",
    autobiddingMode: "max_goals",
    budgetLimitDay: 500,
    extra: { status: "blocked", ad_object_type: "url", ad_object_id: "115205574", campaigns: [GROUP] },
  });

  assert.equal(result.isError, undefined);
  assert.equal(calls[0][0], "v2/ad_plans.json");
  assert.deepEqual(calls[0][1], {
    name: "X",
    objective: "site_conversions",
    autobidding_mode: "max_goals",
    budget_limit_day: 500,
    status: "blocked",
    ad_object_type: "url",
    ad_object_id: "115205574",
    campaigns: [GROUP],
  });
});

test("create_ad_plan sends adGroups as the campaigns VK accepts", async () => {
  const calls: unknown[][] = [];
  const create = captureTool("create_ad_plan", recordingClient(calls));
  const result = await create({ name: "X", adGroups: [GROUP], extra: { status: "blocked" } });

  assert.equal(result.isError, undefined);
  assert.deepEqual(calls[0][1], { name: "X", status: "blocked", campaigns: [GROUP] });
});

test("create_ad_plan takes extra.ad_groups as a synonym and never sends both spellings", async () => {
  const calls: unknown[][] = [];
  const create = captureTool("create_ad_plan", recordingClient(calls));
  await create({ name: "X", extra: { ad_groups: [GROUP] } });

  assert.deepEqual(calls[0][1], { name: "X", campaigns: [GROUP] });
});

test("create_ad_plan refuses conflicting or existing groups before calling VK", async () => {
  const calls: unknown[][] = [];
  const create = captureTool("create_ad_plan", recordingClient(calls));
  for (const args of [
    { name: "X", adGroups: [GROUP], extra: { campaigns: [GROUP] } },
    { name: "X", adGroups: [{ ...GROUP, id: 7 }] },
    { name: "X", extra: { campaigns: [{ ...GROUP, ad_plan_id: 7 }] } },
    { name: "X", extra: { ad_groups: [null] } },
  ]) {
    assert.equal((await create(args)).isError, true);
  }
  assert.equal(calls.length, 0);
});

test("create_ad_plan refuses both budgets in a nested group or through extra before calling VK", async () => {
  const calls: unknown[][] = [];
  const create = captureTool("create_ad_plan", recordingClient(calls));
  for (const args of [
    { name: "X", budgetLimit: 5000, extra: { budget_limit_day: 500, campaigns: [GROUP] } },
    { name: "X", adGroups: [{ ...GROUP, budget_limit: 5000, budget_limit_day: 500 }] },
  ]) {
    const result = await create(args);
    assert.equal(result.isError, true);
    assert.match(text(result), /только одно из двух/);
  }
  assert.equal(calls.length, 0);
});

test("update_ad_plan refuses both budgets; a null clearing one does not count", async () => {
  const calls: unknown[][] = [];
  const update = captureTool("update_ad_plan", recordingClient(calls));
  assert.equal((await update({ id: 1, budgetLimit: 5000, budgetLimitDay: 500 })).isError, true);
  assert.equal(calls.length, 0);
  assert.equal((await update({ id: 1, budgetLimitDay: 500, extra: { budget_limit: null } })).isError, undefined);
  assert.equal(calls.length, 1);
});
