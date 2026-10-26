import { test } from "node:test";
import assert from "node:assert/strict";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { VkAdsClient } from "../client.js";
import { registerMediaTools } from "./media.js";

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

function upload(client: VkAdsClient): Handler {
  let handler: Handler | undefined;
  const server = {
    registerTool: (_name: string, _def: unknown, h: Handler) => {
      handler = h;
    },
  } as unknown as McpServer;
  registerMediaTools(server, client);
  return handler!;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64");

test("upload_image sends a multipart file plus width/height data to v2/content/static.json", async () => {
  const calls: unknown[][] = [];
  const client = {
    post: async (...args: unknown[]) => {
      calls.push(args);
      return { id: 123, variants: {} };
    },
  } as unknown as VkAdsClient;
  const res = await upload(client)({ imageBase64: PNG, width: 600, height: 600 });

  assert.equal(res.isError, undefined);
  assert.equal(calls[0][0], "v2/content/static.json");
  const form = calls[0][1] as FormData;
  assert.ok(form instanceof FormData);
  const file = form.get("file") as File;
  assert.equal(file.type, "image/png");
  assert.equal(file.size, 12);
  assert.equal(form.get("data"), JSON.stringify({ width: 600, height: 600 }));
});

test("upload_image refuses junk base64, a data: prefix and non-images before calling VK", async () => {
  let calls = 0;
  const client = { post: async () => (calls++, {}) } as unknown as VkAdsClient;
  const tool = upload(client);
  for (const imageBase64 of ["@@@@", `data:image/png;base64,${PNG}`, Buffer.from("not an image").toString("base64")]) {
    assert.equal((await tool({ imageBase64, width: 1, height: 1 })).isError, true);
  }
  assert.equal(calls, 0);
});
