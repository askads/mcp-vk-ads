# VK Ads MCP

[![npm](https://img.shields.io/npm/v/mcp-vk-ads)](https://www.npmjs.com/package/mcp-vk-ads)
[![CI](https://github.com/askads/mcp-vk-ads/actions/workflows/ci.yml/badge.svg)](https://github.com/askads/mcp-vk-ads/actions/workflows/ci.yml)
[![Glama](https://glama.ai/mcp/servers/askads/mcp-vk-ads/badges/score.svg)](https://glama.ai/mcp/servers/askads/mcp-vk-ads)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

MCP-сервер для **VK Ads (VK Реклама)**: управляйте рекламой из Claude, Cursor, Codex и других AI-клиентов на естественном языке.

Ассистент сам собирает данные из статистики, кампаний, групп и объявлений, находит закономерности и вносит правки — то, что в кабинете VK Ads приходится делать вручную и по одному экрану.

## Что умеет

- **Кампании, группы, объявления** — рекламные планы (`ad_plans`), группы (`ad_groups`) и объявления (`banners`): список, создание, обновление, статусы.
- **Статистика** — отчёты сервиса статистики v3 по планам, группам и объявлениям с группировкой по дням/неделям/месяцам.
- **Универсальный `raw_request`** — прямой вызов любого эндпоинта VK Ads, так доступен весь API.
- **Запись только по подтверждению** — в `raw_request` любой не-GET (POST/DELETE) требует явного `confirmWrite=true`.
- **Деньги в валюте кабинета** — бюджеты, ставки и расход — в валюте аккаунта (рублях), без пересчёта; `get_balance` показывает доступный баланс кабинета.
- **`autoPaginate`** — проход всех страниц по `offset`/`count`, без молчаливой обрезки на больших аккаунтах.
- **Устойчивость** — ретраи с бэкоффом на лимитах (429) и 5xx, таймаут запроса; `get_throttling` показывает остаток лимитов API.

## Примеры запросов

Попросите ассистента на русском — например:

- «Покажи статистику по кампаниям за последние 7 дней»
- «Какие объявления тратят бюджет, но не приносят конверсий?»
- «Останови все объявления, которые не прошли модерацию»
- «Найди id региона Москва»
- «Подними дневной бюджет кампании 12345 до 5000 ₽»

## Быстрая установка

Разверните своего клиента:

<details>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add vk-ads -e VK_ADS_TOKEN=ваш_токен -- npx -y mcp-vk-ads
```

</details>

<details>
<summary><b>Claude Desktop</b></summary>

`claude_desktop_config.json` — macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`

```json
{
  "mcpServers": {
    "vk-ads": {
      "command": "npx",
      "args": ["-y", "mcp-vk-ads"],
      "env": { "VK_ADS_TOKEN": "ваш_токен" }
    }
  }
}
```

</details>

<details>
<summary><b>Cursor</b></summary>

`~/.cursor/mcp.json` (или `.cursor/mcp.json` в проекте)

```json
{
  "mcpServers": {
    "vk-ads": {
      "command": "npx",
      "args": ["-y", "mcp-vk-ads"],
      "env": { "VK_ADS_TOKEN": "ваш_токен" }
    }
  }
}
```

</details>

<details>
<summary><b>OpenAI Codex</b></summary>

Командой: `codex mcp add vk-ads --env VK_ADS_TOKEN=ваш_токен -- npx -y mcp-vk-ads`

Или в `~/.codex/config.toml`:

```toml
[mcp_servers.vk-ads]
command = "npx"
args = ["-y", "mcp-vk-ads"]

[mcp_servers.vk-ads.env]
VK_ADS_TOKEN = "ваш_токен"
```

</details>

<details>
<summary><b>VS Code</b></summary>

`.vscode/mcp.json` — ключ `servers` (не `mcpServers`)

```json
{
  "servers": {
    "vk-ads": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-vk-ads"],
      "env": { "VK_ADS_TOKEN": "ваш_токен" }
    }
  }
}
```

</details>

## Получение токена

VK Ads API использует OAuth2, и — в отличие от Яндекс Директа — единой ссылки «получить токен» нет: нужен доступ к API и приложение (`client_id` / `client_secret`).

1. Получите доступ к VK Ads API и заведите приложение в кабинете VK Ads (раздел доступа к API) — при необходимости через поддержку.
2. Пройдите OAuth2-флоу с нужными правами (`create_ads`, `read_ads`, `read_clients`, `read_manager_clients`) и получите `access_token` (Bearer). Подробности — в [документации VK Ads API](https://ads.vk.com/doc/api).
3. Скопируйте `access_token` в переменную `VK_ADS_TOKEN`.

⚠️ Токен даёт доступ к рекламному кабинету (включая трату бюджета) и хранится **открытым текстом** в конфиге клиента — относитесь к нему как к паролю. Токены VK Ads недолговечны: когда `access_token` истечёт, обновите его по `refresh_token` и пропишите заново.

## Настройка

| Переменная | Обяз. | По умолчанию | Описание |
|---|---|---|---|
| `VK_ADS_TOKEN` | да | — | OAuth2 access-токен VK Ads (Bearer). |
| `VK_ADS_LANG` | нет | `ru` | Заголовок `Accept-Language`. |
| `VK_ADS_TIMEOUT_MS` | нет | `60000` | Таймаут запроса, мс. |
| `VK_ADS_MAX_RETRIES` | нет | `3` | Повторы при временных ошибках (429, 5xx). |
| `VK_ADS_API_BASE` | нет | `https://ads.vk.com/api` | Корень API (без версии). |

Полный список инструментов — в [docs/TOOLS.md](https://github.com/askads/mcp-vk-ads/blob/main/docs/TOOLS.md).

## Требования

- Node.js 20+ (запускается через `npx`, отдельная установка не нужна).
- Access-токен VK Ads — см. [Получение токена](#получение-токена).

## Ограничения

- Токены VK Ads истекают — при ошибке `invalid_token` обновите токен и пропишите заново.
- Песочницы у VK Ads нет: все вызовы идут в боевой кабинет. Записи через `raw_request` защищены `confirmWrite`, но типизированные `*_action`/`update_*` меняют данные сразу.
- Создание групп и объявлений требует корректных структур `targetings` / `content` / `textblocks` / `urls` — их формат зависит от формата рекламы (см. документацию VK Ads).

## Документация

- [Все инструменты](https://github.com/askads/mcp-vk-ads/blob/main/docs/TOOLS.md) — полный список с описанием.
- [Разработка](https://github.com/askads/mcp-vk-ads/blob/main/docs/DEVELOPMENT.md) — сборка, тесты, smoke-проверка.

## Поддержка

Вопросы, идеи и доработки — пишите в Telegram: [@gistrec](http://t.me/gistrec).

## Лицензия

MIT — см. [LICENSE](./LICENSE).
