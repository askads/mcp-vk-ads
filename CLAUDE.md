# CLAUDE.md — mcp-vk-ads

MCP server for the VK Ads (VK Реклама) API (TypeScript, stdio). Tools wrap the REST
endpoints; `raw_request` is the escape hatch for everything without a dedicated tool.

## Commands

```bash
npm run dev        # run from source (tsx watch)
npm test           # unit tests, no network
npm run typecheck  # types for src + tests
npm run build      # emit dist/
npm run smoke      # live READ-ONLY calls (needs VK_ADS_TOKEN)
```

More detail in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Tool list: [docs/TOOLS.md](docs/TOOLS.md).

## Architecture

- `src/client.ts` — HTTP client over `https://ads.vk.com/api` (override with
  `VK_ADS_API_BASE`): Bearer auth, AbortController timeout, retry/backoff on 429 + 5xx
  (honors `Retry-After`), `getAll` offset/count pagination, `VkAdsError(status, body)`.
  No sandbox, no quota header, no async report polling.
- `src/tools/*.ts` — one file per area (`account`, `adPlans`, `adGroups`, `banners`,
  `statistics`, `raw`), each exports `register<Name>Tools(server, client)`.
- `src/tools/util.ts` — shared helpers (see conventions below).
- `src/index.ts` — wires every `register*` into the McpServer.
- `src/config.ts` — env → config.

## Conventions (do not break)

- **Money is in account currency (rubles) as the API returns it** — VK Ads has no
  micro-units, so there is nothing to convert; pass and return amounts as-is.
- **Status changes loop per object via `setStatusForIds`,** not a batch call — VK Ads
  mutates one object per `POST v2/{entity}/{id}.json`. Any per-id failure surfaces the
  whole result as `isError`.
- **`raw_request` is read-gated by HTTP method:** GET runs freely; any POST/DELETE is a
  write and requires `confirmWrite=true` (`isReadMethod` is true only for GET).
- **Validate inputs with zod** in `inputSchema` (dates via the shared `isoDate`).
- **Pagination:** single-page tools clamp to `MAX_PAGE_LIMIT` (250) with `clampLimit`;
  `autoPaginate` uses `getAll` at `MAX_PAGE_LIMIT` and flags `_truncated` instead of
  silently cutting.
- **Runtime guidance for the consuming model goes in the tool `description`,** not in this
  file — the external agent never reads CLAUDE.md. API gotchas belong in the tool's description.

## Adding a tool

1. Add (or extend) `src/tools/<name>.ts` with `register<Name>Tools(server, client)`.
2. Import and call it in `src/index.ts`.
3. Add a `*.test.ts` using the mock-fetch / fake-client harness (no network).
4. Document the tool in `docs/TOOLS.md`.
5. `npm run typecheck && npm test`.

## Safety

- Tools hit a **real ad account with real money,** and VK Ads has **no sandbox.** `smoke`
  is read-only by design; never put a long-lived production token in CI — `health.yml`
  mints a short-lived own-account token via the `client_credentials` grant.

## Releasing

Keep the version in sync across **all** channels in one go — publishing to npm alone silently
drifts from the rest (`git push --follow-tags` pushes the tag but does **not** create a GitHub
Release; the registry is immutable per version, so even a metadata-only change needs a bump):

1. Bump `version` in `package.json` **and** `server.json` (root + `packages[].version`)
   together. `mcpName` in `package.json` must match `name` in `server.json`.
2. `npm publish` (runs typecheck + tests + build via `prepublishOnly` / `prepare`).
3. `git commit`, `git tag -a vX.Y.Z -m vX.Y.Z`, `git push origin main --follow-tags`.
4. **GitHub Release:** `gh release create vX.Y.Z --title vX.Y.Z --generate-notes --verify-tag`.
5. **Official MCP registry:** `mcp-publisher publish` (this package **is** in the registry as
   `io.github.askads/mcp-vk-ads`).
