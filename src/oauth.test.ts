import { test } from "node:test";
import assert from "node:assert/strict";

import { expiresAtFrom, mintToken, refreshAccessToken, tokenUrl } from "./oauth.js";

const BASE = "https://ads.vk.com/api";

/** A fetch double that records the call and answers with the given status/body. */
function stubFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit; form: URLSearchParams }> = [];
  const impl = (async (url: unknown, init: unknown) => {
    const i = (init ?? {}) as RequestInit;
    calls.push({
      url: String(url),
      init: i,
      form: new URLSearchParams(String(i.body ?? "")),
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("tokenUrl hangs off the configured API base, with or without a trailing slash", () => {
  assert.equal(tokenUrl(BASE), "https://ads.vk.com/api/v2/oauth2/token.json");
  assert.equal(tokenUrl(`${BASE}/`), "https://ads.vk.com/api/v2/oauth2/token.json");
});

test("mintToken posts the client_credentials form as urlencoded", async () => {
  const stub = stubFetch(200, { access_token: "at", refresh_token: "rt", expires_in: "86400" });
  const token = await mintToken({
    clientId: "cid",
    clientSecret: "secret",
    apiBase: BASE,
    fetchImpl: stub.impl,
  });

  assert.equal(token.access_token, "at");
  assert.equal(stub.calls[0].url, "https://ads.vk.com/api/v2/oauth2/token.json");
  assert.equal(stub.calls[0].init.method, "POST");
  assert.equal(
    (stub.calls[0].init.headers as Record<string, string>)["Content-Type"],
    "application/x-www-form-urlencoded",
  );
  assert.equal(stub.calls[0].form.get("grant_type"), "client_credentials");
  assert.equal(stub.calls[0].form.get("client_id"), "cid");
  assert.equal(stub.calls[0].form.get("client_secret"), "secret");
});

test("refreshAccessToken sends the refresh grant with the app credentials", async () => {
  // VK refuses a refresh that arrives without client_id/client_secret — that
  // requirement is the reason the secret is stored at all.
  const stub = stubFetch(200, { access_token: "at2" });
  await refreshAccessToken({
    refreshToken: "rt",
    clientId: "cid",
    clientSecret: "secret",
    apiBase: BASE,
    fetchImpl: stub.impl,
  });

  assert.equal(stub.calls[0].form.get("grant_type"), "refresh_token");
  assert.equal(stub.calls[0].form.get("refresh_token"), "rt");
  assert.equal(stub.calls[0].form.get("client_id"), "cid");
  assert.equal(stub.calls[0].form.get("client_secret"), "secret");
});

test("invalid_client is explained as a bad client_id/client_secret pair", async () => {
  const stub = stubFetch(401, { error: "invalid_client", error_description: "Wrong secret" });
  await assert.rejects(
    () => mintToken({ clientId: "cid", clientSecret: "nope", apiBase: BASE, fetchImpl: stub.impl }),
    /client_id\/client_secret|invalid_client/,
  );
});

test("VK's {code, message} envelope is understood, not printed as HTTP 401", async () => {
  const stub = stubFetch(401, { code: "invalid_grant", message: "Refresh token expired" });
  await assert.rejects(
    () =>
      refreshAccessToken({
        refreshToken: "dead",
        clientId: "cid",
        clientSecret: "secret",
        apiBase: BASE,
        fetchImpl: stub.impl,
      }),
    (err: unknown) =>
      err instanceof Error &&
      /start_login/.test(err.message) &&
      /Refresh token expired/.test(err.message),
  );
});

test("a 200 without access_token is an error, not a silent empty token", async () => {
  const stub = stubFetch(200, { token_type: "bearer" });
  await assert.rejects(
    () => mintToken({ clientId: "cid", clientSecret: "s", apiBase: BASE, fetchImpl: stub.impl }),
    /без access_token/,
  );
});

test("expiresAtFrom accepts VK's string seconds and rejects junk", () => {
  assert.equal(expiresAtFrom("86400", 1_000), 1_000 + 86_400_000);
  assert.equal(expiresAtFrom(3600, 0), 3_600_000);
  assert.equal(expiresAtFrom(undefined, 0), undefined);
  assert.equal(expiresAtFrom("soon", 0), undefined);
  assert.equal(expiresAtFrom(0, 0), undefined);
});
