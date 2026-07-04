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
# ВАЖНО: при этих настройках терминал vhs — 97 колонок × 33 строки, и капчер
# замирает при скролле буфера. Весь вывод сценария обязан помещаться на один
# экран: не удлиняйте текст/таблицы, не сузив что-то другое.

Output docs/demo.gif

Set Shell bash
Set FontSize 15
Set Width 1060
Set Height 700
Set Padding 14
Set Margin 18
Set MarginFill "#f4f1eb"
Set WindowBar Colorful
Set BorderRadius 10
Set Framerate 20
# Палитра и окно — дизайн-токены askads.ru (web/app/globals.css): бумага #f4f1eb,
# поверхность #fbfaf7, текст #2b2722, акцент #d97757. Шрифт не задаём: дефолт
# vhs = JetBrains Mono — тот же моноширинный шрифт, что на сайте (--font-mono).
Set Theme { "name": "Ask Ads", "background": "#fbfaf7", "foreground": "#2b2722", "cursor": "#d97757", "selection": "#fbeee7", "black": "#1c1917", "red": "#c2453d", "green": "#2f8f6b", "yellow": "#a8801f", "blue": "#229ed9", "magenta": "#c25e3d", "cyan": "#d97757", "white": "#57514b", "brightBlack": "#8a847d", "brightRed": "#c2453d", "brightGreen": "#2f8f6b", "brightYellow": "#a8801f", "brightBlue": "#229ed9", "brightMagenta": "#c25e3d", "brightCyan": "#d97757", "brightWhite": "#1c1917" }

Hide
Type `node docs/demo/run.mjs` Enter
Wait+Screen@15s /инструментов/
Show

# Драйвер сам «печатает» вопрос и ведёт сценарий; ждём финальную строку ответа.
Wait+Screen@60s /пополнить счёт/
Sleep 5s
