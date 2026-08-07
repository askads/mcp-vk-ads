import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { instrumentToolCalls, Telemetry, telemetryEnabled } from "./telemetry.js";

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
