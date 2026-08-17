import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOCS_DIR = path.join(ROOT, "docs", "capabilities");

test("capability documentation has no broken local links", async () => {
  const files = (await readdir(DOCS_DIR)).filter((name) => name.endsWith(".md"));
  for (const file of files) {
    const source = await readFile(path.join(DOCS_DIR, file), "utf8");
    const links = [...source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
    for (const link of links) {
      if (/^(?:https?:|mailto:|#)/.test(link)) continue;
      const target = decodeURIComponent(link.split("#")[0]);
      assert.ok(target, `${file}: empty local link`);
      await access(path.resolve(DOCS_DIR, target));
    }
  }
});
