import type { VkAdsConfig } from "./types.js";

/**
 * A missing or malformed environment variable. Thrown instead of exiting on the
 * spot so index.ts can report the drop-off before the process dies; `reason` is
 * the machine-readable code that ships with that ping (never a variable's value).
 */
export class ConfigError extends Error {
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.name = "ConfigError";
    this.reason = reason;
  }
}

export const DEFAULT_API_BASE = "https://ads.vk.com/api";

/**
 * Builds the client config from environment variables.
 *
 * A missing token is NOT an error here: the server starts anyway and the token is
 * resolved per request (env → stored credentials), so an unconfigured install can
 * connect from the chat instead of dying before the MCP handshake — which is where
 * it used to leave the user with a silent red cross and nothing to read. A
 * malformed value still throws, because guessing what the user meant is worse.
 */
export function loadConfig(): VkAdsConfig {
  const token = process.env.VK_ADS_TOKEN || undefined;

  const apiBase = process.env.VK_ADS_API_BASE || DEFAULT_API_BASE;
  if (!isHttpUrl(apiBase)) {
    throw new ConfigError(
      `VK_ADS_API_BASE должен быть http(s)-адресом, получено "${apiBase}".`,
      "invalid_api_base",
    );
  }

  const timeoutMs = Number(process.env.VK_ADS_TIMEOUT_MS);
  const maxRetries = Number(process.env.VK_ADS_MAX_RETRIES);
  return {
    token,
    lang: process.env.VK_ADS_LANG || "ru",
    apiBase,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000,
    maxRetries: Number.isFinite(maxRetries) && maxRetries >= 0 ? maxRetries : 3,
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
