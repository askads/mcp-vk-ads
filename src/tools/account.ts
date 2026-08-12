import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VkAdsClient } from "../client.js";
import { fail, ok, READ_ONLY } from "./util.js";

type Region = { id: number; name: string; type: string };

export function registerAccountTools(server: McpServer, client: VkAdsClient): void {
  // The region dictionary is static within a process, so fetch it once and reuse it
  // across get_regions calls. (In per-request MCP hosts the cache dies with the
  // request; for standalone/long-lived clients it saves the full re-download.)
  let regionsCache: Region[] | undefined;

  server.registerTool(
    "get_user_info",
    {
      title: "Информация об аккаунте",
      annotations: READ_ONLY,
      description:
        "Возвращает информацию о текущем аккаунте VK Рекламы (user.json), включая additional_info.client_name. Позволяет убедиться, на какой аккаунт рекламодателя указывает токен.",
      inputSchema: {
        fields: z
          .array(z.string())
          .optional()
          .describe("Поля пользователя в ответе. По умолчанию — базовый набор."),
      },
    },
    async ({ fields }) => {
      try {
        const result = await client.get("v3/user.json", {
          fields: (fields?.length ? fields : ["id", "username", "additional_info"]).join(","),
        });
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_balance",
    {
      title: "Баланс аккаунта",
      annotations: READ_ONLY,
      description:
        "Возвращает текущий баланс аккаунта VK Рекламы: доступные средства и валюту. " +
        "Вызывает user.json с полем `account`, в котором лежит кошелёк " +
        "(account.balance, account.currency). Показывает баланс того аккаунта, на который " +
        "указывает токен (параметров нет). " +
        "Важно: точное имя поля с балансом в v3/user.json на новой платформе ads.vk.com " +
        "не подтверждено на живом кабинете (домен закрыт JS); схема следует объектной " +
        "модели myTarget/VK Ads (v2/v3). Инструмент отдаёт СЫРОЙ ответ VK без изменений, " +
        "поэтому вызывающая сторона может аккуратно прочитать account.balance независимо от " +
        "точной формы ответа — проверить на первом живом аккаунте с доступом read_payments.",
      // Balance comes from the account the token belongs to — no inputs.
      inputSchema: {},
    },
    async () => {
      try {
        // `account` carries the wallet (balance + currency); `currency` is requested at
        // the top level too since VK may surface the code there rather than under account.
        // Return the RAW response (no normalization): balance is a Decimal in the account
        // CURRENCY (major units / rubles — NO micro-units, unlike Yandex Direct) and may
        // arrive as a string ("1234.56") or number. The askads loader reads
        // account.balance defensively.
        const result = await client.get("v3/user.json", {
          fields: "id,username,account,currency",
        });
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_throttling",
    {
      title: "Лимиты запросов к API",
      annotations: READ_ONLY,
      description:
        "Возвращает текущие лимиты запросов VK Рекламы и их остаток (throttling.json) — чтобы не упереться в лимит.",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await client.get("v2/throttling.json");
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_regions",
    {
      title: "Список регионов",
      annotations: READ_ONLY,
      description:
        "Возвращает гео-регионы VK Рекламы (id, name, type), при необходимости отфильтрованные по подстроке названия. Id регионов нужны для гео-таргетинга группы объявлений.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Подстрока для фильтра по названию региона, без учёта регистра (например, «Москва»)."),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Сколько регионов вернуть после фильтрации. По умолчанию 50."),
      },
    },
    async ({ query, limit }) => {
      try {
        if (!regionsCache) {
          // Fetch the FULL geo dictionary (opt out of MAX_AUTO_ITEMS): we filter
          // locally and return only a small slice, so the model-facing item cap would
          // just silently drop searchable regions (VK's dictionary exceeds 1000).
          const { items } = await client.getAll<Region>(
            "v2/regions.json",
            { fields: "id,name,type" },
            100,
            Number.POSITIVE_INFINITY,
          );
          regionsCache = items;
        }
        const needle = query?.trim().toLowerCase();
        const filtered = needle
          ? regionsCache.filter(
              (r) => typeof r.name === "string" && r.name.toLowerCase().includes(needle),
            )
          : regionsCache;
        return ok(filtered.slice(0, limit ?? 50));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
