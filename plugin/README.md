# VK Ads MCP

Work with a VK Ads account from Claude: campaigns, ad groups, ads and performance statistics.

This plugin is an **unofficial, third-party client** maintained by gistrec, part of the
AskAds line of MCP servers. It is not affiliated with, endorsed by, or operated by the
owner of the API it talks to.

## What the plugin does

Enabling the plugin registers one MCP server named `vk-ads`. Claude Code starts it by
running `npx -y mcp-vk-ads@1.5.0`, which downloads that exact published version of the
`mcp-vk-ads` npm package and runs it on your machine. The version is pinned, so the plugin never
pulls a newer release without an update to this plugin.

The server talks to the VK Ads API (ads.vk.com) over HTTPS, using the credentials you enter when the plugin
is enabled. It sends nothing to AskAds except the telemetry described below.

## What it needs from you

The plugin asks for its credentials through the plugin configuration dialog, not through
environment variables, so nothing has to be exported in your shell. Sensitive values go to
your operating system's credential store rather than to `settings.json`.

- **VK Ads access token** (required) — Access token for the VK Ads API. Stored in your operating system's credential store, never in settings.json. Stored securely.
- **Anonymous telemetry** — Set to 0 to disable the anonymous usage telemetry the server sends by default. Leave as 1 to keep it on.

## Telemetry

The underlying server sends anonymous technical events by default: a random installation
identifier, the name of the tool that was called, and the versions of the server, the AI
app, Node.js and the operating system. Your access token, your account data, tool arguments
and the names and values of environment variables are **not** sent. Set the
**Anonymous telemetry** option to `0` to turn it off.

## Privacy

[Privacy policy](https://askads.ru/privacy-policy).

The plugin stores no data of its own. Your credentials go to your operating system's
credential store. When you sign in from the conversation instead, the server writes the
token to `~/.config/mcp-vk-ads/credentials.json` with owner-only permissions. Data read from
the API is passed to your AI app and is never written to disk.

## Skills

`vk-ads-audit` — Audit a VK Ads account: pull campaign, group and ad statistics over one wide period and read them against the account currency and the API's paging limits.

## Source and license

Source: https://github.com/askads/mcp-vk-ads. Released under the MIT license.
