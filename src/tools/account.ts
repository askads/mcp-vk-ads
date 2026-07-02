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
      title: "Get account info",
      annotations: READ_ONLY,
      description:
        "Returns information about the current VK Ads account (user.json), including additional_info.client_name. Use it to confirm which advertiser account the token points at.",
      inputSchema: {
        fields: z
          .array(z.string())
          .optional()
          .describe("User fields to return. Defaults to a common set."),
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
      title: "Get account balance",
      annotations: READ_ONLY,
      description:
        "Returns the current VK Ads account balance: available funds and currency. " +
        "Calls user.json with the `account` field, which carries the wallet " +
        "(account.balance, account.currency). Reports the balance of the account the " +
        "token points at (no parameters). " +
        "Note: the exact balance field name in v3/user.json on the new ads.vk.com " +
        "platform is not confirmed against a live cabinet (the domain is JS-gated); " +
        "the schema follows the myTarget/VK Ads object model (v2/v3). This tool returns " +
        "the RAW VK response unchanged, so a caller can read account.balance defensively " +
        "regardless of the exact shape — verify on the first live account with read_payments.",
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
      title: "Get API rate limits",
      annotations: READ_ONLY,
      description:
        "Returns the current VK Ads request limits and remaining budget (throttling.json), so you can avoid hitting the rate limit.",
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
      title: "Get regions",
      annotations: READ_ONLY,
      description:
        "Lists VK Ads geo regions (id, name, type), optionally filtered by a name substring. Region ids are needed for ad group geo targeting.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Case-insensitive substring to filter region names (e.g. \"Москва\")."),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Max regions to return after filtering. Default 50."),
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
