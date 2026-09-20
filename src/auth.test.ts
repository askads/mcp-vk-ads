import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuthRequiredError, TokenStore } from "./auth.js";
import { credentialsPath, readCredentials, writeCredentials } from "./credentials.js";

/**
 * Every test gets its own XDG_CONFIG_HOME, so the suite never reads or writes the
 * developer's real credentials file. Awaits `run` — a synchronous finally would
 * restore the real config dir at the callback's first await, and the rest of the
 * test would then quietly read the developer's own credentials.
 */
async function withTempConfig<T>(run: () => T | Promise<T>): Promise<T> {
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "mcp-vk-ads-test-"));
  try {
    return await run();
  } finally {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
  }
}

/** A stored login, as finish_login would have written it. */
function storeLogin(overrides: Partial<Parameters<typeof writeCredentials>[0]> = {}): void {
  writeCredentials({
    client_id: "cid",
    client_secret: "secret",
    access_token: "stored",
    refresh_token: "rt",
    obtained_at: Date.now(),
    ...overrides,
  });
}

function tokenFetch(body: Record<string, unknown>): typeof fetch {
  return (async () =>
    ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    }) as unknown as Response) as unknown as typeof fetch;
}

test("with nothing configured, getToken explains how to connect", async () => {
  await withTempConfig(async () => {
    const store = new TokenStore(undefined);
    assert.equal(store.hasToken(), false);
    await assert.rejects(() => store.getToken(), AuthRequiredError);
    // The message is the user-facing product here: it must name the tool to call.
    await assert.rejects(() => store.getToken(), /start_login/);
  });
});

test("an env token wins and is never refreshed", async () => {
  await withTempConfig(async () => {
    storeLogin();
    const store = new TokenStore("from-env");
    assert.equal(await store.getToken(), "from-env");
    assert.equal(store.canRefresh(), false, "an explicitly configured token is not ours to rotate");
    assert.equal(store.status().source, "env");
  });
});

test("a stored token is used when no env token is set", async () => {
  await withTempConfig(async () => {
    storeLogin();
    const store = new TokenStore(undefined);
    assert.equal(await store.getToken(), "stored");
    assert.equal(store.status().source, "stored");
    assert.equal(store.status().clientId, "cid");
  });
});

test("the credentials file is owner-only", async () => {
  await withTempConfig(() => {
    storeLogin();
    if (process.platform === "win32") return; // POSIX modes are not meaningful here
    assert.equal(statSync(credentialsPath()).mode & 0o777, 0o600);
  });
});

test("a truncated credentials file reads as 'not connected', not as an empty token", async () => {
  await withTempConfig(() => {
    storeLogin();
    writeFileSync(credentialsPath(), "{ oops");
    assert.equal(readCredentials(), undefined);
    assert.equal(new TokenStore(undefined).hasToken(), false);
  });
});

test("connect() mints a token, stores the app credentials and dates the expiry", async () => {
  await withTempConfig(async () => {
    const store = new TokenStore(undefined, {
      fetchImpl: tokenFetch({ access_token: "fresh", refresh_token: "rt", expires_in: "86400" }),
    });
    const stored = await store.connect({ clientId: "cid", clientSecret: "secret" });

    assert.equal(stored.access_token, "fresh");
    assert.equal(readCredentials()?.client_secret, "secret", "refresh needs the secret later");
    assert.ok((stored.expires_at ?? 0) > Date.now(), "VK's string expires_in must be parsed");
  });
});

test("an expired token is refreshed transparently and the new one is stored", async () => {
  await withTempConfig(async () => {
    storeLogin({ access_token: "old", expires_at: Date.now() - 1000 });
    const store = new TokenStore(undefined, {
      fetchImpl: tokenFetch({ access_token: "new", refresh_token: "rt2", expires_in: 86400 }),
    });

    assert.equal(await store.getToken(), "new");
    assert.equal(readCredentials()?.access_token, "new");
    assert.equal(readCredentials()?.refresh_token, "rt2", "the rotated refresh token must persist");
    assert.equal(readCredentials()?.client_id, "cid", "the app credentials survive a refresh");
  });
});

test("a refresh that returns no refresh_token keeps the old one", async () => {
  await withTempConfig(async () => {
    // VK may answer a refresh with the access token alone; dropping the stored
    // refresh_token here would strand the login at the next expiry.
    storeLogin({ access_token: "old", expires_at: Date.now() - 1000 });
    const store = new TokenStore(undefined, {
      fetchImpl: tokenFetch({ access_token: "new", expires_in: 86400 }),
    });

    await store.getToken();
    assert.equal(readCredentials()?.refresh_token, "rt");
  });
});

test("an expired token with nothing to refresh from asks for a new login", async () => {
  await withTempConfig(async () => {
    storeLogin({ access_token: "old", expires_at: Date.now() - 1000, refresh_token: undefined });
    await assert.rejects(() => new TokenStore(undefined).getToken(), /start_login/);
  });
});

test("logout removes the stored login and reports whether there was one", async () => {
  await withTempConfig(() => {
    const store = new TokenStore(undefined);
    assert.equal(store.logout(), false, "nothing stored yet");
    storeLogin();
    assert.equal(store.logout(), true);
    assert.equal(store.hasToken(), false);
  });
});

test("status carries neither the token nor the client_secret", async () => {
  await withTempConfig(() => {
    storeLogin({ access_token: "super-secret", client_secret: "very-secret" });
    const status = JSON.stringify(new TokenStore(undefined).status());
    assert.ok(!status.includes("super-secret"), "auth_status output must be safe to print");
    assert.ok(!status.includes("very-secret"), "the app secret must never be echoed back");
    assert.ok(status.includes("credentials.json"), "but it must say where the file lives");
  });
});
