import assert from "node:assert/strict";
import test from "node:test";

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
