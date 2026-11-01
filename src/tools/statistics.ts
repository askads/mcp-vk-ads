import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VkAdsClient } from "../client.js";
import { compact, csv, fail, isoDate, ok, READ_ONLY } from "./util.js";

const ENTITIES = ["ad_plans", "ad_groups", "banners"] as const;
const PERIODS = ["summary", "day"] as const;

export function registerStatisticsTools(server: McpServer, client: VkAdsClient): void {
  server.registerTool(
    "get_statistics",
    {
      title: "Статистика",
      annotations: READ_ONLY,
      description:
        "Возвращает статистику по кампаниям (ad_plans), группам объявлений (ad_groups) или объявлениям (banners). По умолчанию группировка `summary` — одна сводная строка (`items[].total`) на объект: с dateFrom/dateTo — за этот период, без дат — за всё время. " +
        "`day` нужна ТОЛЬКО для динамики и вопросов про тренд: добавляет к каждому объекту `rows` по дням, даты обязательны. Недель и месяцев API не отдаёт — их собирают из `day`. " +
        "Ранжирование на стороне сервера (sortBy, например base.spent, и order) и постраничная выдача (limit/offset) работают только в `summary` с датами — в остальных режимах VK их молча игнорирует, поэтому инструмент вернёт ошибку. Там VK и так отдаёт все объекты одним ответом, так что autoPaginate безвреден в любом режиме. " +
        "`total` в ответе — сумма по объектам ЭТОЙ страницы (при фильтре по ids — по этим объектам), а не по всему кабинету. Метрики лежат в `base` (shows, clicks, spent, ...); spent — в валюте аккаунта.",
      inputSchema: {
        entity: z.enum(ENTITIES).optional().describe("Тип объектов для отчёта. По умолчанию banners."),
        period: z
          .enum(PERIODS)
          .optional()
          .describe("Группировка: summary (итог по объекту, по умолчанию) либо day для динамики по дням."),
        ids: z
          .array(z.number().int())
          .optional()
          .describe("Ограничить отчёт этими id объектов (выбранного entity)."),
        dateFrom: isoDate().optional().describe("Дата начала, YYYY-MM-DD (обязательна для day; для summary без дат — итог за всё время)."),
        dateTo: isoDate().optional().describe("Дата окончания, YYYY-MM-DD (обязательна для day)."),
        metrics: z
          .array(z.string())
          .optional()
          .describe("Группы метрик в отчёте, например base, events, video. По умолчанию — набор API."),
        sortBy: z
          .string()
          .optional()
          .describe("Поле сортировки на стороне сервера, например base.spent / base.clicks / base.shows (топ-N по метрике)."),
        order: z.enum(["asc", "desc"]).optional().describe("Направление сортировки для sortBy. По умолчанию desc."),
        limit: z.number().int().min(1).max(250).optional().describe("Сколько объектов на страницу (не больше 250)."),
        offset: z.number().int().min(0).optional().describe("Смещение постраничной выдачи (сколько объектов пропустить)."),
        autoPaginate: z.boolean().optional().describe("Забрать все страницы, идя по offset/count (в day и summary без дат ответ и так полный)."),
      },
    },
    async ({ entity, period, ids, dateFrom, dateTo, metrics, sortBy, order, limit, offset, autoPaginate }) => {
      try {
        const ent = entity ?? "banners";
        const grp = period ?? "summary";
        if (Boolean(dateFrom) !== Boolean(dateTo) || (grp === "day" && !dateFrom)) {
          return fail(`Для группировки "${grp}" нужны и dateFrom, и dateTo (YYYY-MM-DD).`);
        }
        // Checked live: v3 has only day.json, and it returns one period total per object
        // (no daily rows) with sort/paging — that IS the summary. Daily rows live in v2
        // day.json, all-time totals in v2 summary.json; both ignore sort/paging silently.
        // v3 summary/week/month and v2 week/month are 404.
        const paged = grp === "summary" && Boolean(dateFrom);
        if (!paged && (sortBy || order || limit !== undefined || offset !== undefined)) {
          return fail(
            "sortBy/order/limit/offset работают только в группировке summary с dateFrom/dateTo — " +
              "VK игнорирует их без периода и в day. Передайте период или уберите эти параметры.",
          );
        }
        const path = paged
          ? `v3/statistics/${ent}/day.json`
          : `v2/statistics/${ent}/${grp}.json`;
        const query = compact({
          id: csv(ids),
          date_from: dateFrom,
          date_to: dateTo,
          metrics: csv(metrics),
          sort_by: sortBy,
          d: order, // VK direction param (asc|desc); passing sort_by selects v3 sorting
          limit,
          offset,
        });
        // The v2 endpoints aren't paged — one response already holds every object — so
        // autoPaginate there is a plain get, not an error: callers that always pass it
        // (daily series over every plan) worked before 1.6.0 and must keep working.
        const pageAll = autoPaginate && paged;
        const result = pageAll ? await client.getAll(path, query) : await client.get(path, query);
        // getAll keeps the last page's `total`, which covers that page only — misleading.
        if (pageAll) delete (result as { total?: unknown }).total;
        // fail-loud: явный фильтр по ids, но 0 объектов — почти всегда неверный id/период.
        // Пустой ответ провоцирует модель снять фильтр; явная ошибка заставляет его починить.
        const items = (result as { items?: unknown[] } | undefined)?.items;
        if (ids?.length && Array.isArray(items) && items.length === 0) {
          return fail(
            `Статистика вернула 0 объектов по ids [${ids.join(", ")}] (entity ${ent}, группировка ${grp}). ` +
              "Проверить id и диапазон дат — снимать фильтр вслепую не нужно.",
          );
        }
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
