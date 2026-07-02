# Changelog

Все заметные изменения проекта документируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.0.0/),
проект придерживается [семантического версионирования](https://semver.org/lang/ru/).

## [Unreleased]

## [1.2.0] — 2026-07-02

### Добавлено
- Тул `get_balance` (баланс кабинета через `user.json`, `account.balance`, рубли) —
  read-only, возвращает сырой ответ VK (доступные средства + валюта), без пересчёта в
  микроединицы.

## [1.1.4] — 2026-07-02

### Безопасность
- `raw_request` / HTTP-клиент: SSRF-гард в `buildUrl` — абсолютный `path`
  (`https://…`, `http://…` или бэкслеш-форма `\\…`) больше не может перебить базовый
  origin и увести Bearer-токен на чужой хост; такой путь отклоняется до запроса.

### Исправлено
- Ретраи разделены по идемпотентности: 429 повторяется для любого метода (запрос не
  обработан), а 5xx **и сетевые ошибки/таймауты** — только для `GET`. Повтор `POST`
  после 502/504 больше не может создать дубль (`create_ad_plan/group/banner`).
- Таймаут запроса теперь покрывает и чтение тела ответа: `fetchWithTimeout` читает
  `res.text()` внутри охраняемой зоны и снимает таймер только после этого.

### Добавлено
- `autoPaginate`: кэп на размер ответа — не более `MAX_AUTO_ITEMS` (1000) объектов,
  лишнее обрезается с явной пометкой `_truncated` («returned the first N of M»).
- `get_regions`: кэш статичного справочника регионов (одна загрузка на процесс).
- `server.json`: описаны переменные `VK_ADS_TIMEOUT_MS` и `VK_ADS_MAX_RETRIES`.

### Изменено
- Вывод тулов — компактный JSON (без pretty-print) для экономии токенов; guard от
  `JSON.stringify(undefined)`.
- Аннотация `READ_ONLY` выставляет все четыре хинта
  (`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`) — часть клиентов
  (напр. ревью OpenAI Apps) требует их на каждом туле.
- `isoDate` — фабрика (`isoDate()`), чтобы каждая схема получала свой zod-объект и в
  JSON-схеме не появлялся общий `$ref` (не все клиенты его разыменовывают).

### Удалено
- Мёртвый хелпер `clampLimit` (тулы ограничивают `limit` через zod `.max(250)`).

### Документация
- Требования и CI приведены к факту: Node.js 20+, матрица CI 20/22/24.

## [1.1.3] — 2026-06-29

### Изменено
- Унифицирован `title` в реестре MCP (`server.json`) — «VK Ads MCP» (совпадает с
  заголовком README). Код пакета не изменился.

## [1.1.2] — 2026-06-27

### Добавлено
- `server.json` + поле `mcpName` (`io.github.askads/mcp-vk-ads`) и `docs/PUBLISHING.md`
  — листинг сервера в реестре MCP. Код пакета не изменился.

## [1.1.1] — 2026-06-27

### Изменено
- Репозиторий переехал в организацию `askads`: обновлены ссылки (`repository`/`homepage`/
  `bugs`, README, CHANGELOG). Код пакета не изменился.

## [1.1.0] — 2026-06-24

### Добавлено
- MCP-аннотации (`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`)
  на всех тулах — клиент MCP может авто-подтверждать чтение и предупреждать перед записью.

### Исправлено
- Сервер сообщает MCP-клиентам реальную версию из `package.json` (была захардкожена `1.0.0`).

### Изменено
- Публикуемый пакет уменьшен: чистка `dist/` перед сборкой, без source maps и `.d.ts`,
  dev-скрипт `smoke` исключён из сборки.

## [1.0.1] — 2026-06-18

### Изменено
- `get_statistics`: группировка `summary` по умолчанию (одна агрегированная строка на
  объект), серверная сортировка (`sortBy`/`order`) и «громкая» ошибка при фильтре по ids
  с нулём объектов вместо тихого пустого ответа.

## [1.0.0] — 2026-06-15

### Добавлено
- Первый релиз. MCP-сервер для VK Ads (VK Реклама): тулы для рекламных кампаний
  (`ad_plans`), групп (`ad_groups`) и объявлений (`banners`) — список/создание/обновление
  и lifecycle-действия (activate/stop/delete), статистика, справочники (регионы),
  `raw_request` (escape hatch на любой эндпойнт), пагинация (offset + авто по offset/count).

[Unreleased]: https://github.com/askads/mcp-vk-ads/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/askads/mcp-vk-ads/compare/v1.1.4...v1.2.0
[1.1.4]: https://github.com/askads/mcp-vk-ads/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/askads/mcp-vk-ads/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/askads/mcp-vk-ads/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/askads/mcp-vk-ads/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/askads/mcp-vk-ads/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/askads/mcp-vk-ads/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/askads/mcp-vk-ads/releases/tag/v1.0.0
