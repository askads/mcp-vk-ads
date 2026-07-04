# Demo GIF для README: настоящая MCP-сессия по stdio с настоящим сервером
# (dist/index.js) — хендшейк, tools/list и tools/call идут через официальный SDK.
# Единственная подмена: ответы VK Ads API законсервированы в
# docs/demo/mock-api.mjs, поэтому демо не требует токена и не ходит в сеть.
#
# Перегенерация:
#   npm run build && vhs docs/demo.tape
#
# Требуется: vhs (https://github.com/charmbracelet/vhs).
#
# ВАЖНО: при этих настройках терминал vhs — 95 колонок × 32 строки, и капчер
# замирает при скролле буфера. Весь вывод сценария обязан помещаться на один
# экран: не удлиняйте текст/таблицы, не сузив что-то другое.

Output docs/demo.gif

Set Shell bash
Set FontSize 15
Set FontFamily "Menlo"
Set Width 1000
Set Height 610
Set Padding 12
Set Framerate 20
Set Theme "Catppuccin Mocha"

Hide
Type `node docs/demo/run.mjs` Enter
Wait+Screen@15s /инструментов/
Show

# Драйвер сам «печатает» вопрос и ведёт сценарий; ждём финальную строку ответа.
Wait+Screen@60s /пополнить счёт/
Sleep 5s
