/**
 * Telegram Routes (re-export)
 *
 * Re-exports the shared telegram routes module from telegram-bot-agent,
 * configured with this project's agent namespace mapping.
 */

import { setupTelegramRoutes as _setupTelegramRoutes } from "../../telegram-bot-agent/src/dashboard/telegram-routes";
import type { TelegramRoutesConfig } from "../../telegram-bot-agent/src/dashboard/telegram-routes";
import type { Hono } from "hono";

export type { TelegramRoutesConfig };

/**
 * Register all telegram routes with single-worker's agent namespace config.
 */
export function setupTelegramRoutes(app: Hono<{ Bindings: Env }>): void {
  _setupTelegramRoutes(app, {
    getAgentNamespaces: (env) => ({
      dependent: env.DEPENDENT_AGENT,
    }),
    getDefaultNamespace: (env) => env.SIMPLE_PROMPT_AGENT,
    defaultAgentLabel: "Simple Prompt Agent",
  });
}
