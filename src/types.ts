export interface VkAdsConfig {
  token: string;
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

  constructor(status: number, body: unknown) {
    super(`HTTP ${status}: ${formatErrorBody(body)}`);
    this.name = "VkAdsError";
    this.status = status;
    this.body = body;
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

  // Object-style: { error: { code, message } }
  if (obj.error && typeof obj.error === "object") {
    const err = obj.error as Record<string, unknown>;
    const code = err.code !== undefined ? `[${err.code}] ` : "";
    const message = typeof err.message === "string" ? err.message : JSON.stringify(err);
    return `${code}${message}`;
  }

  // Validation-style: { field: ["msg", ...], ... } — keep the compact JSON.
  return JSON.stringify(obj).slice(0, 500);
}
