import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { VkAdsClient } from "../client.js";

/**
 * A date in YYYY-MM-DD form, validated before the request reaches the API.
 *
 * A factory (not a shared instance) so each `inputSchema` gets its own zod object —
 * reusing one instance makes the SDK emit a `$ref` to a shared definition in the
 * generated JSON schema, which some MCP clients don't dereference. Call `isoDate()`.
 */
export const isoDate = () =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата должна быть в формате YYYY-MM-DD");

export function ok(data: unknown): CallToolResult {
  // Compact JSON (no pretty-print) to save tokens; `?? "null"` guards against
  // JSON.stringify(undefined) returning undefined rather than a string.
  const text = typeof data === "string" ? data : JSON.stringify(data) ?? "null";
  return { content: [{ type: "text", text }] };
}

export function fail(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Ошибка: ${message}` }], isError: true };
}

/** Drops keys whose value is `undefined` so they are not sent to the API. */
export function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as T;
}

/**
 * MCP tool annotations — hints the consuming client can use to gate or label a
 * tool (e.g. auto-approve reads, warn before writes). Every tool here talks to
 * the remote VK Ads API, so openWorldHint is always true.
 *
 *   READ_ONLY    — get/list tools; never mutate the account.
 *   WRITE_CREATE — create tools; introduce new objects.
 *   WRITE_UPDATE — update tools; re-applying the same input is idempotent.
 *   WRITE_DELETE — *_action tools (can set status=deleted) and raw_request.
 */
// All four hints are set explicitly — some clients (e.g. the OpenAI Apps review)
// require destructiveHint/openWorldHint on every tool, not just the write ones.
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;
export const WRITE_CREATE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;
export const WRITE_UPDATE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;
export const WRITE_DELETE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

/** Joins a list into a comma-separated filter value, or undefined when empty. */
export function csv(values?: Array<string | number>): string | undefined {
  return values && values.length ? values.join(",") : undefined;
}

/** Lifecycle status of an ad plan / group / banner that the API lets you set. */
export const SETTABLE_STATUS = ["active", "blocked", "deleted"] as const;

/** Maps a friendly action verb to the VK Ads status it sets. */
export const ACTION_TO_STATUS = {
  activate: "active",
  stop: "blocked",
  delete: "deleted",
} as const;

export type EntityAction = keyof typeof ACTION_TO_STATUS;

/**
 * Applies a status change to many objects of one entity. VK Ads mutates a
 * single object per POST to `{entity}/{id}.json`, so this loops and reports a
 * per-id outcome, flagging the result as an error if any object failed.
 */
export async function setStatusForIds(
  client: VkAdsClient,
  entity: "ad_plans" | "ad_groups" | "banners",
  ids: number[],
  status: string,
): Promise<CallToolResult> {
  const results: Array<{ id: number; ok: boolean; error?: string }> = [];
  let failed = 0;
  for (const id of ids) {
    try {
      await client.post(`v2/${entity}/${id}.json`, { status });
      results.push({ id, ok: true });
    } catch (e) {
      failed++;
      results.push({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const body = JSON.stringify(results);
  if (failed === 0) return ok(body);
  return {
    content: [{ type: "text", text: `Не удалось изменить статус (${failed} из ${ids.length}):\n${body}` }],
    isError: true,
  };
}
