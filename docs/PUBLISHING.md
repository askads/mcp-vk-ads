# Публикация и листинг сервера

Как попасть в каталоги MCP, чтобы сервер находили из Claude, Cursor, LobeHub и др.

Канонический источник — **официальный реестр MCP** (`registry.modelcontextprotocol.io`).

## 1. Официальный реестр MCP

Манифест уже лежит в корне репозитория — [`server.json`](../server.json)
(схема `2025-12-11`, имя namespace `io.github.askads/mcp-vk-ads`).

### Что проверяет реестр

- **Namespace** — имя `io.github.askads/*` подтверждается входом под GitHub-аккаунтом с
  доступом к организации `askads` (членство в орг должно быть **публичным**).
- **Владение npm-пакетом** — в `package.json` опубликованного пакета должно быть поле
  `mcpName` со значением `io.github.askads/mcp-vk-ads`. Реестр сверяет его с `name` из `server.json`.

> ⚠️ Перед публикацией в реестр пакет с полем `mcpName` должен быть уже в npm. Версии в
> `server.json` (корень и `packages[].version`) должны совпадать с опубликованной версией npm.

### Шаги

```bash
brew install mcp-publisher            # или бинарь из релизов modelcontextprotocol/registry
mcp-publisher login github            # вход под аккаунтом-владельцем namespace
mcp-publisher publish                 # из корня репозитория (где лежит server.json)
```

### Обновление при новом релизе

1. Поднять версию в `package.json` → `npm publish`.
2. Синхронизировать `version` в `server.json` (в двух местах) с новой версией npm.
3. `mcp-publisher publish`.

## 2. LobeHub

1. Открыть [lobehub.com/mcp](https://lobehub.com/mcp) → **Submit MCP**.
2. Указать URL репозитория `https://github.com/askads/mcp-vk-ads`.
   LobeHub сам подтянет README, список инструментов и конфиг установки (`npx -y mcp-vk-ads`).
