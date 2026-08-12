import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VkAdsClient } from "../client.js";
import { ACTION_TO_STATUS, compact, csv, fail, isoDate, ok, READ_ONLY, setStatusForIds, WRITE_CREATE, WRITE_DELETE, WRITE_UPDATE } from "./util.js";

const DEFAULT_FIELDS = [
  "id",
  "name",
  "status",
  "ad_plan_id",
  "autobidding_mode",
  "budget_limit",
  "budget_limit_day",
  "date_start",
  "date_end",
  "delivery",
  "issues",
  "max_price",
  "objective",
  "price",
  "created",
  "updated",
];

export function registerAdGroupTools(server: McpServer, client: VkAdsClient): void {
  server.registerTool(
    "list_ad_groups",
    {
      title: "Список групп объявлений",
      annotations: READ_ONLY,
      description:
        "Возвращает список групп объявлений с необязательной фильтрацией по id, родительской кампании и статусу. Денежные поля — в валюте аккаунта; в `targetings` лежит структура таргетинга по гео, демографии и интересам.",
      inputSchema: {
        ids: z.array(z.number().int()).optional().describe("Фильтр по id групп объявлений."),
        adPlanIds: z.array(z.number().int()).optional().describe("Фильтр по id родительских кампаний."),
        statuses: z
          .array(z.enum(["active", "blocked", "deleted"]))
          .optional()
          .describe("Фильтр по статусу."),
        fields: z
          .array(z.string())
          .optional()
          .describe("Поля группы объявлений в ответе (с «targetings» вернётся полный объект таргетинга)."),
        limit: z.number().int().min(1).max(250).optional().describe("Сколько объектов на страницу (не больше 250)."),
        offset: z.number().int().min(0).optional().describe("Смещение постраничной выдачи (сколько объектов пропустить)."),
        autoPaginate: z
          .boolean()
          .optional()
          .describe("Забрать все страницы, идя по offset/count (limit при этом не ограничивает общее число объектов)."),
      },
    },
    async ({ ids, adPlanIds, statuses, fields, limit, offset, autoPaginate }) => {
      try {
        const query = compact({
          fields: (fields?.length ? fields : DEFAULT_FIELDS).join(","),
          _id__in: csv(ids),
          _ad_plan_id__in: csv(adPlanIds),
          _status__in: csv(statuses),
          limit,
          offset,
        });
        const result = autoPaginate
          ? await client.getAll("v2/ad_groups.json", query)
          : await client.get("v2/ad_groups.json", query);
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_ad_group",
    {
      title: "Создать группу объявлений",
      annotations: WRITE_CREATE,
      description:
        "Создаёт группу объявлений внутри кампании. Таргетинг задаётся в `targetings` (например, {\"geo\":{\"regions\":[188]},\"age\":{\"age_list\":[25,26]}}). Денежные поля — в валюте аккаунта. Остальные поля — через `extra`.",
      inputSchema: {
        adPlanId: z.number().int().describe("Id родительской кампании."),
        name: z.string().min(1).describe("Название группы объявлений."),
        objective: z
          .string()
          .optional()
          .describe("Цель группы, например site_conversions, leadads, traffic."),
        autobiddingMode: z.string().optional().describe("Стратегия аукциона, например max_goals."),
        budgetLimit: z.number().positive().optional().describe("Общий бюджет в валюте аккаунта."),
        budgetLimitDay: z.number().positive().optional().describe("Дневной бюджет в валюте аккаунта."),
        maxPrice: z.number().positive().optional().describe("Предельная ставка в валюте аккаунта."),
        price: z.number().positive().optional().describe("Цена оптимизируемого события в валюте аккаунта."),
        dateStart: isoDate().optional().describe("Дата начала, YYYY-MM-DD."),
        dateEnd: isoDate().optional().describe("Дата окончания, YYYY-MM-DD."),
        targetings: z.record(z.any()).optional().describe("Структура таргетинга, отправляется как есть."),
        extra: z.record(z.any()).optional().describe("Дополнительные поля, подмешиваемые в тело запроса как есть."),
      },
    },
    async (args) => {
      try {
        const body = compact({
          ad_plan_id: args.adPlanId,
          name: args.name,
          objective: args.objective,
          autobidding_mode: args.autobiddingMode,
          budget_limit: args.budgetLimit,
          budget_limit_day: args.budgetLimitDay,
          max_price: args.maxPrice,
          price: args.price,
          date_start: args.dateStart,
          date_end: args.dateEnd,
          targetings: args.targetings,
          ...args.extra,
        });
        const result = await client.post("v2/ad_groups.json", body);
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_ad_group",
    {
      title: "Изменить группу объявлений",
      annotations: WRITE_UPDATE,
      description:
        "Меняет у группы объявлений название, бюджеты, предельную ставку, даты или таргетинг. Денежные поля — в валюте аккаунта. Для смены статуса — ad_group_action.",
      inputSchema: {
        id: z.number().int().describe("Id изменяемой группы объявлений."),
        name: z.string().min(1).optional().describe("Новое название."),
        budgetLimit: z.number().positive().optional().describe("Общий бюджет в валюте аккаунта."),
        budgetLimitDay: z.number().positive().optional().describe("Дневной бюджет в валюте аккаунта."),
        maxPrice: z.number().positive().optional().describe("Предельная ставка в валюте аккаунта."),
        dateEnd: isoDate().optional().describe("Новая дата окончания, YYYY-MM-DD."),
        targetings: z.record(z.any()).optional().describe("Новая структура таргетинга взамен прежней, отправляется как есть."),
        extra: z.record(z.any()).optional().describe("Дополнительные поля, подмешиваемые в тело запроса как есть."),
      },
    },
    async ({ id, name, budgetLimit, budgetLimitDay, maxPrice, dateEnd, targetings, extra }) => {
      try {
        const body = compact({
          name,
          budget_limit: budgetLimit,
          budget_limit_day: budgetLimitDay,
          max_price: maxPrice,
          date_end: dateEnd,
          targetings,
          ...extra,
        });
        if (Object.keys(body).length === 0) {
          return fail("Нужно передать хотя бы одно поле для изменения.");
        }
        const result = await client.post(`v2/ad_groups/${id}.json`, body);
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "ad_group_action",
    {
      title: "Действие над группой объявлений",
      annotations: WRITE_DELETE,
      description:
        "Меняет статус групп объявлений по id: activate (status=active), stop (status=blocked) или delete (status=deleted).",
      inputSchema: {
        action: z.enum(["activate", "stop", "delete"]),
        ids: z.array(z.number().int()).min(1).describe("Id групп объявлений, к которым применить действие."),
      },
    },
    async ({ action, ids }) => {
      try {
        return await setStatusForIds(client, "ad_groups", ids, ACTION_TO_STATUS[action]);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
