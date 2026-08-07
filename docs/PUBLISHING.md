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
mcp-publisher logout                  # login поверх живого токена его не перевыпустит
mcp-publisher login github --token "$(gh auth token)"   # НЕ голый login — см. ниже
mcp-publisher publish                 # из корня репозитория (где лежит server.json)
```

> ⚠️ **Вход именно по токену, а не через device-flow.** `mcp-publisher login github` без
> `--token` авторизует OAuth-приложение реестра, а организация с политикой «Only approved
> applications can access data» такому приложению не видна — реестр получает пустой список
> организаций и отвечает `403 Forbidden: You have permission to publish:
> io.github.<личный-логин>/*`. Токен `gh` уже имеет scope `read:org` и организацию видит.
>
> Опознаётся по самому тексту 403: в нём перечислены доступные namespace. Если там **только
> личный** `io.github.<логин>/*` и ни одной организации — дело в способе входа. Публичность
> членства (`gh api -X PUT /orgs/<орг>/public_members/<логин>`) необходима, но её одной мало;
> проверить: `curl -s https://api.github.com/users/<логин>/orgs` должен показывать организацию.

### Обновление при новом релизе

1. Поднять версию в `package.json` → `npm publish`.
2. Синхронизировать `version` в `server.json` (в двух местах) с новой версией npm.
3. `mcp-publisher publish`.

## 2. LobeHub

1. Открыть [lobehub.com/mcp](https://lobehub.com/mcp) → **Submit MCP**.
2. Указать URL репозитория `https://github.com/askads/mcp-vk-ads`.
   LobeHub сам подтянет README, список инструментов и конфиг установки (`npx -y mcp-vk-ads`).
