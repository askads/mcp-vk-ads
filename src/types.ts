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
 * VK Ads reports failures as a non-2xx HTTP status with a JSON body. The body
 * shape varies by error kind, so the raw parsed body is kept alongside the
 * status and a best-effort human-readable message is derived from it.
 */
export class VkAdsError extends Error {
  readonly status: number;
  readonly body?: unknown;
  /** VK's x-request-id, the handle its support asks for. */
  readonly requestId?: string;

  constructor(status: number, body: unknown, requestId?: string) {
    super(`HTTP ${status}: ${formatErrorBody(body)}${requestId ? ` (request_id ${requestId})` : ""}`);
    this.name = "VkAdsError";
    this.status = status;
    this.body = body;
    this.requestId = requestId;
  }
}

/** Turns a parsed VK Ads error body into a short, readable message. */
function formatErrorBody(body: unknown): string {
  if (body == null) return "(пустое тело ответа)";
  if (typeof body === "string") return body.slice(0, 500);
  if (typeof body !== "object") return String(body);

  const obj = body as Record<string, unknown>;

  // OAuth-style: { error: "invalid_grant", error_description: "..." }
  if (typeof obj.error === "string") {
    const desc = typeof obj.error_description === "string" ? `: ${obj.error_description}` : "";
    return `${obj.error}${desc}`;
  }

  // Object-style: { error: { code, message, fields? } }. A validation_failed says
  // nothing on its own — which field failed lives in `fields` (nested per object),
  // so everything besides code/message is kept as compact JSON.
  if (obj.error && typeof obj.error === "object") {
    const { code, message, ...rest } = obj.error as Record<string, unknown>;
    const { error: _error, ...siblings } = obj;
    const prefix = code !== undefined ? `[${code}] ` : "";
    const text = typeof message === "string" ? message : "";
    const details = { ...rest, ...siblings };
    const extra = Object.keys(details).length > 0 ? ` ${JSON.stringify(details).slice(0, 1500)}` : "";
    if (!text && !extra) return `${prefix}${JSON.stringify(obj.error)}`.trim();
    return `${prefix}${text}${extra}`.trim();
  }

  // Validation-style: { field: ["msg", ...], ... } — keep the compact JSON.
  return JSON.stringify(obj).slice(0, 500);
}
