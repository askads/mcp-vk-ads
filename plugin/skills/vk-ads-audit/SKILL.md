---
name: vk-ads-audit
description: Audit a VK Ads account: pull campaign, group and ad statistics over one wide period and read them against the account currency and the API's paging limits.
---

# VK Ads MCP

## What this server covers

VK Ads campaigns, ad groups, ads and their statistics. Reading is safe; budget and bid
changes spend real money.

## Before the first call

Confirm the token works and the account is the one you expect. A token scoped to an
agency account reports the agency's own objects, not the client's.

## Pulling statistics

Request **one wide period** instead of looping day by day or campaign by campaign. Each
call costs quota, and a single wide request returns the same numbers as many narrow ones.

Money values come back in the account currency. Do not mix currencies when you sum across
accounts.

## Paging

Prefer a large `limit` over many small pages. When a list comes back truncated, the server
says so explicitly rather than hiding it — carry on paging instead of treating the partial
list as complete.

## Writes

Budget and bid changes take effect immediately and are not reversible by the server. State
the current value, the new value and the affected object before applying a change, and
apply changes one object at a time so a partial failure is readable.

