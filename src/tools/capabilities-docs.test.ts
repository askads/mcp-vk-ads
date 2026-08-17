import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

interface Annotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}

interface Registration {
  name: string;
  title?: string;
  description?: string;
  annotations?: Annotations;
}

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TOOLS_DIR, "../..");
const DOCS_DIR = path.join(ROOT, "docs", "capabilities");
const REQUIRED_HEADINGS = [
  "## Какую задачу решает",
  "## Когда использовать",
  "## Что нужно передать",
  "## Что вернёт",
  "## Что изменится",
  "## Пример запроса",
  "## Возможные ошибки и ограничения",
  "## Связанные MCP-инструменты",
  "## Технические сведения"
];
const FORBIDDEN_INTERNAL_TERMS = /\b(?:Core Job|Big Job|Small Job|Micro Job|Critical Chain of Jobs|AJTBD|Next Move Theory|RAT)\b/;

function slug(name: string): string {
  return name.replaceAll("_", "-");
}

function expectedImpact(annotations: Annotations | undefined): string {
  if (annotations?.readOnlyHint) return "только чтение";
  if (annotations?.destructiveHint) return "опасная операция";
  return "изменяет данные";
}

async function collectRegistrations(): Promise<Registration[]> {
  const files = (await readdir(TOOLS_DIR))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort();
  const registrations: Registration[] = [];
  const server = {
    registerTool(name: string, config: Omit<Registration, "name">) {
      registrations.push({ name, ...config });
    },
  };
  for (const file of files) {
    const module = await import(pathToFileURL(path.join(TOOLS_DIR, file)).href);
    for (const [name, exported] of Object.entries(module)) {
      if (typeof exported !== "function" || !/^register[A-Z].*Tools?$/.test(name)) continue;
      await (exported as (...args: unknown[]) => unknown)(server, {}, {}, {}, {});
    }
  }
  return [...new Map(registrations.map((item) => [item.name, item])).values()];
}

test("every registered MCP tool has one complete capability page", async () => {
  const registrations = (await collectRegistrations()).sort((a, b) => a.name.localeCompare(b.name));
  const index = await readFile(path.join(DOCS_DIR, "index.md"), "utf8");
  const files = (await readdir(DOCS_DIR)).filter((name) => name.endsWith(".md") && name !== "index.md").sort();
  assert.deepEqual(files, registrations.map((tool) => `${slug(tool.name)}.md`).sort());

  const openingLines = new Set<string>();
  for (const tool of registrations) {
    const filename = `${slug(tool.name)}.md`;
    const page = await readFile(path.join(DOCS_DIR, filename), "utf8");
    assert.match(page, /MCP-инструмент \(tool\)/, `${tool.name}: category phrase`);
    assert.match(page, /> Я хочу [^\n]+/, `${tool.name}: user task`);
    assert.ok(page.includes("Техническое имя: " + String.fromCharCode(96) + tool.name + String.fromCharCode(96)), `${tool.name}: technical name`);
    assert.ok(page.includes("**Воздействие:** " + expectedImpact(tool.annotations)), `${tool.name}: impact`);
    for (const heading of REQUIRED_HEADINGS) assert.ok(page.includes(heading), `${tool.name}: missing ${heading}`);
    assert.doesNotMatch(page, FORBIDDEN_INTERNAL_TERMS, `${tool.name}: internal methodology leaked`);
    assert.ok(index.includes(`./${filename}`), `${tool.name}: missing from index`);
    const opening = page.split("\n").find((line) => line.startsWith("**") && line.includes(":"));
    assert.ok(opening, `${tool.name}: opening summary`);
    assert.ok(!openingLines.has(opening), `${tool.name}: duplicate opening summary`);
    openingLines.add(opening);
  }
});
