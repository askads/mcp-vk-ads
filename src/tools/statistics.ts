import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VkAdsClient } from "../client.js";
import { compact, csv, fail, isoDate, ok, READ_ONLY } from "./util.js";

const ENTITIES = ["ad_plans", "ad_groups", "banners"] as const;
const PERIODS = ["day", "week", "month", "summary"] as const;

export function registerStatisticsTools(server: McpServer, client: VkAdsClient): void {
  server.registerTool(
    "get_statistics",
    {
      title: "Статистика",
      annotations: READ_ONLY,
      description:
        "Возвращает статистику по кампаниям (ad_plans), группам объявлений (ad_groups) или объявлениям (banners) из сервиса статистики VK Рекламы v3. По умолчанию группировка `summary` — одна сводная строка на объект за весь период; day/week/month нужны ТОЛЬКО для динамики по дням и вопросов про тренд (каждая добавляет по строке на объект за период). Ранжирование на стороне сервера — через sortBy (например, base.spent) и order; в ответе есть также `total` — сводка по ВСЕМ объектам за период (для вопросов «сколько всего» суммировать строки не нужно). Метрики лежат в `base` (shows, clicks, spent, ...); spent — в валюте аккаунта.",
      inputSchema: {
        entity: z.enum(ENTITIES).optional().describe("Тип объектов для отчёта. По умолчанию banners."),
        period: z
          .enum(PERIODS)
          .optional()
          .describe("Группировка: summary (весь период, по умолчанию) либо day/week/month для динамики."),
        ids: z
          .array(z.number().int())
          .optional()
          .describe("Ограничить отчёт этими id объектов (выбранного entity)."),
        dateFrom: isoDate().optional().describe("Дата начала, YYYY-MM-DD (обязательна для day/week/month)."),
        dateTo: isoDate().optional().describe("Дата окончания, YYYY-MM-DD (обязательна для day/week/month)."),
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
        autoPaginate: z.boolean().optional().describe("Забрать все страницы, идя по offset/count."),
      },
    },
    async ({ entity, period, ids, dateFrom, dateTo, metrics, sortBy, order, limit, offset, autoPaginate }) => {
      try {
        const ent = entity ?? "banners";
        const grp = period ?? "summary";
        if (grp !== "summary" && (!dateFrom || !dateTo)) {
          return fail(`Для группировки "${grp}" нужны и dateFrom, и dateTo (YYYY-MM-DD).`);
        }
        const path = `v3/statistics/${ent}/${grp}.json`;
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
        const result = autoPaginate ? await client.getAll(path, query) : await client.get(path, query);
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
