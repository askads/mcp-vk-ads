#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VkAdsClient } from "./client.js";
import { ConfigError, loadConfig } from "./config.js";
import { instrumentToolCalls, Telemetry } from "./telemetry.js";
import type { VkAdsConfig } from "./types.js";

/** Reads the package version so the server reports its real version to MCP clients. */
function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
import { registerAccountTools } from "./tools/account.js";
import { registerAdPlanTools } from "./tools/adPlans.js";
import { registerAdGroupTools } from "./tools/adGroups.js";
import { registerBannerTools } from "./tools/banners.js";
import { registerStatisticsTools } from "./tools/statistics.js";
import { registerRawTool } from "./tools/raw.js";

/**
 * Shipped as the `instructions` of the MCP initialize result — the only prose the
 * calling model gets before it picks a tool, in every session. It carries what the
 * tool list cannot: which VK product this actually is, what the API refuses to do,
 * where the money is, and the failures that look like something else. It is charged
 * to every session's context, so keep it dense.
 */
export const INSTRUCTIONS =
  "VK Ads (VK Реклама) is the advertiser cabinet API at ads.vk.com — myTarget object lineage, not " +
  "VK's social api.vk.com. Objects nest: ad_plan (campaign) → ad_group → banner (ad). `status` is " +
  "the only settable state field (stop sets blocked = paused, not banned); `delivery` and " +
  "`moderation_status` are read-only diagnostics, and money is in account currency (rubles) as " +
  "returned, no micro-units. Writes take one object per request, so a batch can end up partly " +
  "applied; the result names the failed ids. Pages cap at 250 and autoPaginate at 1000 objects " +
  "(flagged `_truncated`). 429s are retried with backoff (see get_throttling before bulk loops); " +
  "5xx and timeouts are retried on reads only, since a failed write may have committed anyway — " +
  "list before re-creating. `invalid_token` means an expired token only the user can replace — do " +
  "not retry; raw_request refuses absolute URLs, paths are relative and versioned. There is no " +
  "sandbox: every call hits a live account with real budget, and the typed create/update/*_action " +
  "tools apply at once — only raw_request gates writes behind confirmWrite.";

/**
 * Loads the config, reporting the drop-off if it is missing. An unconfigured
 * server dies before the MCP handshake, so this ping is the only trace such an
 * install ever leaves — and it has to be awaited, or process.exit() below would
 * kill the request in flight.
 */
async function loadConfigOrExit(telemetry: Telemetry): Promise<VkAdsConfig> {
  try {
    return loadConfig();
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`Error: ${err.message}`);
    await telemetry.sendBlocking("startup_failed", { reason: err.reason });
    process.exit(1);
  }
}

async function main(): Promise<void> {
  // Anonymous usage pings (ids/names/versions only, never data or arguments);
  // opt out with ASKADS_TELEMETRY=0. Built before the config so a missing token
  // can be reported; wired to the server before tools register.
  const telemetry = new Telemetry(readVersion());
  const config = await loadConfigOrExit(telemetry);
  const client = new VkAdsClient(config);

  const server = new McpServer(
    {
      name: "mcp-vk-ads",
      version: readVersion(),
    },
    // Surfaces in the initialize result, before the client sees a single tool.
    { instructions: INSTRUCTIONS },
  );

  instrumentToolCalls(server, telemetry);
  server.server.oninitialized = () => {
    telemetry.setClientInfo(server.server.getClientVersion());
    telemetry.send("server_start");
  };

  registerAccountTools(server, client);
  registerAdPlanTools(server, client);
  registerAdGroupTools(server, client);
  registerBannerTools(server, client);
  registerStatisticsTools(server, client);
  registerRawTool(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-vk-ads running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting mcp-vk-ads:", err);
  process.exit(1);
});
