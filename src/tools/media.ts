import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VkAdsClient } from "../client.js";
import { fail, ok, WRITE_CREATE } from "./util.js";

/** Our cap on the decoded image, not VK's per-format creative limit. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_BASE64_LENGTH = 4 * Math.ceil(MAX_IMAGE_BYTES / 3);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function registerMediaTools(server: McpServer, client: VkAdsClient): void {
  server.registerTool(
    "upload_image",
    {
      title: "Загрузить изображение",
      annotations: WRITE_CREATE,
      description:
        "Загружает изображение JPEG или PNG в медиатеку VK Рекламы (multipart POST v2/content/static.json) и возвращает его id и variants. " +
        "Этот id передаётся в create_banner как content.<слот>={\"id\": <id>}; какие слоты нужны, зависит от формата (package) группы. " +
        "Байты передаются base64 без префикса data:, вместе с шириной и высотой картинки в пикселях. " +
        "При сетевой ошибке или 5xx загрузка могла пройти — не повторять вслепую.",
      inputSchema: {
        imageBase64: z
          .string()
          .min(4)
          .max(MAX_BASE64_LENGTH)
          .describe("Изображение JPEG/PNG в base64, без префикса data:. Не больше 5 МБ после декодирования."),
        width: z.number().int().min(1).max(16384).describe("Ширина изображения в пикселях."),
        height: z.number().int().min(1).max(16384).describe("Высота изображения в пикселях."),
      },
    },
    async ({ imageBase64, width, height }) => {
      try {
        const bytes = Buffer.from(imageBase64, "base64");
        // Buffer.from silently skips junk, so a round-trip is the only real validity check.
        if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== imageBase64) {
          return fail("Нужен корректный base64 изображения JPEG/PNG (без префикса data:) не больше 5 МБ.");
        }
        const png = bytes.subarray(0, 8).equals(PNG_SIGNATURE);
        const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
        if (!png && !jpeg) {
          return fail("Поддерживаются только изображения JPEG и PNG.");
        }
        const form = new FormData();
        form.set("file", new Blob([bytes], { type: png ? "image/png" : "image/jpeg" }), png ? "image.png" : "image.jpg");
        form.set("data", JSON.stringify({ width, height }));
        const result = await client.post("v2/content/static.json", form);
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
