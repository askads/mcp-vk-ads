# Changelog

Все заметные изменения проекта документируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.0.0/),
проект придерживается [семантического версионирования](https://semver.org/lang/ru/).

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

[1.1.2]: https://github.com/askads/mcp-vk-ads/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/askads/mcp-vk-ads/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/askads/mcp-vk-ads/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/askads/mcp-vk-ads/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/askads/mcp-vk-ads/releases/tag/v1.0.0
