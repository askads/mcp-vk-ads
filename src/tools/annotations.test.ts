import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAccountTools } from "./account.js";
import { registerAdPlanTools } from "./adPlans.js";
import { registerAdGroupTools } from "./adGroups.js";
import { registerBannerTools } from "./banners.js";
import { registerMediaTools } from "./media.js";
import { registerStatisticsTools } from "./statistics.js";
import { registerRawTool } from "./raw.js";

interface Annotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Registers every tool against a fake server, capturing each tool's annotations. */
function collectAnnotations(): Record<string, Annotations | undefined> {
  const annotations: Record<string, Annotations | undefined> = {};
  const server = {
    registerTool: (name: string, cfg: { annotations?: Annotations }) => {
      annotations[name] = cfg.annotations;
    },
  };
  const registrars = [
    registerAccountTools,
    registerAdPlanTools,
    registerAdGroupTools,
    registerBannerTools,
    registerMediaTools,
    registerStatisticsTools,
    registerRawTool,
  ];
  for (const register of registrars) register(server as any, {} as any);
  return annotations;
}

const ANN = collectAnnotations();

test("every tool declares annotations with openWorldHint", () => {
  const names = Object.keys(ANN);
  assert.ok(names.length >= 17, `expected all tools, got ${names.length}`);
  for (const [name, a] of Object.entries(ANN)) {
    assert.ok(a, `${name} is missing annotations`);
    assert.equal(a?.openWorldHint, true, `${name} should set openWorldHint`);
  }
});

test("read tools are read-only with all four hints set", () => {
  const readTools = [
    "get_user_info", "get_throttling", "get_regions",
    "list_ad_plans", "list_ad_groups", "list_banners", "get_statistics",
  ];
  for (const name of readTools) {
    assert.equal(ANN[name]?.readOnlyHint, true, `${name} should be readOnly`);
    // Some MCP clients require every hint on every tool, so reads set all four.
    assert.equal(ANN[name]?.destructiveHint, false, `${name} should not be destructive`);
    assert.equal(ANN[name]?.idempotentHint, true, `${name} should be idempotent`);
    assert.equal(ANN[name]?.openWorldHint, true, `${name} should set openWorldHint`);
  }
});

test("*_action and raw_request are flagged destructive", () => {
  const destructive = ["ad_plan_action", "ad_group_action", "banner_action", "raw_request"];
  for (const name of destructive) {
    assert.equal(ANN[name]?.readOnlyHint, false, `${name} should not be readOnly`);
    assert.equal(ANN[name]?.destructiveHint, true, `${name} should be destructive`);
  }
});

test("update tools are idempotent, non-destructive writes", () => {
  const updates = ["update_ad_plan", "update_ad_group", "update_banner"];
  for (const name of updates) {
    assert.equal(ANN[name]?.readOnlyHint, false, `${name} should not be readOnly`);
    assert.equal(ANN[name]?.destructiveHint, false, `${name} should not be destructive`);
    assert.equal(ANN[name]?.idempotentHint, true, `${name} should be idempotent`);
  }
});

test("create tools are non-destructive, non-idempotent writes", () => {
  const creates = ["create_ad_plan", "create_ad_group", "create_banner", "upload_image"];
  for (const name of creates) {
    assert.equal(ANN[name]?.readOnlyHint, false, `${name} should not be readOnly`);
    assert.equal(ANN[name]?.destructiveHint, false, `${name} should not be destructive`);
    assert.equal(ANN[name]?.idempotentHint, false, `${name} should not be idempotent`);
  }
});
