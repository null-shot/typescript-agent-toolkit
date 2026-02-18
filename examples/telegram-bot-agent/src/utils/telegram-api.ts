/**
 * Telegram API Utility
 *
 * Provides a shared Grammy Api instance for making Telegram Bot API calls
 * outside of Grammy handler context (cron jobs, notifications, logging).
 *
 * Usage:
 *   import { getTelegramApi } from "./telegram-api"
 *   const api = getTelegramApi(env.TELEGRAM_BOT_TOKEN)
 *   await api.sendMessage(chatId, text, { parse_mode: "HTML" })
 */

import { Api } from "grammy";

let cachedApi: Api | null = null;
let cachedToken: string | null = null;

/**
 * Get a Grammy Api instance for the given bot token.
 * The instance is cached per token — safe to call repeatedly.
 */
export function getTelegramApi(token: string): Api {
  if (cachedApi && cachedToken === token) {
    return cachedApi;
  }
  cachedApi = new Api(token);
  cachedToken = token;
  return cachedApi;
}
