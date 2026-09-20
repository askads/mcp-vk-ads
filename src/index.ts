#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TokenStore } from "./auth.js";
import { VkAdsClient } from "./client.js";
import { ConfigError, DEFAULT_API_BASE, loadConfig } from "./config.js";
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
import { registerAuthTools } from "./tools/auth.js";
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
  "поэтому перед повторным созданием нужен список. `invalid_token` — истёкший токен: после входа " +
  "через start_login сервер обновляет его сам, а заданный в VK_ADS_TOKEN заменяет только " +
  "пользователь. raw_request не принимает абсолютные URL, пути " +
  "относительные и с версией. Песочницы нет: каждый вызов идёт в живой аккаунт с реальным " +
  "бюджетом, а типизированные create/update/*_action применяются сразу — подтверждение " +
  "confirmWrite нужно только для raw_request.";

/**
 * Prepended to INSTRUCTIONS when no token is available. The model reads this
 * before it picks a tool, so an unconfigured session opens with the fix rather
 * than with a failed call.
 */
const UNCONFIGURED_PREFIX =
  "ВНИМАНИЕ: VK Реклама ещё не подключена — токена нет, поэтому любой инструмент данных вернёт " +
  "ошибку. Подключение делается прямо в диалоге и без перезапуска клиента: вызовите start_login, " +
  "покажите пользователю инструкцию, попросите создать приложение в кабинете (Настройки → Доступ " +
  "к API) и прислать client_id и client_secret, затем передайте их в finish_login. ";

/**
 * Loads the config without dying on a bad value. A server that exits here never
 * completes the MCP handshake, so the user sees a red cross and no reason — the
 * failure that used to account for nearly every unconfigured install. Instead the
 * problem is carried into the session, where the model can read it and relay it.
 */
function loadConfigOrDegraded(telemetry: Telemetry): {
  config: VkAdsConfig;
  problem?: ConfigError;
} {
  try {
    return { config: loadConfig() };
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`Ошибка конфигурации: ${err.message}`);
    // Fire-and-forget now that the process survives: the historical
    // `startup_failed` funnel stays comparable, but nothing blocks startup.
    telemetry.send("startup_failed", { reason: err.reason });
    return {
      config: {
        token: process.env.VK_ADS_TOKEN || undefined,
        lang: process.env.VK_ADS_LANG || "ru",
        apiBase: DEFAULT_API_BASE,
      },
      problem: err,
    };
  }
}

async function main(): Promise<void> {
  // Anonymous usage pings (ids/names/versions only, never data or arguments);
  // opt out with ASKADS_TELEMETRY=0. Built before the config so a missing token
  // can be reported; wired to the server before tools register.
  const telemetry = new Telemetry(readVersion());
  const { config, problem } = loadConfigOrDegraded(telemetry);
  const tokens = new TokenStore(config.token, { apiBase: config.apiBase });
  const client = new VkAdsClient(config, tokens);

  // Resolved once, at startup, only to pick the instructions text: the token
  // itself is re-read per request, so a login mid-session still takes effect.
  const connected = tokens.hasToken();

  const server = new McpServer(
    {
      name: "mcp-vk-ads",
      version: readVersion(),
    },
    // Surfaces in the initialize result, before the client sees a single tool.
    {
      instructions: connected
        ? INSTRUCTIONS
        : UNCONFIGURED_PREFIX +
          (problem ? `Проблема конфигурации: ${problem.message} ` : "") +
          INSTRUCTIONS,
    },
  );

  instrumentToolCalls(server, telemetry);
  server.server.oninitialized = () => {
    telemetry.setClientInfo(server.server.getClientVersion());
    // Split on purpose: `server_start` keeps meaning "a usable install started",
    // so the unconfigured case gets its own event instead of inflating that number.
    if (connected) telemetry.send("server_start");
    else telemetry.send("unconfigured_start", { reason: problem?.reason ?? "missing_token" });
  };

  registerAuthTools(server, client, tokens);
  registerAccountTools(server, client);
  registerAdPlanTools(server, client);
  registerAdGroupTools(server, client);
  registerBannerTools(server, client);
  registerStatisticsTools(server, client);
  registerRawTool(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `mcp-vk-ads running on stdio${connected ? "" : " (без токена — подключение через start_login)"}`,
  );
}

main().catch((err) => {
  console.error("Критическая ошибка при запуске mcp-vk-ads:", err);
  process.exit(1);
});
