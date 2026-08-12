import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { VkAdsClient } from "../dist/client.js";
import { registerAccountTools } from "../dist/tools/account.js";

test("dist client rejects foreign-origin paths before sending the bearer token", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };

  const client = new VkAdsClient({
    token: "SECRET",
    lang: "ru",
    apiBase: "https://ads.vk.com/api",
    timeoutMs: 1000,
    maxRetries: 0,
  });

  await assert.rejects(() => client.get("https://example.invalid/steal"), /foreign origin/);
  assert.equal(called, false);
});

test("dist client does not retry a write on 5xx", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("bad gateway", { status: 502 });
  };

  const client = new VkAdsClient({
    token: "SECRET",
    lang: "ru",
    apiBase: "https://ads.vk.com/api",
    timeoutMs: 1000,
    maxRetries: 2,
    retryBaseMs: 1,
  });

  await assert.rejects(() => client.post("v2/ad_plans.json", { name: "one" }), /HTTP 502/);
  assert.equal(calls, 1);
});

test("dist account tools include get_balance", async () => {
  const tools = new Map();
  const server = {
    registerTool(name, spec, handler) {
      tools.set(name, { spec, handler });
    },
  };
  const client = {
    async get(path, query) {
      return { path, query, account: { balance: "10.00" }, currency: "RUB" };
    },
  };

  registerAccountTools(server, client);
  assert.equal(tools.has("get_balance"), true);

  const result = await tools.get("get_balance").handler({});
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.path, "v3/user.json");
  assert.match(body.query.fields, /account/);
  assert.match(body.query.fields, /currency/);
});

test("initialize result carries the server instructions", async () => {
  // Real handshake against the built server over stdio: the instructions are the
  // one piece of prose every calling model sees, so an empty field must fail here.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    stderr: "ignore",
    // A dummy token gets the server past config; no API call happens during the
    // handshake, and telemetry is off so the test stays offline.
    env: { ...process.env, VK_ADS_TOKEN: "test-token", ASKADS_TELEMETRY: "0" },
  });
  const client = new Client({ name: "dist-smoke", version: "1.0.0" });
  await client.connect(transport);

  try {
    const instructions = client.getInstructions();
    assert.ok(instructions && instructions.trim().length > 0, "instructions must not be empty");
    assert.match(instructions, /ads\.vk\.com/);
  } finally {
    await client.close();
  }
});
