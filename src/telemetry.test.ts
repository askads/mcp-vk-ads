import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { z } from "zod";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { instrumentToolCalls, Telemetry, telemetryEnabled, DETAIL_MAX, errorDetail, noteFailure, TOOL_OUTCOMES, toolOutcome } from "./telemetry.js";
import { fail } from "./tools/util.js";

interface Sent {
  url: string;
  body: Record<string, unknown>;
}

function recordingFetch(sent: Sent[], fail = false): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    if (fail) throw new Error("network down");
    return new Response("{}", { status: 202 });
  }) as typeof fetch;
}

test("telemetryEnabled honors every opt-out spelling and defaults to on", () => {
  for (const off of ["0", "false", "off", "no", " FALSE "]) {
    assert.equal(telemetryEnabled({ ASKADS_TELEMETRY: off }), false, off);
  }
  assert.equal(telemetryEnabled({}), true);
  assert.equal(telemetryEnabled({ ASKADS_TELEMETRY: "1" }), true);
});

test("opt-out sends nothing", () => {
  const sent: Sent[] = [];
  const t = new Telemetry("1.0.0", false, recordingFetch(sent));
  t.send("server_start");
  t.send("tool_call", { tool: "get_balance" });
  assert.equal(sent.length, 0);
});

test("startup_failed carries the reason code and no client info", async () => {
  const sent: Sent[] = [];
  await new Telemetry("1.0.0", true, recordingFetch(sent)).sendBlocking("startup_failed", {
    reason: "missing_folder_id",
  });
  const [ping] = sent;
  assert.ok(ping, "the drop-off ping must be sent");
  assert.equal(ping.body.event, "startup_failed");
  assert.equal(ping.body.reason, "missing_folder_id");
  // The process died before the handshake, so there is no client to report.
  assert.equal(ping.body.client_name, undefined);
  assert.equal(ping.body.tool, undefined);
});

test("sendBlocking waits for the ping to land; send does not", async () => {
  let landed = false;
  const slowFetch = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    landed = true;
    return new Response("{}", { status: 202 });
  }) as typeof fetch;

  new Telemetry("1.0.0", true, slowFetch).send("server_start");
  assert.equal(landed, false, "send must not block its caller");

  // process.exit() follows this await — returning early would drop the ping.
  await new Telemetry("1.0.0", true, slowFetch).sendBlocking("startup_failed", {
    reason: "missing_token",
  });
  assert.equal(landed, true, "sendBlocking must not return before the request completes");
});

test("a dead endpoint still lets an unconfigured server exit", async () => {
  const sent: Sent[] = [];
  await new Telemetry("1.0.0", true, recordingFetch(sent, true)).sendBlocking("startup_failed", {
    reason: "missing_token",
  });
  assert.equal(sent.length, 1, "the failure is swallowed, not rethrown");
});

test("instance id is a uuid and stays stable across instances", () => {
  // Isolate the config dir so the test never touches the real one.
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "beacon-test-"));
  try {
    const sent: Sent[] = [];
    new Telemetry("1.0.0", true, recordingFetch(sent)).send("server_start");
    new Telemetry("1.0.0", true, recordingFetch(sent)).send("server_start");
    const [a, b] = sent.map((s) => String(s.body.instance_id));
    assert.match(a!, /^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    assert.equal(a, b, "both instances must load the same persisted id");
  } finally {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
  }
});

async function connectedPair(telemetry: Telemetry) {
  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  instrumentToolCalls(server, telemetry);
  server.registerTool(
    "echo",
    { description: "echo", inputSchema: { secret: z.string() } },
    async ({ secret }) => ({ content: [{ type: "text" as const, text: secret }] }),
  );
  server.server.oninitialized = () => {
    telemetry.setClientInfo(server.server.getClientVersion());
    telemetry.send("server_start");
  };
  const mcp = new Client({ name: "test-client", version: "9.9.9" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return mcp;
}

test("server_start carries clientInfo from the MCP handshake", async () => {
  const sent: Sent[] = [];
  await connectedPair(new Telemetry("1.0.0", true, recordingFetch(sent)));
  const start = sent.find((s) => s.body.event === "server_start");
  assert.ok(start, "server_start must be sent after initialize");
  assert.equal(start.url, "https://usage.gistrec.cloud/v1/events");
  assert.equal(start.body.client_name, "test-client");
  assert.equal(start.body.client_version, "9.9.9");
  assert.equal(start.body.app, "mcp-vk-ads");
});

test("tool_call reports the tool name and never the arguments", async () => {
  const sent: Sent[] = [];
  const mcp = await connectedPair(new Telemetry("1.0.0", true, recordingFetch(sent)));
  await mcp.callTool({ name: "echo", arguments: { secret: "hunter2" } });
  const call = sent.find((s) => s.body.event === "tool_call");
  assert.ok(call, "tool_call must be sent");
  assert.equal(call.body.tool, "echo");
  assert.ok(
    !JSON.stringify(call.body).includes("hunter2"),
    "tool arguments must never reach telemetry",
  );
});

test("a failing telemetry endpoint never breaks the tool call", async () => {
  const sent: Sent[] = [];
  const mcp = await connectedPair(new Telemetry("1.0.0", true, recordingFetch(sent, true)));
  const res = await mcp.callTool({ name: "echo", arguments: { secret: "ok" } });
  assert.equal((res as { isError?: boolean }).isError, undefined);
  assert.ok(sent.length >= 1, "telemetry was attempted");
});

// --- tool outcome ------------------------------------------------------------

const errorResult = (text: string) => ({ isError: true, content: [{ type: "text" as const, text }] });

test("toolOutcome: success is ok, isError is classified from the text", () => {
  assert.equal(toolOutcome({ content: [{ type: "text", text: "invalid but fine" }] }), "ok");
  const cases: [string, string][] = [
    ["Ошибка: [53] Ошибка авторизации: Недействительный OAuth-токен", "error_auth"],
    ["HTTP 401 Unauthorized", "error_auth"],
    ["Ошибка: [3228] Нет доступа к методу", "error_permission"],
    ["HTTP 403 access_denied: Access Denied", "error_permission"],
    ["HTTP 404 Not Found", "error_not_found"],
    ["Ошибка: [56] Превышен лимит запросов метода", "error_rate_limit"],
    ["HTTP 429 Too Many Requests", "error_rate_limit"],
    ["Ошибка: [8000] Некорректный запрос: Элемент массива FieldNames", "error_invalid_request"],
    ["HTTP 400 invalid_parameter: Incorrectly specified metric", "error_invalid_request"],
    ["HTTP 503 Service Unavailable", "error_upstream"],
    ["Запрос превысил таймаут 30 с", "error_timeout"],
    ["TypeError: fetch failed (ECONNRESET)", "error_network"],
    ["что-то пошло не так", "error_other"],
  ];
  for (const [text, expected] of cases) assert.equal(toolOutcome(errorResult(text)), expected, text);
});

test("toolOutcome: a thrown error is classified, unknown ones are error_internal", () => {
  assert.equal(toolOutcome(undefined, new Error("HTTP 401")), "error_auth");
  assert.equal(toolOutcome(undefined, new TypeError("x is undefined")), "error_internal");
  assert.equal(toolOutcome(undefined, "not even an Error"), "error_internal");
});

test("toolOutcome only ever returns a TOOL_OUTCOMES constant", () => {
  const junk = ["", "a".repeat(10_000), "user@example.com 79991234567", "[53]", "\u0000", "HTTP 418"];
  for (const text of junk) {
    assert.ok((TOOL_OUTCOMES as readonly string[]).includes(toolOutcome(errorResult(text))), text);
    assert.ok((TOOL_OUTCOMES as readonly string[]).includes(toolOutcome(undefined, new Error(text))), text);
  }
  assert.equal(toolOutcome({ isError: true }), "error_other");
  assert.equal(toolOutcome({ isError: true, content: "not an array" }), "error_other");
});

test("tool_call carries the outcome and never the error text", async () => {
  const sent: Sent[] = [];
  const telemetry = new Telemetry("1.0.0", true, recordingFetch(sent));
  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  instrumentToolCalls(server, telemetry);
  server.registerTool("leaky", { description: "leaky", inputSchema: { secret: z.string() } }, async ({ secret }) =>
    errorResult(`HTTP 403 нет доступа к кабинету ${secret} (user@example.com)`),
  );
  server.registerTool("boom", { description: "boom", inputSchema: {} }, async () => {
    throw new Error("HTTP 401 token for user@example.com expired");
  });
  const mcp = new Client({ name: "test-client", version: "9.9.9" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);

  const res = await mcp.callTool({ name: "leaky", arguments: { secret: "hunter2" } });
  assert.equal((res as { isError?: boolean }).isError, true, "the result itself is untouched");
  await mcp.callTool({ name: "boom", arguments: {} });

  const calls = sent.filter((s) => s.body.event === "tool_call");
  assert.deepEqual(
    calls.map((c) => [c.body.tool, c.body.reason]),
    [
      ["leaky", "error_permission"],
      ["boom", "error_auth"],
    ],
  );
  const wire = JSON.stringify(calls.map((c) => c.body));
  for (const leak of ["hunter2", "user@example.com", "кабинет", "expired"]) {
    assert.ok(!wire.includes(leak), `${leak} must never reach telemetry`);
  }
});

test("a successful call reports ok", async () => {
  const sent: Sent[] = [];
  const mcp = await connectedPair(new Telemetry("1.0.0", true, recordingFetch(sent)));
  await mcp.callTool({ name: "echo", arguments: { secret: "x" } });
  assert.equal(sent.find((s) => s.body.event === "tool_call")?.body.reason, "ok");
});

test("a tool_call reason outside TOOL_OUTCOMES never leaves the machine", () => {
  const sent: Sent[] = [];
  const t = new Telemetry("1.0.0", true, recordingFetch(sent));
  t.send("tool_call", { tool: "x", reason: "error_user_ivanov" as never });
  t.send("tool_call", { tool: "x", reason: "error_auth" });
  assert.deepEqual(
    sent.map((s) => s.body.reason),
    [undefined, "error_auth"],
  );
});

test("toolOutcome: throw undefined is an error, not ok", () => {
  assert.equal(toolOutcome(undefined, undefined), "error_internal");
});

test("Direct's 'no access to this client' is a permission outcome, not auth", () => {
  assert.equal(
    toolOutcome(errorResult("Ошибка: [53] Ошибка авторизации: у токена нет доступа к кабинету «x» через Client-Login")),
    "error_permission",
  );
});

test("an API code at the head beats words quoted in the text", () => {
  // Real clients.get answer: the allowed values include ForbiddenPlatform.
  const text =
    "[8000] Некорректный запрос: Элемент массива FieldNames содержит неверное значение перечисления, ожидается одно из значений: AccountQuality, Archived, ClientId, ClientInfo, CountryId, CreatedAt, Currency, Grants, Bonuses, Login, Notification, OverdraftSumAvailable, Phone, Representatives, Restrictions, Settings, Type, Subtype, VatRate, ManagedLogins, ForbiddenPlatform, AvailableCampaignTypes, AvailableAdGroupTypes, ProductMode (request_id: 4573631628979678599)";
  assert.equal(toolOutcome(errorResult(`Ошибка: ${text}`)), "error_invalid_request");
  const thrown = new Error(text);
  thrown.name = "YandexDirectError";
  assert.equal(toolOutcome(undefined, thrown), "error_invalid_request");
  assert.equal(toolOutcome(errorResult('Ошибка: Ошибка Live v4 "GetBalance": [54] Нет прав, timed out')), "error_permission");
  // 53 stays with the text; a code past the head still counts through the patterns.
  assert.equal(toolOutcome(errorResult("Ошибка: [53] Ошибка авторизации: Недействительный OAuth-токен")), "error_auth");
  assert.equal(toolOutcome(errorResult(`Ошибка: ${"x".repeat(80)} отвечает [56]`)), "error_rate_limit");
});

test("telemetry never changes what the tool returns or throws", async () => {
  const sent: Sent[] = [];
  const telemetry = new Telemetry("1.0.0", true, recordingFetch(sent));
  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  instrumentToolCalls(server, telemetry);
  let reads = 0;
  const hostile = {
    content: [{ type: "text" as const, text: "fine" }],
    get isError(): boolean {
      // The classifier reads first (before the result goes back to the SDK): that read blows up.
      if (++reads === 1) throw new Error("getter boom");
      return false;
    },
  };
  server.registerTool("hostile", { description: "h", inputSchema: {} }, async () => hostile as never);
  const original = new Error("tool's own error");
  Object.defineProperty(original, "name", { get: () => { throw new Error("name boom"); } });
  server.registerTool("throws", { description: "t", inputSchema: {} }, async () => {
    throw original;
  });
  const mcp = new Client({ name: "test-client", version: "9.9.9" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);

  const res = await mcp.callTool({ name: "hostile", arguments: {} });
  assert.equal((res as { content: { text: string }[] }).content[0].text, "fine");
  const thrown = await mcp.callTool({ name: "throws", arguments: {} });
  assert.match(JSON.stringify(thrown), /tool's own error/);
  assert.ok(!JSON.stringify(thrown).includes("boom"), "the classifier's failure must not replace the tool's error");
});

test("with telemetry off the result is not inspected at all", async () => {
  const telemetry = new Telemetry("1.0.0", false, recordingFetch([]));
  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  instrumentToolCalls(server, telemetry);
  let reads = 0;
  server.registerTool("probe", { description: "p", inputSchema: {} }, async () => ({
    content: [{ type: "text" as const, text: "x" }],
    get isError() {
      reads++;
      return false;
    },
  }) as never);
  const mcp = new Client({ name: "test-client", version: "9.9.9" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  const before = reads;
  await mcp.callTool({ name: "probe", arguments: {} });
  assert.ok(reads - before <= 1, "only the SDK itself may read the result");
});

// --- error excerpt (same cases as the Ask Ads gateway's _error_detail) ----------

const DETAIL_CASES: [string, string, string[]][] = [
  [
    "Ошибка: [53] Authorization error: Invalid OAuth token for boss@yandex.ru (request_id: 1234567890)",
    "code=53 Authorization error: Invalid OAuth token for #",
    ["boss@yandex.ru", "1234567890"],
  ],
  [
    "Ошибка: [8800] No rights: Client-Login: agency-client, campaign 12345678",
    "code=8800 No rights: Client-Login: #, campaign #",
    ["agency-client", "12345678"],
  ],
  [
    'Запрос отчёта завершился ошибкой (HTTP 400): {"error": {"request_id": "1234567890", "error_code": 4000, "error_string": "Invalid request", "error_detail": "Field Clicks not allowed for campaign 12345678"}}',
    "HTTP 400; code=4000; error_string=Invalid request; error_detail=Field Clicks not allowed for campaign #",
    ["1234567890", "12345678"],
  ],
  ['Ошибка: API Яндекс Директа недоступен: на запрос "campaigns" сервер ответил HTTP 204', "HTTP 204", []],
  ["HTTP 403: access_denied: Access to counter 98765432 denied", "HTTP 403 access_denied: Access to counter # denied", ["98765432"]],
  [
    "HTTP 403: [HOST_NOT_VERIFIED] Host https://shop.example.com:443 is not verified (see api.webmaster.yandex.net)",
    "HTTP 403; HOST_NOT_VERIFIED Host # is not verified",
    ["example.com", "yandex.net"],
  ],
  [
    'Request to "GET /user/1234567/hosts/https%3Aclient.example.com%3A443/summary" timed out after 60000ms',
    "timed out",
    ["1234567", "client.example.com"],
  ],
  [
    "TypeError: fetch failed: Error: read ECONNRESET at TCP.onStreamRead (node:internal/stream_base_commons:218:20)",
    "fetch failed; econnreset",
    [],
  ],
  ["Пользователь boss@yandex.ru, кампания 12345678, сайт shop.xn--p1ai, token=y0_abcdefghij", "", ["boss", "12345678", "p1ai", "y0_"]],
  ["Ошибка: [53] Auth error; HTTP 401: token y0_abcdefghij expired; [53] Auth error", "code=53 Auth error; HTTP 401 token # expired", ["y0_"]],
  ['{"message":"password=hunter2", "user_ids": [12345], "campaign_ids": [8800]}', "message=password=#", ["hunter2", "12345", "8800"]],
  ["HTTP 500: Authorization: Bearer sk-live-abcdef failed", "HTTP 500 Authorization: #", ["sk-live"]],
  ["HTTP 500: Authorization: Bearer y0_" + "Q".repeat(50) + ", retry", "HTTP 500 Authorization: #, retry", ["QQQQ"]],
  [
    "HTTP 429: call +7 999 123-45-67 from 10.20.30.40 at 12:30, api_key: sk-123",
    "HTTP 429 call # from # at 12:30, api_key: #",
    ["999", "10.20", "sk-123"],
  ],
  ["Запрос превысил таймаут 30 с", "превысил таймаут", []],
  ["[lowercase] tag is not a tag", "", []],
];

test("errorDetail keeps only allowlisted fragments and masks what is inside them", () => {
  for (const [text, expected, absent] of DETAIL_CASES) {
    const detail = errorDetail(text);
    assert.equal(detail, expected, text);
    for (const secret of absent) assert.ok(!detail.includes(secret), `${secret} leaked from: ${text}`);
  }
});

test("errorDetail collapses whitespace and truncates", () => {
  const detail = errorDetail("HTTP 500:\n  " + "слово ".repeat(60) + "\t[TAG_ONE] x" + " y".repeat(200));
  assert.ok(!detail.includes("\n") && !detail.includes("  "));
  assert.ok(detail.length <= DETAIL_MAX);
});

test("a failed tool_call carries the masked excerpt, a successful one none", async () => {
  const sent: Sent[] = [];
  const telemetry = new Telemetry("1.0.0", true, recordingFetch(sent));
  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  instrumentToolCalls(server, telemetry);
  server.registerTool("bad", { description: "b", inputSchema: { secret: z.string() } }, async ({ secret }) =>
    errorResult(`Ошибка: [8000] Некорректный запрос для ${secret}@example.com, кампания 12345678`),
  );
  server.registerTool("good", { description: "g", inputSchema: {} }, async () => ({
    content: [{ type: "text" as const, text: "HTTP 500 in a successful body" }],
  }));
  const mcp = new Client({ name: "test-client", version: "9.9.9" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  await mcp.callTool({ name: "bad", arguments: { secret: "hunter2" } });
  await mcp.callTool({ name: "good", arguments: {} });
  const calls = sent.filter((s) => s.body.event === "tool_call");
  assert.equal(calls[0].body.error_detail, "code=8000 Некорректный запрос для #, кампания #");
  assert.equal(calls[1].body.error_detail, undefined);
  assert.ok(!JSON.stringify(calls).includes("hunter2"));
});

// --- excerpt: quoted text, full fragments, our own refusals and JS bugs ------------------

test("errorDetail masks quoted text — names of sheets, files, campaigns", () => {
  const detail = errorDetail("HTTP 400: [INVALID_ARGUMENT] Invalid range for sheet 'Зарплаты Q3' in «Бюджет 2026» and \"Отчёт\"");
  for (const leak of ["Зарплаты", "Бюджет", "Отчёт"]) assert.ok(!detail.includes(leak), detail);
  assert.ok(errorDetail("HTTP 400: This attribute can't be a dimension, value: VisitID").includes("can't be a dimension"));
});

test("errorDetail keeps the fragment up to 200 chars, not cut mid-sentence at 100", () => {
  const detail = errorDetail(
    "Ошибка: HTTP 400: invalid_parameter: Metrics and dimensions with different prefixes can be used together only when filtering data, value: ym:pv:URLPath is incompatible with ym:s:visits, error code: 4011",
  );
  assert.match(detail, /ym:pv:URLPath is incompatible/);
});

async function pairWith(register: (server: McpServer) => void) {
  const sent: Sent[] = [];
  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  instrumentToolCalls(server, new Telemetry("1.0.0", true, recordingFetch(sent)));
  register(server);
  const mcp = new Client({ name: "test-client", version: "9.9.9" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { mcp, sent };
}

const failLike = (err: unknown) =>
  noteFailure({ isError: true, content: [{ type: "text" as const, text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] }, err);

test("our own refusal arrives as local: with masked text and a request outcome", async () => {
  const { mcp, sent } = await pairWith((server) =>
    server.registerTool("refuse", { description: "r", inputSchema: {} }, async () =>
      failLike("Нужен хотя бы один фильтр: campaignIds для «Кампания Иванова», лимит 12345"),
    ),
  );
  const res = await mcp.callTool({ name: "refuse", arguments: {} });
  assert.match(JSON.stringify(res), /Кампания Иванова/, "the client still gets the full text");
  const call = sent.find((s) => s.body.event === "tool_call")!;
  assert.equal(call.body.reason, "error_invalid_request");
  assert.equal(call.body.error_detail, "local: Нужен хотя бы один фильтр: campaignIds для #, лимит #");
});

test("a JS bug caught by fail() arrives as error_internal with its type and first line", async () => {
  const { mcp, sent } = await pairWith((server) =>
    server.registerTool("bug", { description: "b", inputSchema: {} }, async () => {
      try {
        (undefined as unknown as { Campaigns: unknown }).Campaigns;
        return { content: [] };
      } catch (e) {
        return failLike(e);
      }
    }),
  );
  await mcp.callTool({ name: "bug", arguments: {} });
  const call = sent.find((s) => s.body.event === "tool_call")!;
  assert.equal(call.body.reason, "error_internal");
  assert.match(String(call.body.error_detail), /^internal: TypeError: .*Campaigns/);
});

test("a thrown JS bug is reported the same way", async () => {
  const { mcp, sent } = await pairWith((server) =>
    server.registerTool("throws", { description: "t", inputSchema: {} }, async () => {
      throw new RangeError("Invalid array length\n    at secret/path.ts:1");
    }),
  );
  await mcp.callTool({ name: "throws", arguments: {} });
  const call = sent.find((s) => s.body.event === "tool_call")!;
  assert.equal(call.body.error_detail, "internal: RangeError: Invalid array length");
});

const fetchFailed = (code: unknown, message: string) =>
  new TypeError("fetch failed", { cause: Object.assign(new Error(message), { code }) });

test("a failed fetch caught by fail() is a network error, not a bug, and hides the host", async () => {
  const { mcp, sent } = await pairWith((server) =>
    server.registerTool("net", { description: "n", inputSchema: {} }, async () =>
      fail(fetchFailed("ECONNRESET", "read ECONNRESET api.webmaster.yandex.net 10.1.2.3:443")),
    ),
  );
  await mcp.callTool({ name: "net", arguments: {} });
  const call = sent.find((s) => s.body.event === "tool_call")!;
  assert.equal(call.body.reason, "error_network");
  assert.equal(call.body.error_detail, "fetch failed; econnreset");
});

test("a thrown failed fetch with a timeout cause is error_timeout", async () => {
  const { mcp, sent } = await pairWith((server) =>
    server.registerTool("slow", { description: "s", inputSchema: {} }, async () => {
      throw fetchFailed("UND_ERR_CONNECT_TIMEOUT", "Connect Timeout Error (attempted address: example.com:443)");
    }),
  );
  await mcp.callTool({ name: "slow", arguments: {} });
  const call = sent.find((s) => s.body.event === "tool_call")!;
  assert.equal(call.body.reason, "error_timeout");
  assert.equal(call.body.error_detail, "fetch failed; und_err_connect_timeout");
});

test("a real refused fetch is classified by its cause code", async () => {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  const { mcp, sent } = await pairWith((server) =>
    server.registerTool("refused", { description: "r", inputSchema: {} }, async () => {
      try {
        await fetch(`http://127.0.0.1:${port}/`);
        return { content: [] };
      } catch (e) {
        return fail(e);
      }
    }),
  );
  await mcp.callTool({ name: "refused", arguments: {} });
  const call = sent.find((s) => s.body.event === "tool_call")!;
  assert.equal(call.body.reason, "error_network");
  assert.equal(call.body.error_detail, "fetch failed; econnrefused");
});

test("only fetch's own TypeError is a network error; other TypeErrors stay internal", async () => {
  for (const [err, detail] of [
    [new TypeError("fetch failed"), "internal: TypeError: fetch failed"],
    [new TypeError("x is not a function", { cause: { code: "ECONNRESET" } }), "internal: TypeError: x is not a function"],
  ] as const) {
    const { mcp, sent } = await pairWith((server) =>
      server.registerTool("bug", { description: "b", inputSchema: {} }, async () => fail(err)),
    );
    await mcp.callTool({ name: "bug", arguments: {} });
    const call = sent.find((s) => s.body.event === "tool_call")!;
    assert.equal(call.body.reason, "error_internal");
    assert.equal(call.body.error_detail, detail);
  }
  const { mcp, sent } = await pairWith((server) =>
    server.registerTool("net", { description: "n", inputSchema: {} }, async () =>
      fail(fetchFailed("getaddrinfo api.example.com", "getaddrinfo ENOTFOUND api.example.com")),
    ),
  );
  await mcp.callTool({ name: "net", arguments: {} });
  const call = sent.find((s) => s.body.event === "tool_call")!;
  assert.equal(call.body.reason, "error_network");
  assert.equal(call.body.error_detail, "fetch failed", "a code that is not a constant is dropped");
});

test("noteFailure returns the very same result object and adds nothing to it", () => {
  const result = { isError: true, content: [{ type: "text" as const, text: "x" }] };
  const before = JSON.stringify(result);
  assert.equal(noteFailure(result, "x"), result);
  assert.equal(JSON.stringify(result), before);
  assert.deepEqual(Object.keys(result), ["isError", "content"]);
});

test("errorDetail masks bare tokens and stays fast on huge echoed input", () => {
  for (const [text, leak] of [
    ["HTTP 401: invalid OAuth token vk_live_ABCdefGHIjkl", "vk_live"],
    ["HTTP 401: token AQVNabcdefghijkl expired", "AQVN"],
    ["HTTP 500: key sk-live-abcdef rejected", "sk-live"],
    ["HTTP 400: bad id a1b2c3d4e5f6g7h8i9j0k1l2", "a1b2c3d4e5"],
  ] as const) {
    assert.ok(!errorDetail(text).includes(leak), `${leak}: ${errorDetail(text)}`);
  }
  const started = Date.now();
  errorDetail("HTTP 400: " + "a".repeat(200_000) + "@x");
  errorDetail("x".repeat(200_000));
  assert.ok(Date.now() - started < 200, "regexes must not go quadratic");
});

test("a huge argument echoed in our own refusal does not stall the call", async () => {
  const { mcp, sent } = await pairWith((server) =>
    server.registerTool("refuse", { description: "r", inputSchema: {} }, async () =>
      failLike(`${"a".repeat(200_000)}goal#: вместо # нужен идентификатор цели`),
    ),
  );
  const started = Date.now();
  await mcp.callTool({ name: "refuse", arguments: {} });
  assert.ok(Date.now() - started < 500);
  assert.ok(String(sent.find((s) => s.body.event === "tool_call")!.body.error_detail).length <= DETAIL_MAX);
});

test("errorDetail masks long quotes and any value after a secret key", () => {
  for (const [text, leak] of [
    [`HTTP 400: unknown method '${"PRIVATECONTENT".repeat(30)}'`, "PRIVATECONTENT"],
    [`HTTP 400: unknown method '${"PRIVATECONTENT".repeat(30)}`, "PRIVATECONTENT"],
    ["HTTP 401: Api-Key SECRETKEY invalid", "SECRETKEY"],
    ["HTTP 401: token abcdefghijklmnopqrstuvwxyz expired", "abcdefghij"],
  ] as const) {
    assert.ok(!errorDetail(text).includes(leak), errorDetail(text));
  }
  assert.equal(errorDetail("HTTP 401: token expired"), "HTTP 401 token expired");
});

// --- this server's own error classes: class name when the allowlist finds nothing --------

class OwnError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

test("our own error class without an allowlisted fragment sends its class name only", async () => {
  const { mcp, sent } = await pairWith((server) => {
    server.registerTool("auth", { description: "a", inputSchema: {} }, async () =>
      failLike(new OwnError("AuthRequiredError", "Не настроено подключение для Иван Иванов")),
    );
    server.registerTool("down", { description: "d", inputSchema: {} }, async () => {
      throw new OwnError("DirectUnavailableError", "API недоступен для кампании SummerSale");
    });
  });
  await mcp.callTool({ name: "auth", arguments: {} });
  await mcp.callTool({ name: "down", arguments: {} });
  const [auth, down] = sent.filter((s) => s.body.event === "tool_call");
  assert.equal(auth.body.reason, "error_auth");
  assert.equal(auth.body.error_detail, "AuthRequiredError");
  assert.equal(down.body.reason, "error_upstream");
  assert.equal(down.body.error_detail, "DirectUnavailableError");
  assert.ok(!JSON.stringify(sent).includes("Иван") && !JSON.stringify(sent).includes("SummerSale"));
});

test("a plain Error or a system error with user data sends no text at all", async () => {
  const { mcp, sent } = await pairWith((server) => {
    server.registerTool("plain", { description: "p", inputSchema: {} }, async () =>
      failLike(new Error("Клиент Иван Иванов, кампания SummerSale")),
    );
    server.registerTool("fs", { description: "f", inputSchema: {} }, async () => {
      throw Object.assign(new Error("ENOENT: no such file or directory, open '/tmp/Иван's паспорт'"), {
        code: "ENOENT", errno: -2, syscall: "open",
      });
    });
  });
  await mcp.callTool({ name: "plain", arguments: {} });
  await mcp.callTool({ name: "fs", arguments: {} });
  const calls = sent.filter((s) => s.body.event === "tool_call");
  assert.deepEqual(calls.map((c) => c.body.error_detail), [undefined, undefined]);
  assert.ok(!JSON.stringify(sent).includes("Иван"));
});

test("an allowlisted fragment still wins over the error class", async () => {
  const { mcp, sent } = await pairWith((server) =>
    server.registerTool("api", { description: "a", inputSchema: {} }, async () =>
      failLike(new OwnError("YandexDirectError", "[53] Ошибка авторизации: Недействительный OAuth-токен")),
    ),
  );
  await mcp.callTool({ name: "api", arguments: {} });
  const call = sent.find((s) => s.body.event === "tool_call")!;
  assert.equal(call.body.error_detail, "code=53 Ошибка авторизации: Недействительный OAuth-токен");
});
