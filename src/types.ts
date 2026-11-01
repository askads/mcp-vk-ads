export interface VkAdsConfig {
  /**
   * VK_ADS_TOKEN, when set. Optional: without it the token comes from the
   * credentials file written by the in-chat login (see TokenStore).
   */
  token?: string;
  /** Accept-Language header sent with every request. */
  lang: string;
  /** API root, without a version segment. Defaults to https://ads.vk.com/api. */
  apiBase: string;
  /** Per-request timeout in milliseconds. Defaults to 60_000. */
  timeoutMs?: number;
  /** Max retries for transient errors (429 rate limit, 5xx). Defaults to 3. */
  maxRetries?: number;
  /** Base backoff in milliseconds, doubled each retry. Defaults to 500. */
  retryBaseMs?: number;
}

/**
 * Appended to every 403. VK answers it to a token that is alive but may not touch
 * the object (a dead token is a 401, see client.ts), and the usual cause is the
 * grant: client_credentials covers the user's own cabinet only, an agency client's
 * cabinet needs an agency_client_credentials token (README, finish_login docs).
 */
export const FORBIDDEN_HINT =
  "Нет прав на объект или кабинет: вход через finish_login (client_credentials) открывает только собственный кабинет, " +
  "кабинет клиента агентства — только токен agency_client_credentials в VK_ADS_TOKEN.";

/**
 * VK Ads reports failures as a non-2xx HTTP status, usually with a JSON body. The
 * body shape varies by error kind (and a proxy in front of the API answers with
 * HTML or nothing at all), so the raw parsed body is kept alongside the status and
 * a best-effort human-readable message is derived from it.
 */
export class VkAdsError extends Error {
  readonly status: number;
  readonly body?: unknown;
  /** VK's x-request-id, the handle its support asks for. */
  readonly requestId?: string;

  constructor(status: number, body: unknown, requestId?: string) {
    super(
      `HTTP ${status}: ${formatErrorBody(body)}` +
        (requestId ? ` (request_id ${requestId})` : "") +
        (status === 403 ? `. ${FORBIDDEN_HINT}` : ""),
    );
    this.name = "VkAdsError";
    this.status = status;
    this.body = body;
    this.requestId = requestId;
  }
}

const EMPTY_BODY = "(пустое тело ответа)";

/**
 * Turns a parsed VK Ads error body into a short, readable message.
 *
 * Plain text, never a leading `[` or `{`: the telemetry excerpt (errorDetail, shared
 * across the fleet) reads the text after "HTTP nnn:" only up to the first bracket, so
 * "[validation_failed] …" or a raw JSON dump left the beacon with a bare "HTTP 400".
 * Nested details stay JSON after the readable head.
 */
function formatErrorBody(body: unknown): string {
  if (body == null) return EMPTY_BODY;
  if (typeof body === "string") return formatTextBody(body);
  if (typeof body !== "object") return String(body);
  if (Array.isArray(body)) {
    return body.every((v) => typeof v === "string") ? clip(body.join("; "), 500) : `ответ ${clip(JSON.stringify(body), 500)}`;
  }

  const obj = body as Record<string, unknown>;

  // OAuth-style: { error: "invalid_grant", error_description: "..." }
  if (typeof obj.error === "string") {
    const desc = typeof obj.error_description === "string" ? `: ${obj.error_description}` : "";
    return `${obj.error}${desc}`;
  }

  // Object-style: { error: { code, message, fields? } }. A validation_failed says
  // nothing on its own — which field failed lives in `fields` (nested per object),
  // so everything besides code/message is kept as compact JSON.
  if (obj.error && typeof obj.error === "object" && !Array.isArray(obj.error)) {
    const { code, message, ...rest } = obj.error as Record<string, unknown>;
    const { error: _error, ...siblings } = obj;
    const head = [code, message].filter((v) => v !== undefined && v !== null && v !== "").map(String).join(": ");
    const details = { ...rest, ...siblings };
    const extra = Object.keys(details).length > 0 ? clip(JSON.stringify(details), 1500) : "";
    return [head || "ошибка без кода и текста", extra].filter(Boolean).join(" ");
  }

  // Validation-style: { field: ["msg", ...], ... }, or a lone { message } / { detail }.
  const flat = flatten(obj);
  if (flat) return clip(flat, 500);
  return Object.keys(obj).length === 0 ? EMPTY_BODY : `ответ ${clip(JSON.stringify(obj), 500)}`;
}

/** `field: msg, msg; field2: msg` when every value is a scalar or a list of scalars. */
function flatten(obj: Record<string, unknown>): string {
  const scalar = (v: unknown) => typeof v === "string" || typeof v === "number" || typeof v === "boolean";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (scalar(value)) parts.push(`${key}: ${value}`);
    else if (Array.isArray(value) && value.every(scalar)) parts.push(`${key}: ${value.join(", ")}`);
    else return "";
  }
  return parts.join("; ");
}

/** A body that did not parse as JSON: plain text, an HTML error page, or whitespace. */
function formatTextBody(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return EMPTY_BODY;
  if (/^<(?:!doctype|html|head|body|title)\b/i.test(trimmed)) {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(trimmed)?.[1];
    const plain = (title ?? trimmed.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    return `${clip(plain, 200) || "страница без текста"} (HTML-страница вместо ответа API)`;
  }
  return clip(trimmed.replace(/\s+/g, " "), 500);
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
