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
  "VK Реклама (VK Ads) — API рекламного кабинета на ads.vk.com: объектная модель унаследована от " +
  "myTarget, это не социальный api.vk.com. Объекты вложены: ad_plan (кампания) → ad_group (группа " +
  "объявлений) → banner (объявление). `status` — единственное состояние, которое можно задать " +
  "(stop ставит blocked = пауза, а не бан); `delivery` и `moderation_status` — диагностика только " +
  "на чтение; деньги — в валюте аккаунта (рубли) как есть, без микроединиц. Запись меняет один " +
  "объект за запрос, поэтому пакет может примениться частично — в ответе перечислены id, на " +
  "которых произошёл сбой. Страница ограничена 250 объектами, autoPaginate — 1000 (помечается " +
  "`_truncated`). 429 повторяются с нарастающей паузой (перед массовыми циклами — get_throttling); " +
  "5xx и таймауты повторяются только на чтении: сорвавшаяся запись могла всё же примениться, " +
  "поэтому перед повторным созданием нужен список. `invalid_token` — истёкший токен, заменить его " +
  "может только пользователь: повторять бесполезно. raw_request не принимает абсолютные URL, пути " +
  "относительные и с версией. Песочницы нет: каждый вызов идёт в живой аккаунт с реальным " +
  "бюджетом, а типизированные create/update/*_action применяются сразу — подтверждение " +
  "confirmWrite нужно только для raw_request.";

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
    console.error(`Ошибка: ${err.message}`);
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
  console.error("Критическая ошибка при запуске mcp-vk-ads:", err);
  process.exit(1);
});
