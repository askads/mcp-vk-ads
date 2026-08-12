import type { VkAdsConfig } from "./types.js";
import { VkAdsError } from "./types.js";

export type HttpMethod = "GET" | "POST" | "DELETE";

/** A query string value; undefined and empty-string values are dropped. */
export type QueryValue = string | number | boolean | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
}

/** A VK Ads list response: a page of `items` plus the total `count`. */
export interface ListPage<T = unknown> {
  count: number;
  items: T[];
}

/** Largest page size the VK Ads list endpoints accept. */
export const MAX_PAGE_LIMIT = 250;

/**
 * Hard cap on the number of objects an autopaginated response returns, so a huge
 * account can't produce a megabyte-scale (token-blowing) payload. When hit, the
 * result is trimmed to this many items and flagged `_truncated`.
 */
export const MAX_AUTO_ITEMS = 1000;

export class VkAdsClient {
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(private readonly config: VkAdsConfig) {
    // Normalize to a trailing slash so relative paths ("v2/ad_plans.json") resolve.
    this.base = config.apiBase.endsWith("/") ? config.apiBase : config.apiBase + "/";
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseMs = config.retryBaseMs ?? 500;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.token}`,
      "Accept-Language": this.config.lang,
      ...extra,
    };
  }

  /** Backoff before a retry: honors Retry-After when present, else exponential (capped at 30s). */
  private backoffMs(attempt: number, res?: Response): number {
    const retryAfter = res ? Number(res.headers.get("Retry-After")) : NaN;
    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter, 30) * 1000;
    return Math.min(this.retryBaseMs * 2 ** attempt, 30_000);
  }

  /**
   * fetch with an AbortController timeout so a hung connection can't hang the tool
   * forever. The response body is read INSIDE the guarded zone (the timer is only
   * cleared after `res.text()`), so a slow/drip-fed body is covered by the timeout too.
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    label: string,
  ): Promise<{ res: Response; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const text = await res.text();
      return { res, text };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Запрос к "${label}" превысил таймаут ${this.timeoutMs} мс`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(path.replace(/^\//, ""), this.base);
    // SSRF guard: an absolute path ("https://evil/x", "http://evil/x" or the
    // backslash form "\evil/x") would override `base` and send our Bearer token to
    // a foreign host. Refuse anything that resolves off the API origin.
    if (url.origin !== new URL(this.base).origin) {
      throw new Error(
        `Путь в raw_request должен быть относительным путём API (ведёт на чужой origin ${url.origin})`,
      );
    }
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === "") continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /**
   * Issues a request to a VK Ads endpoint (path includes the version segment,
   * e.g. "v2/ad_plans.json") and returns the parsed JSON body. Retries with backoff;
   * any other non-2xx status throws a {@link VkAdsError}.
   *
   * Retry policy: 429 is retried for ANY method (the request wasn't processed). 5xx
   * and network errors/timeouts are retried ONLY for idempotent GETs — a 502/504
   * after a POST may have committed (create), so replaying it risks a duplicate.
   */
  async request<T = unknown>(method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, opts.query);
    const hasBody = opts.body !== undefined && method !== "GET";
    const idempotent = method === "GET";

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      let text: string;
      try {
        ({ res, text } = await this.fetchWithTimeout(
          url,
          {
            method,
            headers: this.headers(hasBody ? { "Content-Type": "application/json" } : undefined),
            body: hasBody ? JSON.stringify(opts.body) : undefined,
          },
          path,
        ));
      } catch (err) {
        // Network error / timeout: retry only idempotent (GET) requests; a non-GET
        // may have already reached the backend, so replaying it is unsafe.
        if (idempotent && attempt < this.maxRetries) {
          await delay(this.backoffMs(attempt));
          continue;
        }
        throw err;
      }

      const transient = res.status === 429 || (idempotent && res.status >= 500 && res.status < 600);
      if (transient && attempt < this.maxRetries) {
        await delay(this.backoffMs(attempt, res));
        continue;
      }

      let data: unknown = undefined;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      if (!res.ok) throw new VkAdsError(res.status, data);
      return data as T;
    }
  }

  async get<T = unknown>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  async post<T = unknown>(path: string, body?: unknown, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>("POST", path, { body, query });
  }

  async delete<T = unknown>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>("DELETE", path, { query });
  }

  /**
   * Reads a list endpoint, following offset/count to fetch every page and
   * merging the `items` arrays, so large accounts are not silently truncated.
   *
   * Pages at MAX_PAGE_LIMIT regardless of a caller `limit` (which would otherwise
   * shrink capacity to limit×maxPages) → deterministic MAX_PAGE_LIMIT × maxPages.
   * Carries through `total` (statistics: the summary across ALL objects — same on
   * every page). If the maxPages cap is hit with more remaining, flags `_truncated`
   * so the cutoff is explicit, not a silent items.length < count.
   *
   * `maxItems` caps the total returned objects (default {@link MAX_AUTO_ITEMS}) to keep
   * model-facing payloads token-bounded; pass `Infinity` for internal full-dictionary
   * fetches (e.g. get_regions) that filter locally and only return a small slice.
   */
  async getAll<T = unknown>(
    path: string,
    query: Record<string, QueryValue> = {},
    maxPages = 100,
    maxItems = MAX_AUTO_ITEMS,
  ): Promise<ListPage<T> & { total?: unknown; _truncated?: boolean; _truncatedNote?: string }> {
    const limit = MAX_PAGE_LIMIT;
    let offset = Number(query.offset ?? 0);
    const items: T[] = [];
    let count = 0;
    let total: unknown;
    let truncated = false;

    for (let page = 0; page < maxPages; page++) {
      const data = await this.get<ListPage<T> & { total?: unknown }>(path, { ...query, limit, offset });
      const batch = data.items ?? [];
      items.push(...batch);
      count = typeof data.count === "number" ? data.count : items.length;
      if (data.total !== undefined) total = data.total;
      offset += batch.length;
      if (items.length >= maxItems) {
        truncated = true; // response-size cap: keep the payload token-bounded
        break;
      }
      if (batch.length === 0 || batch.length < limit || offset >= count) break;
      if (page === maxPages - 1) truncated = true; // more remains but the page cap stopped us
    }

    // Trim any overshoot from the last batch so we return at most `maxItems`.
    if (items.length > maxItems) items.length = maxItems;

    const result: ListPage<T> & { total?: unknown; _truncated?: boolean; _truncatedNote?: string } = {
      count,
      items,
    };
    if (total !== undefined) result.total = total;
    if (truncated) {
      result._truncated = true;
      result._truncatedNote =
        `Усечено: возвращены первые ${items.length} объектов из ${count} ` +
        `(лимит страниц и размера ответа). Остальные — с фильтром по ids или более узким периодом.`;
    }
    return result;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
