# Инструменты

Сервер предоставляет типизированные инструменты для частых объектов VK Ads плюс универсальный `raw_request` для любого другого эндпоинта — так доступен **весь API**.

Иерархия объектов: **ad_plan** (кампания) → **ad_group** (группа) → **banner** (объявление).

## Аккаунт и справочники

| Инструмент | Что делает |
| --- | --- |
| `get_user_info` | Данные кабинета (`user.json`), в т.ч. `additional_info.client_name`. |
| `get_balance` | Баланс кабинета (`user.json`, поле `account`): доступные средства (`account.balance`) и валюта — в рублях, без микроединиц. |
| `get_throttling` | Текущие лимиты API и остаток (`throttling.json`). |
| `get_regions` | Поиск id регионов по подстроке названия (нужны для таргетинга групп). |

## Кампании, группы, объявления

| Инструмент | Что делает |
| --- | --- |
| `list_ad_plans` / `create_ad_plan` / `update_ad_plan` / `ad_plan_action` | Список, создание, обновление (имя, бюджеты, ставка, даты), смена статуса. |
| `list_ad_groups` / `create_ad_group` / `update_ad_group` / `ad_group_action` | Список, создание, обновление групп (бюджеты, ставка, `targetings`), смена статуса. |
| `list_banners` / `create_banner` / `update_banner` / `banner_action` | Список, создание, обновление объявлений (`textblocks`, `urls`, `content`), смена статуса. |

`*_action` принимает `action`: `activate` (status=`active`), `stop` (status=`blocked`), `delete` (status=`deleted`) и список `ids`.

## Статистика и универсальный вызов

| Инструмент | Что делает |
| --- | --- |
| `get_statistics` | Отчёты сервиса статистики v3 по `ad_plans` / `ad_groups` / `banners` с группировкой `day` / `week` / `month` / `summary`. Метрики — под ключом `base` (показы, клики, расход, …). |
| `raw_request` | Прямой вызов любого эндпоинта (`path`, `method`, `query`, `body`). GET свободен; POST/DELETE требуют `confirmWrite=true`. |

## Деньги, статусы и пагинация

- **Деньги** (`budget_limit`, `budget_limit_day`, `max_price`, `price`, расход в статистике) — в валюте кабинета (рублях), без пересчёта в микроединицы.
- **Статусы**: `status` (`active` / `blocked` / `deleted`) — единственный изменяемый; `delivery` (`delivering` / `not_delivering` / `pending`) и `moderation_status` (`allowed` / `banned` / `pending`) — только чтение, объясняют, почему объявление показывается или нет.
- **Пагинация**: списочные инструменты принимают `limit` (≤250) / `offset` и флаг `autoPaginate`, который проходит все страницы по `offset`/`count`. Фильтры по id/статусу передаются как `_id__in`, `_status__in` и т.п.

## Переменные окружения

| Переменная | Обяз. | По умолчанию | Описание |
| --- | --- | --- | --- |
| `VK_ADS_TOKEN` | да | — | OAuth2 access-токен VK Ads (Bearer). |
| `VK_ADS_LANG` | нет | `ru` | Заголовок `Accept-Language`. |
| `VK_ADS_TIMEOUT_MS` | нет | `60000` | Таймаут запроса, мс. |
| `VK_ADS_MAX_RETRIES` | нет | `3` | Повторы при временных ошибках (429, 5xx). |
| `VK_ADS_API_BASE` | нет | `https://ads.vk.com/api` | Корень API (без версии). |
