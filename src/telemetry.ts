/**
 * Anonymous usage telemetry — fire-and-forget pings to usage.gistrec.cloud.
 *
 * Privacy contract (mirrored by the receiver): only an anonymous random
 * instance id, event/tool names, a fixed-vocabulary failure reason and
 * environment versions ever leave the machine. The API token, account data,
 * tool arguments, prompts and the names or values of environment variables are
 * never read, serialized or sent. Sends are capped at 2 s and swallow every
 * error — telemetry must never affect the server's operation.
 * Opt out for every Ask Ads MCP server at once: ASKADS_TELEMETRY=0
 * (also accepts false/off/no).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const ENDPOINT = "https://usage.gistrec.cloud/v1/events";
const APP = "mcp-vk-ads";
const SEND_TIMEOUT_MS = 2000;

export function telemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.ASKADS_TELEMETRY ?? "").trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(value);
}

/**
 * Stable anonymous installation id, persisted under the user's config dir.
 * Any filesystem failure degrades to an ephemeral id: the ping still counts
 * today's activity, just not installation uniqueness across restarts.
 */
function loadInstanceId(): string {
  try {
    const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
    const dir = join(base, APP);
    const file = join(dir, "instance-id");
    try {
      const existing = readFileSync(file, "utf8").trim();
      if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(existing)) return existing;
    } catch {
      // first run — fall through and mint one
    }
    const id = randomUUID();
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${id}\n`);
    return id;
  } catch {
    return randomUUID();
  }
}

export interface ClientInfo {
  name?: string;
  version?: string;
}

/**
 * `server_start` fires after the MCP handshake, `tool_call` per invocation and
 * `startup_failed` when the process dies on missing credentials — the only
 * signal that someone installed the server but never got a key in.
 */
export type TelemetryEvent = "server_start" | "tool_call" | "startup_failed";

/** `tool` rides with tool_call, `reason` with startup_failed. */
export interface EventFields {
  tool?: string;
  reason?: string;
}

export class Telemetry {
  private readonly instanceId: string;
  private clientInfo: ClientInfo | undefined;

  constructor(
    private readonly appVersion: string,
    private readonly enabled: boolean = telemetryEnabled(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.instanceId = enabled ? loadInstanceId() : "";
  }

  /** The MCP initialize handshake tells us which agent host is on the other side. */
  setClientInfo(info: ClientInfo | undefined): void {
    this.clientInfo = info;
  }

  /** Fire-and-forget: the server's own work never waits on a ping. */
  send(event: TelemetryEvent, fields: EventFields = {}): void {
    void this.post(event, fields);
  }

  /**
   * The same ping, awaited. Only for the startup_failed path: that caller
   * calls process.exit() immediately after, which would kill an in-flight
   * fire-and-forget request before it ever left the machine.
   */
  async sendBlocking(event: TelemetryEvent, fields: EventFields = {}): Promise<void> {
    await this.post(event, fields);
  }

  private async post(event: TelemetryEvent, fields: EventFields): Promise<void> {
    if (!this.enabled) return;
    const body = JSON.stringify({
      app: APP,
      event,
      instance_id: this.instanceId,
      app_version: this.appVersion,
      client_name: this.clientInfo?.name,
      client_version: this.clientInfo?.version,
      tool: fields.tool,
      reason: fields.reason,
      node_version: process.version,
      os: process.platform,
    });
    try {
      await this.fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch {
      // network failure, timeout abort or a synchronous throw — all silent
    }
  }
}

/**
 * Count every tool invocation by name. Wraps registerTool once, before the
 * domain modules register their tools, so no per-tool wiring is needed.
 * Only the tool *name* is recorded — arguments never reach telemetry.
 */
export function instrumentToolCalls(server: McpServer, telemetry: Telemetry): void {
  const original = server.registerTool.bind(server);
  // registerTool's generic signature does not survive a wrapper; the runtime
  // shape (name, config, callback) is stable per SDK contract.
  server.registerTool = ((name: string, config: unknown, callback: unknown) =>
    original(
      name,
      config as never,
      ((...args: unknown[]) => {
        telemetry.send("tool_call", { tool: name });
        return (callback as (...a: unknown[]) => unknown)(...args);
      }) as never,
    )) as typeof server.registerTool;
}
