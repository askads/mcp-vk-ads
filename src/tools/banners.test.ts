import { test } from "node:test";
import assert from "node:assert/strict";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { VkAdsClient } from "../client.js";
import { registerBannerTools } from "./banners.js";

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

function captureTool(name: string, client: VkAdsClient): Handler {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (toolName: string, _def: unknown, h: Handler) => {
      handlers.set(toolName, h);
    },
  } as unknown as McpServer;
  registerBannerTools(server, client);
  const handler = handlers.get(name);
  if (!handler) throw new Error(`${name} was not registered`);
  return handler;
}

test("create_banner posts under the parent group, not to the v2/banners.json list", async () => {
  const calls: unknown[][] = [];
  const client = {
    post: async (...args: unknown[]) => {
      calls.push(args);
      return { id: 9 };
    },
  } as unknown as VkAdsClient;
  const res = await captureTool("create_banner", client)({
    adGroupId: 42,
    textblocks: { title: { text: "t" } },
    content: { image_600x600: { id: 7 } },
  });
  assert.equal(res.isError, undefined);
  assert.equal(calls[0][0], "v2/ad_groups/42/banners.json");
  assert.deepEqual(calls[0][1], { textblocks: { title: { text: "t" } }, content: { image_600x600: { id: 7 } } });
});
