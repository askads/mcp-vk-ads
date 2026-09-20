import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Directory name under $XDG_CONFIG_HOME (or ~/.config), shared with instance-id. */
const APP = "mcp-vk-ads";

/**
 * Tokens minted by the in-chat login. Written by `finish_login`, read on every API
 * call — the file is the reason a fresh token takes effect without restarting the
 * client: nothing is cached in the process beyond one request.
 *
 * The app credentials live here too, unlike a pure OAuth flow: VK Ads re-mints an
 * access token from `refresh_token` only when `client_id` **and** `client_secret`
 * accompany it, so without them the connection would die 24 hours later.
 */
export interface StoredCredentials {
  /** client_id of the user's VK Ads API app; shown in auth_status. */
  client_id: string;
  /** client_secret of that app — password-grade; never returned by any tool. */
  client_secret: string;
  access_token: string;
  refresh_token?: string;
  /** Epoch ms after which the access token is no longer valid (VK: ~24 h). */
  expires_at?: number;
  /** Epoch ms the token was obtained — shown in auth_status, never sent anywhere. */
  obtained_at: number;
  /** VK Ads username the token resolved to, recorded at login for auth_status. */
  username?: string;
}

/** Absolute path of the credentials file; safe to show the user. */
export function credentialsPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, APP, "credentials.json");
}

/** Reads stored credentials, or undefined when nothing is stored (or it is unreadable). */
export function readCredentials(): StoredCredentials | undefined {
  let raw: string;
  try {
    raw = readFileSync(credentialsPath(), "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as StoredCredentials;
    // A truncated or hand-edited file must not read as "logged in": without a
    // usable access_token the caller has to fall through to the login flow.
    if (typeof parsed?.access_token !== "string" || parsed.access_token === "") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Writes credentials with owner-only permissions. The mode is set on the open
 * *and* re-applied with chmod, because an existing file keeps its old mode when
 * writeFileSync merely truncates it.
 */
export function writeCredentials(credentials: StoredCredentials): string {
  const file = credentialsPath();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows and some network filesystems do not implement POSIX modes; the
    // write itself succeeded, which is what the caller cares about.
  }
  return file;
}

/** Deletes the credentials file. Returns true when a file was actually removed. */
export function clearCredentials(): boolean {
  const file = credentialsPath();
  if (!readCredentials() && !fileExists(file)) return false;
  try {
    rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

function fileExists(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}
