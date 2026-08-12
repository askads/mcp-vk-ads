import { test } from "node:test";
import assert from "node:assert/strict";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { VkAdsClient } from "../client.js";
import { ACTION_TO_STATUS, compact, csv, fail, ok, setStatusForIds } from "./util.js";

function text(result: CallToolResult): string {
  return (result.content[0] as { text: string }).text;
}

test("compact drops only undefined values", () => {
  assert.deepEqual(compact({ a: 1, b: undefined, c: 0, d: "" }), { a: 1, c: 0, d: "" });
});

test("csv joins non-empty arrays and returns undefined otherwise", () => {
  assert.equal(csv([1, 2, 3]), "1,2,3");
  assert.equal(csv(["active", "blocked"]), "active,blocked");
  assert.equal(csv([]), undefined);
  assert.equal(csv(undefined), undefined);
});

test("ACTION_TO_STATUS maps verbs to VK Ads statuses", () => {
  assert.equal(ACTION_TO_STATUS.activate, "active");
  assert.equal(ACTION_TO_STATUS.stop, "blocked");
  assert.equal(ACTION_TO_STATUS.delete, "deleted");
});

test("ok serializes objects as compact JSON and passes strings through", () => {
  assert.equal(text(ok("hi")), "hi");
  assert.equal(text(ok({ a: 1 })), JSON.stringify({ a: 1 })); // compact, no pretty-print
  assert.equal(text(ok({ a: 1, b: 2 })), '{"a":1,"b":2}');
  assert.equal(ok("x").isError, undefined);
});

test("ok emits the string \"null\" when JSON.stringify yields undefined", () => {
  // JSON.stringify(undefined) === undefined, which would break the content text.
  assert.equal(text(ok(undefined)), "null");
});

test("fail marks the result as an error and keeps the message", () => {
  const result = fail(new Error("boom"));
  assert.equal(result.isError, true);
  assert.match(text(result), /Ошибка: boom/);
});

test("setStatusForIds posts the status per id and reports success", async () => {
  const calls: Array<[string, unknown]> = [];
  const client = {
    post: async (path: string, body: unknown) => {
      calls.push([path, body]);
      return {};
    },
  } as unknown as VkAdsClient;

  const result = await setStatusForIds(client, "ad_plans", [1, 2], "blocked");

  assert.equal(result.isError, undefined);
  assert.deepEqual(calls, [
    ["v2/ad_plans/1.json", { status: "blocked" }],
    ["v2/ad_plans/2.json", { status: "blocked" }],
  ]);
});

test("setStatusForIds flags partial failures as an error", async () => {
  const client = {
    post: async (path: string) => {
      if (path.includes("/2.json")) throw new Error("nope");
      return {};
    },
  } as unknown as VkAdsClient;

  const result = await setStatusForIds(client, "banners", [1, 2, 3], "deleted");

  assert.equal(result.isError, true);
  assert.match(text(result), /Не удалось изменить статус \(1 из 3\)/);
});
