import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VkAdsClient } from "../client.js";
import { ACTION_TO_STATUS, compact, csv, fail, ok, READ_ONLY, setStatusForIds, WRITE_CREATE, WRITE_DELETE, WRITE_UPDATE } from "./util.js";

const DEFAULT_FIELDS = [
  "id",
  "name",
  "status",
  "ad_group_id",
  "delivery",
  "issues",
  "moderation_status",
  "moderation_reasons",
  "textblocks",
  "urls",
  "content",
  "ord_marker",
  "created",
  "updated",
];

export function registerBannerTools(server: McpServer, client: VkAdsClient): void {
  server.registerTool(
    "list_banners",
    {
      title: "Список объявлений (banners)",
      annotations: READ_ONLY,
      description:
        "Возвращает список banner (объект объявления/креатива в VK Рекламе) с необязательной фильтрацией по id, родительской группе объявлений и статусу. moderation_status (pending/allowed/banned) и delivery объясняют, почему объявление показывается или не показывается.",
      inputSchema: {
        ids: z.array(z.number().int()).optional().describe("Фильтр по id объявлений."),
        adGroupIds: z.array(z.number().int()).optional().describe("Фильтр по id родительских групп объявлений."),
        statuses: z
          .array(z.enum(["active", "blocked", "deleted"]))
          .optional()
          .describe("Фильтр по статусу."),
        fields: z.array(z.string()).optional().describe("Поля объявления в ответе."),
        limit: z.number().int().min(1).max(250).optional().describe("Сколько объектов на страницу (не больше 250)."),
        offset: z.number().int().min(0).optional().describe("Смещение постраничной выдачи (сколько объектов пропустить)."),
        autoPaginate: z
          .boolean()
          .optional()
          .describe("Забрать все страницы, идя по offset/count (limit при этом не ограничивает общее число объектов)."),
      },
    },
    async ({ ids, adGroupIds, statuses, fields, limit, offset, autoPaginate }) => {
      try {
        const query = compact({
          fields: (fields?.length ? fields : DEFAULT_FIELDS).join(","),
          _id__in: csv(ids),
          _ad_group_id__in: csv(adGroupIds),
          _status__in: csv(statuses),
          limit,
          offset,
        });
        const result = autoPaginate
          ? await client.getAll("v2/banners.json", query)
          : await client.get("v2/banners.json", query);
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_banner",
    {
      title: "Создать объявление (banner)",
      annotations: WRITE_CREATE,
      description:
        "Создаёт объявление внутри группы объявлений. Креатив ссылается на загруженные медиа через `content`, тексты объявления — в `textblocks`, ссылки — в `urls`. Эти структуры отправляются как есть; точная форма для каждого формата объявления — в документации VK Рекламы.",
      inputSchema: {
        adGroupId: z.number().int().describe("Id родительской группы объявлений."),
        name: z.string().min(1).optional().describe("Название объявления."),
        textblocks: z
          .record(z.any())
          .optional()
          .describe("Текстовые блоки, например {\"title\":{\"text\":\"...\"},\"text\":{\"text\":\"...\"}}."),
        urls: z.record(z.any()).optional().describe("Объекты ссылок, например {\"primary\":{\"url\":\"https://...\"}}."),
        content: z.record(z.any()).optional().describe("Ссылки на содержимое креатива (id загруженных медиа)."),
        extra: z.record(z.any()).optional().describe("Дополнительные поля объявления, подмешиваемые в тело запроса как есть."),
      },
    },
    async ({ adGroupId, name, textblocks, urls, content, extra }) => {
      try {
        const body = compact({
          ad_group_id: adGroupId,
          name,
          textblocks,
          urls,
          content,
          ...extra,
        });
        const result = await client.post("v2/banners.json", body);
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_banner",
    {
      title: "Изменить объявление (banner)",
      annotations: WRITE_UPDATE,
      description:
        "Меняет у объявления название, текстовые блоки или ссылки. Для смены статуса — banner_action. Структуры отправляются как есть.",
      inputSchema: {
        id: z.number().int().describe("Id изменяемого объявления."),
        name: z.string().min(1).optional().describe("Новое название."),
        textblocks: z.record(z.any()).optional().describe("Новые текстовые блоки взамен прежних, отправляются как есть."),
        urls: z.record(z.any()).optional().describe("Новые объекты ссылок взамен прежних, отправляются как есть."),
        extra: z.record(z.any()).optional().describe("Дополнительные поля, подмешиваемые в тело запроса как есть."),
      },
    },
    async ({ id, name, textblocks, urls, extra }) => {
      try {
        const body = compact({ name, textblocks, urls, ...extra });
        if (Object.keys(body).length === 0) {
          return fail("Нужно передать хотя бы одно поле для изменения.");
        }
        const result = await client.post(`v2/banners/${id}.json`, body);
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "banner_action",
    {
      title: "Действие над объявлением",
      annotations: WRITE_DELETE,
      description:
        "Меняет статус объявлений по id: activate (status=active), stop (status=blocked) или delete (status=deleted).",
      inputSchema: {
        action: z.enum(["activate", "stop", "delete"]),
        ids: z.array(z.number().int()).min(1).describe("Id объявлений, к которым применить действие."),
      },
    },
    async ({ action, ids }) => {
      try {
        return await setStatusForIds(client, "banners", ids, ACTION_TO_STATUS[action]);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
