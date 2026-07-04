# Разработка

Требования: Node.js 20+.

```bash
npm install
npm run build      # сборка в dist/ (без тестов)
npm run dev        # запуск из исходников (tsx watch)
npm test           # юнит-тесты (без сети)
npm run typecheck  # проверка типов: исходники + тесты (без эмита)
```

## Локальный запуск из сборки

Вместо `npx` можно указать путь к собранному файлу:

```json
{
  "mcpServers": {
    "vk-ads": {
      "command": "node",
      "args": ["/абсолютный/путь/к/mcp-vk-ads/dist/index.js"],
      "env": { "VK_ADS_TOKEN": "ваш_токен" }
    }
  }
}
```

## Smoke-проверка (вживую, только чтение)

`npm run smoke` делает несколько **read-only** вызовов к кабинету из окружения
(данные аккаунта, лимиты API, первые кампании). Запись не выполняется. Запускайте
локально со своим токеном — никогда не кладите боевой токен в CI:

```bash
VK_ADS_TOKEN=ваш_токен npm run smoke
```

## Демо-GIF в README

`docs/demo.gif` — запись настоящей MCP-сессии: `docs/demo/run.mjs` поднимает
собранный сервер по stdio и делает реальные tools/call через официальный SDK,
а `docs/demo/mock-api.mjs` (подключается в процесс сервера через
`NODE_OPTIONS=--import`) подменяет глобальный `fetch` и отдаёт записанные
ответы VK Ads — токен и сеть не нужны. Перегенерация:

```bash
npm run build && vhs docs/demo.tape   # требуется vhs: brew install vhs
```

Важно: терминал vhs при настройках из `docs/demo.tape` — 97 колонок × 33 строки,
и капчер замирает при скролле буфера. Меняя сценарий или фикстуры, следите,
чтобы весь вывод помещался на один экран.

## CI

GitHub Actions прогоняет `typecheck` + `build` + `test` на Node 20/22/24 при push и pull request.
