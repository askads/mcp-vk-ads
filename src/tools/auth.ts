import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TokenStore } from "../auth.js";
import type { VkAdsClient } from "../client.js";
import { API_SETTINGS_URL, MAX_ACTIVE_TOKENS } from "../oauth.js";
import { fail, ok, READ_ONLY, WRITE_DELETE, WRITE_UPDATE } from "./util.js";

/**
 * The in-chat login. Two steps because the user has to leave for the cabinet in
 * between: `start_login` hands out the instructions, `finish_login` takes the app
 * credentials they bring back and mints the token here.
 *
 * VK Ads gives its browser-consent flow (`authorization_code`) only to approved
 * partners, so this is the flow every user can actually run: their own app, their
 * own token. The secret has to be stored because VK requires it on every refresh —
 * the file is owner-only, and `logout` deletes it.
 */
export function registerAuthTools(
  server: McpServer,
  client: VkAdsClient,
  tokens: TokenStore,
): void {
  server.registerTool(
    "auth_status",
    {
      title: "Статус подключения к VK Рекламе",
      annotations: READ_ONLY,
      description:
        "Показывает, подключена ли VK Реклама: есть ли токен, откуда он взят (переменная окружения VK_ADS_TOKEN или сохранённый вход), когда истекает, какой client_id и аккаунт за ним стоят и где лежит файл с сохранёнными данными. Ничего не отправляет в сеть, не показывает ни токен, ни client_secret. Вызовите это, если инструменты VK Рекламы отвечают, что подключение не настроено.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(tokens.status());
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "start_login",
    {
      title: "Начать подключение VK Рекламы",
      annotations: READ_ONLY,
      description:
        "Первый шаг подключения VK Рекламы без правки конфигурации и без перезапуска клиента. Ничего не отправляет в сеть — возвращает инструкцию, которую нужно показать пользователю целиком: где в кабинете создать приложение и откуда скопировать client_id и client_secret. Полученную пару передайте в finish_login. Предупредите, что client_secret — это пароль от рекламного кабинета: он сохранится на диске только для владельца и нужен, чтобы продлевать токен.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok({
          settingsUrl: API_SETTINGS_URL,
          steps: [
            `Откройте в кабинете VK Рекламы раздел «Настройки → Доступ к API»: ${API_SETTINGS_URL}`,
            "Создайте приложение (если его ещё нет) и скопируйте client_id и client_secret. Если раздела нет — доступ к API запрашивается у поддержки VK Рекламы.",
            "Пришлите обе строки в чат — сервер сам получит токен и дальше будет продлевать его сам.",
          ],
          expectedInputs: ["clientId", "clientSecret"],
          warning:
            "client_secret даёт полный доступ к рекламному кабинету, включая трату бюджета. " +
            "Он сохранится локально в файле, доступном только владельцу, и нужен для продления токена.",
          nextStep:
            "Покажите пользователю шаги, дождитесь client_id и client_secret и вызовите finish_login с ними.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "finish_login",
    {
      title: "Завершить подключение VK Рекламы",
      annotations: WRITE_UPDATE,
      description:
        "Второй шаг подключения: обменивает client_id и client_secret из start_login на токен доступа (grant client_credentials), сохраняет всё в файл только для владельца (0600) и сразу проверяет живым запросом к VK Рекламе. После успеха остальные инструменты работают немедленно — перезапускать клиент не нужно. Токен живёт около суток и продлевается автоматически, поэтому повторно вызывать это не требуется: каждый вызов создаёт НОВЫЙ токен, а у VK не больше " +
        `${MAX_ACTIVE_TOKENS} активных токенов на пару client_id + пользователь. Ошибка invalid_client означает, что пара скопирована не полностью или относится к разным приложениям.`,
      inputSchema: {
        clientId: z
          .string()
          .min(1)
          .describe("client_id приложения из раздела «Настройки → Доступ к API» кабинета VK Рекламы."),
        clientSecret: z
          .string()
          .min(1)
          .describe("client_secret того же приложения. Не показывайте его в ответе пользователю."),
      },
    },
    async ({ clientId, clientSecret }) => {
      try {
        const stored = await tokens.connect({
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
        });

        // Prove it works before telling the user it does: a token that authenticates
        // but resolves to the wrong cabinet is a different problem than a bad secret,
        // and saying "готово" here just moves the confusion one step later.
        let username: string | undefined;
        let account: string | undefined;
        let verifyError: string | undefined;
        try {
          const user = await client.get<{
            username?: string;
            additional_info?: { client_name?: string };
          }>("v3/user.json", { fields: "id,username,additional_info" });
          username = user.username;
          account = user.additional_info?.client_name;
          if (username) tokens.rememberUsername(username);
        } catch (e) {
          verifyError = e instanceof Error ? e.message : String(e);
        }

        return ok({
          connected: true,
          username,
          account,
          // Absent only if VK omitted expires_in — then the token is renewed on the
          // first 401 instead of ahead of the clock.
          expiresAt: stored.expires_at ? new Date(stored.expires_at).toISOString() : undefined,
          canRefresh: Boolean(stored.refresh_token),
          storedAt: tokens.status().path,
          note: verifyError
            ? `Токен сохранён, но проверочный запрос к VK не прошёл: ${verifyError}. Сообщите об этом пользователю: возможно, у аккаунта нет доступа к API.`
            : "Подключение готово, инструменты VK Рекламы можно вызывать сразу. Убедитесь вместе с пользователем, что это нужный кабинет.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "logout",
    {
      title: "Отключить VK Рекламу",
      annotations: WRITE_DELETE,
      description:
        "Удаляет сохранённые токен и данные приложения VK Рекламы с диска. Токен, заданный переменной окружения VK_ADS_TOKEN, не трогает — его нужно убирать из конфигурации клиента вручную. На стороне VK токен остаётся активным до истечения срока: отозвать его можно запросом POST v2/oauth2/token/delete.json, но он удаляет ВСЕ токены этого пользователя для данного client_id, поэтому здесь не вызывается.",
      inputSchema: {},
    },
    async () => {
      try {
        const removed = tokens.logout();
        return ok({
          removed,
          note: removed
            ? "Сохранённые данные подключения удалены."
            : "Сохранённого подключения не было — удалять нечего.",
          envTokenStillSet: tokens.status().source === "env",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
