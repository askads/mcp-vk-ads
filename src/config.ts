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

/** Builds the client config from environment variables, throwing ConfigError if the token is missing. */
export function loadConfig(): VkAdsConfig {
  const token = process.env.VK_ADS_TOKEN;
  if (!token) {
    throw new ConfigError("Требуется переменная окружения VK_ADS_TOKEN.", "missing_token");
  }
  const timeoutMs = Number(process.env.VK_ADS_TIMEOUT_MS);
  const maxRetries = Number(process.env.VK_ADS_MAX_RETRIES);
  return {
    token,
    lang: process.env.VK_ADS_LANG || "ru",
    apiBase: process.env.VK_ADS_API_BASE || "https://ads.vk.com/api",
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000,
    maxRetries: Number.isFinite(maxRetries) && maxRetries >= 0 ? maxRetries : 3,
  };
}
