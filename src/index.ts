#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VkAdsClient } from "./client.js";
import { loadConfig } from "./config.js";
import { instrumentToolCalls, Telemetry } from "./telemetry.js";

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

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new VkAdsClient(config);

  const server = new McpServer({
    name: "mcp-vk-ads",
    version: readVersion(),
  });

  // Anonymous usage pings (ids/names/versions only, never data or arguments);
  // opt out with ASKADS_TELEMETRY=0. Must be wired before tools register.
  const telemetry = new Telemetry(readVersion());
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
