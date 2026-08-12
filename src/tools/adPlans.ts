import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VkAdsClient } from "../client.js";
import { ACTION_TO_STATUS, compact, csv, fail, isoDate, ok, READ_ONLY, setStatusForIds, WRITE_CREATE, WRITE_DELETE, WRITE_UPDATE } from "./util.js";

const DEFAULT_FIELDS = [
  "id",
  "name",
  "status",
  "vkads_status",
  "autobidding_mode",
  "budget_limit",
  "budget_limit_day",
  "date_start",
  "date_end",
  "max_price",
  "objective",
  "created",
  "updated",
];

export function registerAdPlanTools(server: McpServer, client: VkAdsClient): void {
  server.registerTool(
    "list_ad_plans",
    {
      title: "Список кампаний (ad_plans)",
      annotations: READ_ONLY,
      description:
        "Возвращает список ad_plan (верхнеуровневый объект кампании в VK Рекламе) с необязательной фильтрацией по id и статусу. Денежные поля (budget_limit, budget_limit_day, max_price) — в валюте аккаунта.",
      inputSchema: {
        ids: z.array(z.number().int()).optional().describe("Фильтр по id кампаний."),
        statuses: z
          .array(z.enum(["active", "blocked", "deleted"]))
          .optional()
          .describe("Фильтр по статусу."),
        fields: z.array(z.string()).optional().describe("Поля кампании в ответе."),
        limit: z.number().int().min(1).max(250).optional().describe("Сколько объектов на страницу (не больше 250)."),
        offset: z.number().int().min(0).optional().describe("Смещение постраничной выдачи (сколько объектов пропустить)."),
        autoPaginate: z
          .boolean()
          .optional()
          .describe("Забрать все страницы, идя по offset/count (limit при этом не ограничивает общее число объектов)."),
      },
    },
    async ({ ids, statuses, fields, limit, offset, autoPaginate }) => {
      try {
        const query = compact({
          fields: (fields?.length ? fields : DEFAULT_FIELDS).join(","),
          _id__in: csv(ids),
          _status__in: csv(statuses),
          limit,
          offset,
        });
        const result = autoPaginate
          ? await client.getAll("v2/ad_plans.json", query)
          : await client.get("v2/ad_plans.json", query);
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_ad_plan",
    {
      title: "Создать кампанию (ad_plan)",
      annotations: WRITE_CREATE,
      description:
        "Создаёт кампанию (ad_plan). Денежные поля — в валюте аккаунта. Сложные и редкие поля передаются через `extra` (подмешиваются в тело запроса как есть).",
      inputSchema: {
        name: z.string().min(1).describe("Название кампании."),
        objective: z
          .string()
          .optional()
          .describe("Цель кампании, например site_conversions, leadads, traffic."),
        autobiddingMode: z
          .string()
          .optional()
          .describe("Стратегия аукциона, например max_goals, fixed, second_price_mean."),
        budgetLimit: z.number().positive().optional().describe("Общий бюджет в валюте аккаунта."),
        budgetLimitDay: z.number().positive().optional().describe("Дневной бюджет в валюте аккаунта."),
        maxPrice: z.number().positive().optional().describe("Предельная ставка в валюте аккаунта."),
        dateStart: isoDate().optional().describe("Дата начала, YYYY-MM-DD."),
        dateEnd: isoDate().optional().describe("Дата окончания, YYYY-MM-DD."),
        extra: z
          .record(z.any())
          .optional()
          .describe("Дополнительные поля кампании, подмешиваемые в тело запроса (например, priced_goal, pricelist_id)."),
      },
    },
    async ({ name, objective, autobiddingMode, budgetLimit, budgetLimitDay, maxPrice, dateStart, dateEnd, extra }) => {
      try {
        const body = compact({
          name,
          objective,
          autobidding_mode: autobiddingMode,
          budget_limit: budgetLimit,
          budget_limit_day: budgetLimitDay,
          max_price: maxPrice,
          date_start: dateStart,
          date_end: dateEnd,
          ...extra,
        });
        const result = await client.post("v2/ad_plans.json", body);
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_ad_plan",
    {
      title: "Изменить кампанию (ad_plan)",
      annotations: WRITE_UPDATE,
      description:
        "Меняет у кампании название, бюджеты, предельную ставку или даты. Денежные поля — в валюте аккаунта. Для смены статуса — ad_plan_action.",
      inputSchema: {
        id: z.number().int().describe("Id изменяемой кампании."),
        name: z.string().min(1).optional().describe("Новое название."),
        budgetLimit: z.number().positive().optional().describe("Общий бюджет в валюте аккаунта."),
        budgetLimitDay: z.number().positive().optional().describe("Дневной бюджет в валюте аккаунта."),
        maxPrice: z.number().positive().optional().describe("Предельная ставка в валюте аккаунта."),
        dateEnd: isoDate().optional().describe("Новая дата окончания, YYYY-MM-DD."),
        extra: z.record(z.any()).optional().describe("Дополнительные поля, подмешиваемые в тело запроса как есть."),
      },
    },
    async ({ id, name, budgetLimit, budgetLimitDay, maxPrice, dateEnd, extra }) => {
      try {
        const body = compact({
          name,
          budget_limit: budgetLimit,
          budget_limit_day: budgetLimitDay,
          max_price: maxPrice,
          date_end: dateEnd,
          ...extra,
        });
        if (Object.keys(body).length === 0) {
          return fail("Нужно передать хотя бы одно поле для изменения.");
        }
        const result = await client.post(`v2/ad_plans/${id}.json`, body);
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "ad_plan_action",
    {
      title: "Действие над кампанией",
      annotations: WRITE_DELETE,
      description:
        "Меняет статус кампаний по id: activate (status=active), stop (status=blocked) или delete (status=deleted).",
      inputSchema: {
        action: z.enum(["activate", "stop", "delete"]),
        ids: z.array(z.number().int()).min(1).describe("Id кампаний, к которым применить действие."),
      },
    },
    async ({ action, ids }) => {
      try {
        return await setStatusForIds(client, "ad_plans", ids, ACTION_TO_STATUS[action]);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
