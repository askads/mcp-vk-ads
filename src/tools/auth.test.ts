import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { TokenStore } from "../auth.js";
import type { VkAdsClient } from "../client.js";
import { readCredentials } from "../credentials.js";
import { registerAuthTools } from "./auth.js";

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

async function withTempConfig<T>(run: () => T | Promise<T>): Promise<T> {
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "mcp-vk-ads-tools-"));
  try {
    return await run();
  } finally {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
  }
}

function captureAuthTools(client: VkAdsClient, tokens: TokenStore): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _def: unknown, h: Handler) => {
      handlers.set(name, h);
    },
  } as unknown as McpServer;
  registerAuthTools(server, client, tokens);
  return handlers;
}

function payload(result: CallToolResult): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text);
}

/** A token endpoint that always mints the same pair. */
function tokenFetch(): typeof fetch {
  return (async () =>
    ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: "86400" }),
    }) as unknown as Response) as unknown as typeof fetch;
}

test("start_login returns the cabinet instructions without touching the network", async () => {
  await withTempConfig(async () => {
    const fetchImpl = (async () => {
      throw new Error("start_login must not call the network");
    }) as unknown as typeof fetch;
    const tools = captureAuthTools({} as VkAdsClient, new TokenStore(undefined, { fetchImpl }));

    const result = await tools.get("start_login")!({});
    const body = payload(result);

    assert.equal(result.isError, undefined);
    assert.match(String(body.settingsUrl), /ads\.vk\.com/);
    assert.deepEqual(body.expectedInputs, ["clientId", "clientSecret"]);
    assert.match(String(body.warning), /client_secret/);
  });
});

test("finish_login mints, stores and verifies against the live account", async () => {
  await withTempConfig(async () => {
    const calls: Array<{ path: string; query?: unknown }> = [];
    const client = {
      get: async (path: string, query?: unknown) => {
        calls.push({ path, query });
        return { id: 7, username: "adv@vk", additional_info: { client_name: "ООО Ромашка" } };
      },
    } as unknown as VkAdsClient;

    const tools = captureAuthTools(client, new TokenStore(undefined, { fetchImpl: tokenFetch() }));
    const result = await tools.get("finish_login")!({ clientId: " cid ", clientSecret: " secret " });
    const body = payload(result);

    assert.equal(result.isError, undefined);
    assert.equal(body.connected, true);
    assert.equal(body.username, "adv@vk");
    assert.equal(body.account, "ООО Ромашка");
    assert.equal(calls[0].path, "v3/user.json", "a fresh token must be proven, not assumed");

    const stored = readCredentials();
    assert.equal(stored?.access_token, "at");
    assert.equal(stored?.client_id, "cid", "surrounding whitespace is a paste artifact, not the id");
    assert.equal(stored?.username, "adv@vk");
  });
});

test("finish_login reports a bad client_id/client_secret pair instead of storing it", async () => {
  await withTempConfig(async () => {
    const fetchImpl = (async () =>
      ({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: "invalid_client" }),
      }) as unknown as Response) as unknown as typeof fetch;

    const tools = captureAuthTools({} as VkAdsClient, new TokenStore(undefined, { fetchImpl }));
    const result = await tools.get("finish_login")!({ clientId: "cid", clientSecret: "wrong" });

    assert.equal(result.isError, true);
    assert.match((result.content[0] as { text: string }).text, /invalid_client|client_secret/);
    assert.equal(readCredentials(), undefined, "a failed login must not leave credentials behind");
  });
});

test("finish_login keeps the token but warns when the verification call fails", async () => {
  await withTempConfig(async () => {
    const client = {
      get: async () => {
        throw new Error("HTTP 403: access denied");
      },
    } as unknown as VkAdsClient;

    const tools = captureAuthTools(client, new TokenStore(undefined, { fetchImpl: tokenFetch() }));
    const body = payload(await tools.get("finish_login")!({ clientId: "cid", clientSecret: "s" }));

    assert.equal(body.connected, true);
    assert.match(String(body.note), /403/, "the model has to be able to relay what went wrong");
    assert.equal(readCredentials()?.access_token, "at");
  });
});

test("auth_status and logout never leak the secret", async () => {
  await withTempConfig(async () => {
    const client = { get: async () => ({ username: "adv@vk" }) } as unknown as VkAdsClient;
    const tokens = new TokenStore(undefined, { fetchImpl: tokenFetch() });
    const tools = captureAuthTools(client, tokens);

    await tools.get("finish_login")!({ clientId: "cid", clientSecret: "very-secret" });

    const status = await tools.get("auth_status")!({});
    const statusText = (status.content[0] as { text: string }).text;
    assert.ok(!statusText.includes("very-secret"));
    assert.ok(!statusText.includes("at".repeat(20)));
    assert.equal(payload(status).configured, true);

    const removed = payload(await tools.get("logout")!({}));
    assert.equal(removed.removed, true);
    assert.equal(readCredentials(), undefined);
    assert.equal(payload(await tools.get("auth_status")!({})).configured, false);
  });
});
