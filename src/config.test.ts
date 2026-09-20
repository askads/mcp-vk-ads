import { test } from "node:test";
import assert from "node:assert/strict";

import { ConfigError, DEFAULT_API_BASE, loadConfig } from "./config.js";

/**
 * The reason codes below are the vocabulary the dashboard groups by — renaming
 * one silently splits a bar in two, so they are pinned here.
 */
function withEnv(vars: Record<string, string | undefined>, run: () => void): void {
  const saved = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    run();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function reasonOf(vars: Record<string, string | undefined>): string {
  let caught: unknown;
  withEnv(vars, () => {
    try {
      loadConfig();
    } catch (err) {
      caught = err;
    }
  });
  assert.ok(caught instanceof ConfigError, "config problems must throw ConfigError, not exit");
  return caught.reason;
}

test("a missing token is not a config error — the login happens in the chat", () => {
  // The server used to exit(1) here, before the MCP handshake: the client showed a
  // dead server and the user never learned why. Now it starts and offers start_login.
  withEnv({ VK_ADS_TOKEN: undefined, VK_ADS_API_BASE: undefined }, () => {
    const config = loadConfig();
    assert.equal(config.token, undefined);
    assert.equal(config.apiBase, DEFAULT_API_BASE);
  });
});

test("a configured server loads without throwing", () => {
  withEnv({ VK_ADS_TOKEN: "t0ken", VK_ADS_API_BASE: undefined }, () => {
    assert.equal(loadConfig().token, "t0ken");
  });
});

test("a malformed API base reports invalid_api_base", () => {
  // Left unchecked this surfaces much later as a bare "Invalid URL" from the client.
  assert.equal(reasonOf({ VK_ADS_API_BASE: "ads.vk.com" }), "invalid_api_base");
  assert.equal(reasonOf({ VK_ADS_API_BASE: "ftp://ads.vk.com/api" }), "invalid_api_base");
});
