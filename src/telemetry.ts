/**
 * Anonymous usage telemetry — fire-and-forget pings to usage.gistrec.cloud.
 *
 * Privacy contract (mirrored by the receiver): only an anonymous random
 * instance id, event/tool names, a fixed-vocabulary failure reason or tool outcome and
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
 * `server_start` fires after the MCP handshake and `tool_call` per invocation.
 * `startup_failed` is left for the case where the process still dies before the
 * handshake (a malformed setting); `unconfigured_start` is its live counterpart —
 * a server that starts without a token, so the user can connect from the chat.
 * Keeping them apart is the point: `server_start` must keep meaning "a usable
 * install started", or the unconfigured funnel inflates it.
 */
export type TelemetryEvent =
  | "server_start"
  | "tool_call"
  | "startup_failed"
  | "unconfigured_start";

/** `tool` and `error_detail` ride with tool_call; `reason` with tool_call and startup_failed/unconfigured_start. */
export interface EventFields {
  tool?: string;
  reason?: string;
  error_detail?: string;
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

  isEnabled(): boolean {
    return this.enabled;
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
      reason: wireReason(event, fields.reason),
      error_detail: event === "tool_call" ? fields.error_detail : undefined,
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

/** How a tool call ended; only these constants leave the machine. */
export const TOOL_OUTCOMES = [
  "ok",
  "error_auth",
  "error_permission",
  "error_not_found",
  "error_rate_limit",
  "error_invalid_request",
  "error_upstream",
  "error_timeout",
  "error_network",
  "error_internal",
  "error_other",
] as const;
export type ToolOutcome = (typeof TOOL_OUTCOMES)[number];

/** Drops a tool_call reason that is not in TOOL_OUTCOMES. */
function wireReason(event: TelemetryEvent, reason: string | undefined): string | undefined {
  if (event !== "tool_call" || reason === undefined) return reason;
  return (TOOL_OUTCOMES as readonly string[]).includes(reason) ? reason : undefined;
}

// First match wins. Direct answers "no access to this client" with auth code 53, so that
// permission line goes before auth.
const OUTCOME_PATTERNS: ReadonlyArray<readonly [ToolOutcome, RegExp]> = [
  ["error_timeout", /timed?[ _-]?out|таймаут|ETIMEDOUT|AbortError|не был готов|not ready/i],
  ["error_network", /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|fetch failed|socket hang up/i],
  ["error_rate_limit", /\b429\b|rate[ _-]?limit|too many requests|quota|квот|лимит|\[(?:56|152|506|9000)\]/i],
  ["error_permission", /нет доступа к кабинету|не подключ[её]н к аккаунту/i],
  [
    "error_auth",
    /\b401\b|unauthori[sz]ed|unauthenticated|invalid[ _-]?(?:token|grant|credentials)|token (?:expired|revoked)|login required|AuthRequired|авториз|не подключ|\[53\]/i,
  ],
  ["error_permission", /\b403\b|forbidden|access[ _-]?denied|permission|insufficient[ _-]?scope|нет доступа|\[(?:54|3228)\]/i],
  ["error_not_found", /\b404\b|not[ _-]?found|не найден|не существует|\[8800\]/i],
  ["error_upstream", /\b5\d\d\b|\b204\b|unavailable|недоступ|internal server error|bad gateway|\[(?:52|1000|1001|1002)\]/i],
  ["error_invalid_request", /\b400\b|\b422\b|bad request|invalid|syntax|некоррект|неверн|недопустим|required|обязател|expected|must (?:be|contain|have)|\[(?:4000|4001|4003|5000|8000)\]/i],
];

// An API code at the head of the message wins over the text, which may quote field names
// ("ForbiddenPlatform" in a [8000] list of allowed values). 53 is absent: the text tells a
// dead token from no access to a client.
const CODE_OUTCOMES = new Map<string, ToolOutcome>([
  ...["56", "152", "506", "9000"].map((c) => [c, "error_rate_limit"] as const),
  ...["54", "3228"].map((c) => [c, "error_permission"] as const),
  ["8800", "error_not_found"],
  ...["52", "1000", "1001", "1002"].map((c) => [c, "error_upstream"] as const),
  ...["4000", "4001", "4003", "5000", "8000"].map((c) => [c, "error_invalid_request"] as const),
]);
const LEADING_CODE = /^[^[\n]{0,60}\[(\d{1,5})\]/;

// Inputs are cut before any regex runs: a long argument echoed in an error must not stall the call.
const TEXT_MAX = 4000;

function resultText(value: unknown): string {
  if (value instanceof Error) return `${value.name} ${value.message}`.slice(0, TEXT_MAX);
  const content = (value as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && typeof part.text === "string" ? part.text : ""))
    .join("\n")
    .slice(0, TEXT_MAX);
}

/** `toolOutcome(result)` for a returned result, `toolOutcome(undefined, error)` for a thrown one. */
export function toolOutcome(result: unknown, ...thrown: [unknown?]): ToolOutcome {
  const didThrow = thrown.length > 0;
  if (!didThrow && !(result as { isError?: unknown } | null)?.isError) return "ok";
  const text = resultText(didThrow ? thrown[0] : result);
  const byCode = CODE_OUTCOMES.get(LEADING_CODE.exec(text)?.[1] ?? "");
  if (byCode) return byCode;
  for (const [outcome, pattern] of OUTCOME_PATTERNS) if (pattern.test(text)) return outcome;
  return didThrow ? "error_internal" : "error_other";
}

/** Error excerpt: allowlisted fragments of the error text, masked (port of the Ask Ads gateway's). */
export const DETAIL_MAX = 200;
const PICK =
  /\bHTTP (?<http>\d{3})\b(?::\s*(?<htext>[^{[]{1,200}))?|^(?:Ошибка: )?\[(?<bcode>\d{1,5})\]\s*(?<btext>[^;(]{1,200})|\[(?<tag>[A-Za-z][A-Za-z_]{2,})\]\s*(?<ttext>[^;(]{0,200})|\berror_code["']?\s*[:=]\s*["']?(?<code>\d{1,5})\b|\b(?<key>error_string|error_detail|error_type|message)["']?\s*[:=]\s*["']?(?<value>[^"'}\]]{1,80})|\b(?<net>ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|timed out|fetch failed|socket hang up|connection closed)\b|(?<netru>превысил таймаут)/gi;
const SCRUB =
  /(?<key>(?:login|password|secret|token|api[_-]?key|authorization)\s*[:=]\s*["']?|(?:bearer|basic)\s+)(?<val>[^,;]+)|[^\s,;]*(?:@|:\/\/|%3A|\p{L}\.\p{L})[^\s,;]*|(?<key2>\b(?:token|secret|password|api[_-]?key|access_token|refresh_token|client_secret)\s+)(?!(?:expired|invalid|is|was|for|has|not|missing|required|revoked|provided|type)\b)\S+|\b(?:y0_|AQAA|AQVN|t1\.|sk-|vk1\.|vk_|ghp_|ya29\.)\S+|\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{20,}\b|\+?\d(?:[\s().-]*\d){3,}/giu;
const QUOTED = /(?<!\p{L})'[^'\n]+(?:'(?!\p{L})|$)|"[^"\n]+(?:"|$)|«[^»]+(?:»|$)/gu;

function scrub(value: string, quoted = true): string {
  return (quoted ? value.replace(QUOTED, "#") : value)
    .replace(SCRUB, (...args) => {
      const groups = args[args.length - 1] as { key?: string; key2?: string };
      return (groups.key ?? groups.key2 ?? "") + "#";
    })
    .replace(/^[ ;:,.]+|[ ;:,.]+$/g, "");
}

export function errorDetail(text: string): string {
  const flat = text.slice(0, 2000).split(/\s+/).filter(Boolean).join(" ");
  const parts: string[] = [];
  PICK.lastIndex = 0;
  for (let m = PICK.exec(flat); m; m = PICK.exec(flat)) {
    const g = m.groups ?? {};
    let token: string;
    if (g.http) token = `HTTP ${g.http} ${scrub(g.htext ?? "")}`;
    else if (g.bcode) token = `code=${g.bcode} ${scrub(g.btext ?? "")}`;
    else if (g.tag) {
      // Tags are upper-case only; the rest of PICK is case-insensitive.
      if (!/^[A-Z][A-Z_]{2,}$/.test(g.tag)) {
        PICK.lastIndex = m.index + 1;
        continue;
      }
      token = `${g.tag} ${scrub(g.ttext ?? "")}`;
    } else if (g.code) token = `code=${g.code}`;
    else if (g.key) token = `${g.key.toLowerCase()}=${scrub(g.value ?? "")}`;
    else token = (g.net ?? g.netru ?? "").toLowerCase();
    token = token.trim();
    if (!parts.includes(token)) parts.push(token);
  }
  return parts.join("; ").slice(0, DETAIL_MAX);
}

type NetworkFailure = { reason: ToolOutcome; text: string };

/** Set by fail(), never serialized: our own refusal ("local"), a bug in our code ("internal") or a failed fetch ("network"). */
const FAILURE_ORIGIN = new WeakMap<
  object,
  { origin: "local" | "internal" | "error"; text: string } | ({ origin: "network" } & NetworkFailure)
>();
const JS_ERRORS = new Set(["TypeError", "ReferenceError", "RangeError", "SyntaxError", "EvalError", "URIError"]);

function jsBug(err: unknown): string | undefined {
  return err instanceof Error && JS_ERRORS.has(err.name) ? `${err.name}: ${err.message.split("\n")[0]}` : undefined;
}

/**
 * Only the class name of this server's own errors (AuthRequiredError, AbortError), used when the
 * allowlist finds nothing. Never the message: a plain Error or a system error (ENOENT …) can carry
 * user data, so those send nothing.
 */
function errorText(err: unknown): string | undefined {
  if (!(err instanceof Error) || "errno" in err || "syscall" in err) return undefined;
  return /^[A-Z][A-Za-z0-9]*(?:Error|Exception)$/.test(err.name) && err.name !== "Error" ? err.name : undefined;
}

/**
 * Node's fetch rejects a network failure as TypeError("fetch failed") with the socket/DNS/TLS error
 * in `cause`. Only cause.code leaves the machine: cause.message names hosts and addresses.
 */
function fetchFailure(err: unknown): NetworkFailure | undefined {
  if (!(err instanceof Error) || err.name !== "TypeError" || err.message !== "fetch failed") return undefined;
  const cause: unknown = err.cause;
  if (!cause || typeof cause !== "object") return undefined;
  const raw = (cause as { code?: unknown }).code;
  const code = typeof raw === "string" && /^[A-Z][A-Z0-9_]{2,40}$/.test(raw) ? raw : "";
  return {
    reason: /TIMEOUT|TIMEDOUT/.test(code) ? "error_timeout" : "error_network",
    text: code ? `fetch failed; ${code.toLowerCase()}` : "fetch failed",
  };
}

export function noteFailure<T>(result: T, err: unknown): T {
  try {
    if (result && typeof result === "object") {
      const net = fetchFailure(err);
      if (typeof err === "string") FAILURE_ORIGIN.set(result, { origin: "local", text: err });
      else if (net) FAILURE_ORIGIN.set(result, { origin: "network", ...net });
      else {
        const bug = jsBug(err);
        const text = bug ?? errorText(err);
        if (text) FAILURE_ORIGIN.set(result, { origin: bug ? "internal" : "error", text });
      }
    }
  } catch {
    // never affects the result
  }
  return result;
}

/** A JS error quotes identifiers of our code, not user data, so its quotes are kept. */
function maskedOwnText(prefix: string, text: string, quoted = true): string {
  return (prefix + scrub(text.slice(0, 2 * DETAIL_MAX).split(/\s+/).filter(Boolean).join(" "), quoted)).slice(0, DETAIL_MAX);
}

/** Best effort: classifying or sending must never change what the tool returns or throws. */
function reportCall(telemetry: Telemetry, tool: string, value: unknown, thrown: boolean): void {
  if (!telemetry.isEnabled()) return;
  try {
    let reason = thrown ? toolOutcome(undefined, value) : toolOutcome(value);
    let detail = "";
    if (reason !== "ok") {
      const noted = value && typeof value === "object" ? FAILURE_ORIGIN.get(value) : undefined;
      const net = noted?.origin === "network" ? noted : thrown ? fetchFailure(value) : undefined;
      const bug = noted?.origin === "internal" ? noted.text : thrown ? jsBug(value) : undefined;
      if (net) {
        reason = net.reason;
        detail = net.text;
      } else if (bug) {
        reason = "error_internal";
        detail = maskedOwnText("internal: ", bug, false);
      } else if (noted?.origin === "local") {
        reason = "error_invalid_request";
        detail = maskedOwnText("local: ", noted.text);
      } else {
        detail = errorDetail(resultText(value));
        const own = noted?.origin === "error" ? noted.text : thrown ? errorText(value) : undefined;
        if (!detail && own) {
          detail = own;
          // The class name ("AuthRequiredError") often says more than the message.
          if (reason === "error_other") reason = toolOutcome({ isError: true, content: [{ type: "text", text: own }] });
        }
      }
    }
    telemetry.send("tool_call", { tool, reason, error_detail: detail || undefined });
  } catch {
    // never affects the call
  }
}

/**
 * Counts every tool call by name and outcome. Wraps registerTool once, before the domain
 * modules register their tools. Calls rejected by SDK input validation are not counted.
 */
export function instrumentToolCalls(server: McpServer, telemetry: Telemetry): void {
  const original = server.registerTool.bind(server);
  // registerTool's generic signature does not survive a wrapper; the runtime
  // shape (name, config, callback) is stable per SDK contract.
  server.registerTool = ((name: string, config: unknown, callback: unknown) =>
    original(
      name,
      config as never,
      (async (...args: unknown[]) => {
        let result: unknown;
        try {
          result = await (callback as (...a: unknown[]) => unknown)(...args);
        } catch (e) {
          reportCall(telemetry, name, e, true);
          throw e;
        }
        reportCall(telemetry, name, result, false);
        return result;
      }) as never,
    )) as typeof server.registerTool;
}
