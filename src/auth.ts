import {
  clearCredentials,
  credentialsPath,
  readCredentials,
  writeCredentials,
  type StoredCredentials,
} from "./credentials.js";
import { expiresAtFrom, mintToken, refreshAccessToken, type TokenResponse } from "./oauth.js";

/**
 * Raised when a tool needs a token and none is available. The message is the
 * whole point of the class: it is what the calling model reads and relays, so
 * it names the fix instead of the failure.
 */
export class AuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthRequiredError";
  }
}

/** Refresh this long before the stated expiry, so a call never races the clock. */
const REFRESH_LEEWAY_MS = 60_000;

export type TokenSource = "env" | "stored";

export interface AuthStatus {
  configured: boolean;
  source?: TokenSource;
  /** ISO date the stored access token expires; absent for env tokens. */
  expiresAt?: string;
  /** ISO date the stored token was obtained. */
  obtainedAt?: string;
  canRefresh: boolean;
  /** client_id the stored token was minted with (not a secret). */
  clientId?: string;
  /** VK Ads username the token resolved to at login. */
  username?: string;
  path: string;
}

export const NOT_CONNECTED_MESSAGE =
  "VK Реклама не подключена: нет токена доступа. " +
  "Это не сбой сети — повторный вызов не поможет, нужно подключение. " +
  "Вызовите инструмент start_login, покажите пользователю инструкцию, попросите прислать " +
  "client_id и client_secret приложения из кабинета VK Рекламы (Настройки → Доступ к API), " +
  "затем передайте их в finish_login. " +
  "Альтернатива без диалога — задать переменную окружения VK_ADS_TOKEN в конфиге клиента.";

/** Options for {@link TokenStore}; both have working defaults. */
export interface TokenStoreOptions {
  /** API root the OAuth endpoint lives on — same host as the REST API. */
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Resolves the access token for every request. Two sources, in this order:
 *
 *   env    — VK_ADS_TOKEN, the documented setup; never touched or refreshed
 *   stored — ~/.config/mcp-vk-ads/credentials.json, written by finish_login
 *
 * env wins so an explicitly configured install (and CI) behaves exactly as before,
 * and the file is re-read on every call — that is what lets a login take effect
 * mid-session without restarting the client. A stored login also survives the 24 h
 * VK token lifetime on its own, which an env token cannot.
 */
export class TokenStore {
  private readonly apiBase?: string;
  private readonly fetchImpl?: typeof fetch;

  constructor(
    private readonly envToken?: string,
    options: TokenStoreOptions = {},
  ) {
    this.apiBase = options.apiBase;
    this.fetchImpl = options.fetchImpl;
  }

  /** True when a token exists without touching the network. */
  hasToken(): boolean {
    return Boolean(this.envToken) || Boolean(readCredentials());
  }

  async getToken(): Promise<string> {
    if (this.envToken) return this.envToken;

    const stored = readCredentials();
    if (!stored) throw new AuthRequiredError(NOT_CONNECTED_MESSAGE);

    if (!isExpired(stored)) return stored.access_token;

    if (!stored.refresh_token || !stored.client_id || !stored.client_secret) {
      throw new AuthRequiredError(
        "Срок действия сохранённого токена VK Рекламы истёк, а обновить его нечем. " +
          "Вызовите start_login и подключитесь заново.",
      );
    }
    const refreshed = await this.refresh();
    return refreshed.access_token;
  }

  /**
   * Mints the first token for an app the user just created in their cabinet and
   * stores it. Every call creates a new token on VK's side (cap: 5 live tokens per
   * client_id + user), so this belongs to `finish_login` alone, not to a retry path.
   */
  async connect(params: { clientId: string; clientSecret: string }): Promise<StoredCredentials> {
    const response = await mintToken({
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      apiBase: this.apiBase,
      fetchImpl: this.fetchImpl,
    });
    return this.save(response, { clientId: params.clientId, clientSecret: params.clientSecret });
  }

  /**
   * Re-mints the access token from the stored refresh token. Called on expiry and
   * once more when the API answers 401 — a token can be revoked in the cabinet long
   * before `expires_at`, and only the API knows that.
   */
  async refresh(): Promise<StoredCredentials> {
    const stored = readCredentials();
    if (!stored?.refresh_token || !stored.client_id || !stored.client_secret) {
      throw new AuthRequiredError(
        "Нет сохранённых данных для обновления токена VK Рекламы — вызовите start_login заново.",
      );
    }
    const response = await refreshAccessToken({
      refreshToken: stored.refresh_token,
      clientId: stored.client_id,
      clientSecret: stored.client_secret,
      apiBase: this.apiBase,
      fetchImpl: this.fetchImpl,
    });
    return this.save(response, {
      clientId: stored.client_id,
      clientSecret: stored.client_secret,
      username: stored.username,
      // VK may answer a refresh without a new refresh_token; the old one stays valid,
      // and dropping it here would strand the login at the next expiry.
      fallbackRefreshToken: stored.refresh_token,
    });
  }

  /** True when a stored refresh is possible — i.e. a retry after 401 is worth trying. */
  canRefresh(): boolean {
    const stored = this.envToken ? undefined : readCredentials();
    return Boolean(stored?.refresh_token && stored.client_id && stored.client_secret);
  }

  /** Persists a token response; returns what was stored (never logged). */
  save(
    response: TokenResponse,
    app: {
      clientId: string;
      clientSecret: string;
      username?: string;
      fallbackRefreshToken?: string;
    },
    now = Date.now(),
  ): StoredCredentials {
    const credentials: StoredCredentials = {
      client_id: app.clientId,
      client_secret: app.clientSecret,
      access_token: response.access_token,
      refresh_token: response.refresh_token ?? app.fallbackRefreshToken,
      expires_at: expiresAtFrom(response.expires_in, now),
      obtained_at: now,
      username: app.username,
    };
    writeCredentials(credentials);
    return credentials;
  }

  /** Records the account the token resolved to, so auth_status can name it. */
  rememberUsername(username: string): void {
    const stored = readCredentials();
    if (!stored || !username) return;
    writeCredentials({ ...stored, username });
  }

  logout(): boolean {
    return clearCredentials();
  }

  status(): AuthStatus {
    const stored = readCredentials();
    const path = credentialsPath();
    if (this.envToken) {
      return { configured: true, source: "env", canRefresh: false, path };
    }
    if (!stored) return { configured: false, canRefresh: false, path };
    return {
      configured: true,
      source: "stored",
      expiresAt: stored.expires_at ? new Date(stored.expires_at).toISOString() : undefined,
      obtainedAt: new Date(stored.obtained_at).toISOString(),
      canRefresh: Boolean(stored.refresh_token && stored.client_id && stored.client_secret),
      clientId: stored.client_id,
      username: stored.username,
      path,
    };
  }
}

function isExpired(stored: StoredCredentials, now = Date.now()): boolean {
  if (!stored.expires_at) return false;
  return stored.expires_at - REFRESH_LEEWAY_MS <= now;
}
