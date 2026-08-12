import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { HttpMethod } from "../client.js";
import type { VkAdsClient } from "../client.js";
import { fail, ok, WRITE_DELETE } from "./util.js";

/** Only GET reads data; POST and DELETE mutate the account. */
export function isReadMethod(method: string): boolean {
  return method.toUpperCase() === "GET";
}

export function registerRawTool(server: McpServer, client: VkAdsClient): void {
  server.registerTool(
    "raw_request",
    {
      title: "Произвольный запрос к API VK Рекламы",
      // Escape hatch: can POST/DELETE, so flag it destructive.
      annotations: WRITE_DELETE,
      description:
        'Универсальный запрос напрямую к любому эндпоинту API VK Рекламы (например, path "v2/ad_plans.json", method GET). Нужен для эндпоинтов, у которых нет отдельного инструмента. `query` уходит в строку запроса, `body` отправляется как JSON для POST. GET выполняется свободно; POST и DELETE — запись, для них нужен confirmWrite=true.',
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe('Путь эндпоинта с версией, например "v2/ad_plans.json", "v3/statistics/banners/day.json".'),
        method: z.enum(["GET", "POST", "DELETE"]).optional().describe("HTTP-метод. По умолчанию GET."),
        query: z
          .record(z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Параметры строки запроса (фильтры, поля, постраничная выдача)."),
        body: z.record(z.any()).optional().describe("JSON-тело для POST-запросов."),
        confirmWrite: z
          .boolean()
          .optional()
          .describe("Должен быть true для записи (POST или DELETE)."),
      },
    },
    async ({ path, method, query, body, confirmWrite }) => {
      try {
        const m = (method ?? "GET") as HttpMethod;
        if (!isReadMethod(m) && confirmWrite !== true) {
          return fail(
            `"${m} ${path}" — операция записи. Повторить вызов с confirmWrite=true, чтобы выполнить её.`,
          );
        }
        const result = await client.request(m, path, { query, body });
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
