// Законсервированный VK Ads API для README-демо: патчит глобальный fetch, так
// что настоящий код сервера проходит весь свой путь (Bearer-заголовки, ретраи,
// таймауты, парсинг), но ни один байт не уходит в сеть. Подключается в процесс
// сервера через NODE_OPTIONS=--import из docs/demo/run.mjs; продовый код не
// меняется. Цифры согласованы со сценарием в run.mjs.

// Имена кампаний короткие сознательно: терминал vhs при наших настройках — 95
// колонок, таблица отчёта должна помещаться без переносов.
const AD_PLANS = {
  count: 4,
  offset: 0,
  items: [
    {
      id: 21048765,
      name: "Конверсии | Пицца МСК",
      status: "active",
      vkads_status: "active",
      autobidding_mode: "max_goals",
      budget_limit: null,
      budget_limit_day: "4000.00",
      date_start: "2026-04-10",
      date_end: null,
      max_price: "0",
      objective: "site_conversions",
      created: "2026-04-10 12:03:11",
      updated: "2026-07-01 08:15:42",
    },
    {
      id: 21114032,
      name: "Ретаргет | Корзина",
      status: "active",
      vkads_status: "active",
      autobidding_mode: "max_goals",
      budget_limit: null,
      budget_limit_day: "1500.00",
      date_start: "2026-04-24",
      date_end: null,
      max_price: "0",
      objective: "site_conversions",
      created: "2026-04-24 15:40:07",
      updated: "2026-06-28 19:02:33",
    },
    {
      id: 21255879,
      name: "Трафик | Широкая РФ",
      status: "active",
      vkads_status: "active",
      autobidding_mode: "fixed",
      budget_limit: null,
      budget_limit_day: "3000.00",
      date_start: "2026-05-18",
      date_end: null,
      max_price: "12.00",
      objective: "traffic",
      created: "2026-05-18 10:11:56",
      updated: "2026-06-30 12:47:19",
    },
    {
      id: 21301244,
      name: "Лиды | Формы VK",
      status: "active",
      vkads_status: "active",
      autobidding_mode: "max_goals",
      budget_limit: null,
      budget_limit_day: "2000.00",
      date_start: "2026-06-02",
      date_end: null,
      max_price: "0",
      objective: "leadads",
      created: "2026-06-02 09:27:44",
      updated: "2026-07-02 11:30:08",
    },
  ],
};

// Сводка v3 statistics (grouping summary) за 2026-06-27..2026-07-03: метрики в
// `base`, spent/cpc/cpa — Decimal-строки в валюте кабинета (рубли). Арифметика
// сходится: ctr = clicks/shows, cpc = spent/clicks, cpa = spent/goals; `total` —
// сводка по всем объектам (65 290 ₽, 282 конверсии → CPA 231.52).
const STATISTICS = {
  count: 4,
  offset: 0,
  items: [
    { id: 21048765, total: { base: { shows: 46200, clicks: 1386, goals: 161, spent: "24150.00", ctr: 3.0, cpc: "17.42", cpa: "150.00" } } },
    { id: 21114032, total: { base: { shows: 18400, clicks: 736, goals: 74, spent: "8940.00", ctr: 4.0, cpc: "12.15", cpa: "120.81" } } },
    { id: 21255879, total: { base: { shows: 612300, clicks: 1837, goals: 2, spent: "19800.00", ctr: 0.3, cpc: "10.78", cpa: "9900.00" } } },
    { id: 21301244, total: { base: { shows: 74500, clicks: 894, goals: 45, spent: "12400.00", ctr: 1.2, cpc: "13.87", cpa: "275.56" } } },
  ],
  total: { base: { shows: 751400, clicks: 4853, goals: 282, spent: "65290.00", ctr: 0.646, cpc: "13.45", cpa: "231.52" } },
};

// user.json с полем account — кошелёк кабинета: balance = Decimal-строка в
// валюте (рубли, НЕ микроединицы). 46 800 ₽ при расходе ~9 330 ₽/день ≈ 5 дней.
const USER = {
  id: 18923341,
  username: "ads@pizza-msk.ru",
  account: { id: 8123001, type: "general", balance: "46800.00", currency: "RUB" },
  currency: "RUB",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function apiError(detail) {
  // Object-style ошибка VK Ads со статусом 400 (не transient → без ретраев):
  // сервер покажет её как обычный tool-error — если сценарий демо уехал от
  // фикстур, это видно сразу, а в реальную сеть запрос не уходит.
  return json({ error: { code: "not_mocked_in_demo", message: detail } }, 400);
}

const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));

  if (url.host === "ads.vk.com") {
    if (url.pathname === "/api/v2/ad_plans.json") return json(AD_PLANS);
    if (url.pathname === "/api/v3/statistics/ad_plans/summary.json") return json(STATISTICS);
    if (url.pathname === "/api/v3/user.json") return json(USER);
    return apiError(`${init?.method ?? "GET"} ${url.pathname}`);
  }

  return realFetch(input, init);
};
