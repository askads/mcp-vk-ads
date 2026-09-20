/**
 * The VK Ads half of the in-chat login.
 *
 * VK Ads has three OAuth2 flows, and only two of them are open to everyone:
 * `client_credentials` (own account) and `agency_client_credentials` (an agency's
 * client). `authorization_code` — the browser-consent flow that would let this
 * server ask for access on the user's behalf — is granted only to approved
 * partners with a registered redirect URI, so it is not an option for a package
 * anyone can `npx`. Hence the login here takes the user's own app credentials
 * (created in their cabinet) and mints the token locally; the tokens live ~24 h
 * and are renewed from `refresh_token` without asking the user again.
 */

/** API root used when the caller passes none (same host as the REST API). */
export const DEFAULT_API_BASE = "https://ads.vk.com/api";

/** Cabinet page where the user creates the API app and reads client_id/client_secret. */
export const API_SETTINGS_URL = "https://ads.vk.com/hq/settings/access";

/** VK Ads keeps at most this many live tokens per (client_id, user) pair. */
export const MAX_ACTIVE_TOKENS = 5;

const OAUTH_TIMEOUT_MS = 30_000;

export interface TokenResponse {
  access_token: string;
  /** VK returns one for every grant; it is what keeps the login alive past 24 h. */
  refresh_token?: string;
  /** Lifetime in seconds — VK sends it as a string ("86400"). */
  expires_in?: number | string;
  token_type?: string;
  scope?: string;
}

/** `v2/oauth2/token.json` on the configured API host. */
export function tokenUrl(apiBase: string = DEFAULT_API_BASE): string {
  const base = apiBase.endsWith("/") ? apiBase : `${apiBase}/`;
  return new URL("v2/oauth2/token.json", base).toString();
}

/**
 * Mints an access token for the app owner's own account (Client Credentials Grant).
 * Every call creates a NEW token and counts toward {@link MAX_ACTIVE_TOKENS}.
 */
export async function mintToken(params: {
  clientId: string;
  clientSecret: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenResponse> {
  return postToken(
    {
      grant_type: "client_credentials",
      client_id: params.clientId,
      client_secret: params.clientSecret,
    },
    params.apiBase,
    params.fetchImpl,
  );
}

/**
 * Trades a refresh token for a fresh access token. VK requires the app credentials
 * alongside the refresh token — that is why the secret is stored, not just the token.
 */
export async function refreshAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenResponse> {
  return postToken(
    {
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    },
    params.apiBase,
    params.fetchImpl,
  );
}

async function postToken(
  form: Record<string, string>,
  apiBase: string = DEFAULT_API_BASE,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  const url = tokenUrl(apiBase);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OAUTH_TIMEOUT_MS);
  let res: Response;
  let text: string;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: controller.signal,
    });
    text = await res.text();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Запрос к ${url} превысил таймаут ${OAUTH_TIMEOUT_MS} мс`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  if (!res.ok) throw new Error(describeOAuthError(res.status, body));

  const token = body as TokenResponse;
  if (!token || typeof token.access_token !== "string") {
    throw new Error("VK Реклама вернула ответ без access_token.");
  }
  return token;
}

/** Seconds (VK sends a string) → epoch ms, or undefined when absent/unparsable. */
export function expiresAtFrom(expiresIn: number | string | undefined, now: number): number | undefined {
  const seconds = Number(expiresIn);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return now + seconds * 1000;
}

/**
 * Turns VK's error envelope into advice. Two shapes exist in the wild — the OAuth
 * `{error, error_description}` and VK's own `{code, message}` — and the code is
 * what decides the fix: a wrong secret and a dead refresh token both surface as a
 * bare 401, but only one of them is worth retyping.
 */
function describeOAuthError(status: number, body: unknown): string {
  const obj = (body ?? {}) as Record<string, unknown>;
  const code =
    (typeof obj.error === "string" && obj.error) ||
    (typeof obj.code === "string" && obj.code) ||
    `HTTP ${status}`;
  const description =
    (typeof obj.error_description === "string" && obj.error_description) ||
    (typeof obj.message === "string" && obj.message) ||
    "";
  const tail = description ? ` Ответ VK: ${description}` : "";

  switch (code) {
    case "invalid_client":
      return (
        "VK Реклама не приняла пару client_id/client_secret (invalid_client). " +
        "Проверьте, что обе строки скопированы целиком и относятся к одному приложению " +
        `в разделе «Настройки → Доступ к API» (${API_SETTINGS_URL}); ` +
        "то же самое возвращается, если приложение заблокировано." +
        tail
      );
    case "invalid_grant":
    case "invalid_token":
    case "expired_token":
      return (
        "Refresh-токен VK Рекламы больше не действует: он умирает после месяца без " +
        "обновления, а также если доступ отозвали. Подключитесь заново — start_login, " +
        "затем finish_login." +
        tail
      );
    case "revoked_token":
      return (
        "Доступ отозван на стороне VK Рекламы (revoked_token) — токены этого приложения " +
        "удалены. Подключитесь заново через start_login." +
        tail
      );
    case "invalid_user":
      return `Аккаунт VK Рекламы заблокирован или недоступен (invalid_user).${tail}`;
    default:
      return `Ошибка авторизации VK Рекламы: ${code}${description ? ` — ${description}` : ""}`;
  }
}
