import { Bot, webhookCallback } from "grammy";
import { Hono } from "hono";
import { loggers, setLogLevel } from "./utils/logger";
import { formatError } from "./utils/helpers";
import { TelegramLog, getLogChatId } from "./utils/telegram-logger";
import {
  cleanupOldTasks,
  getKanbanBoard,
  hasAnyTasks,
} from "./utils/kanban-storage";
import {
  processKanbanScheduledTasks,
  processKanbanRecurringTasks,
} from "./utils/cron-processor";
import { setupCoreHandlers, type LogRef } from "./handlers/core-handlers";
import { WORKER_ORIGIN_KEY } from "./dashboard/setup-dashboard";
import type { TelegramBotEnv } from "./types/env";

// Re-export TelegramBotEnv so external consumers can import it
export type { TelegramBotEnv } from "./types/env";

const log = loggers.bot;

/**
 * Telegram Bot Agent - Connects Telegram users to AI agents
 *
 * Two-level interaction model:
 * - Owner (OWNER_ID): Full access — admin commands, task creation, configuration
 * - Users: Interact with bot in the role defined by the owner
 *
 * Architecture:
 * - Bot Config (identity): Role and prompt set by owner
 * - Kanban Board (tasks): All work items tracked, with approval workflow
 */

type Env = TelegramBotEnv;

// ─── Module-level singleton ─────────────────────────────────────────
// Bot + Hono app + Grammy handlers are created ONCE per isolate.
// Workers reuse isolates across requests, so subsequent webhook
// calls skip all initialization and go straight to processing.
//
// Per-request state (TelegramLog) is injected via the mutable logRef
// object, which is reset at the start of each webhook handler.
// This is safe because Telegram delivers webhooks sequentially
// (waits for 200 response before sending the next update).

let _singleton:
  | {
      bot: Bot;
      app: Hono<{ Bindings: Env }>;
      webhookHandler: (req: Request) => Promise<Response>;
      logRef: LogRef;
      token: string;
    }
  | undefined;

function ensureSingleton(env: Env): NonNullable<typeof _singleton> {
  // Invalidate if token changed (e.g. secret rotation without cold start)
  if (_singleton && _singleton.token !== env.TELEGRAM_BOT_TOKEN) {
    log.info("Token changed — re-initializing bot singleton");
    _singleton = undefined;
  }
  if (_singleton) return _singleton;

  const logRef: LogRef = {};

  // ── Grammy Bot (created once) ─────────────────────────────────
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN, {
    client: { apiRoot: "https://api.telegram.org" },
  });

  // Register all handlers ONCE — shared with single-worker via core-handlers
  setupCoreHandlers(bot, env, logRef);

  // Pre-build the webhook callback (also once)
  const webhookHandler = webhookCallback(bot, "std/http", {
    secretToken: env.TELEGRAM_WEBHOOK_SECRET,
    timeoutMilliseconds: 55_000, // Just under Workers 60s limit
  });

  // ── Hono app (created once) ───────────────────────────────────
  const app = new Hono<{ Bindings: Env }>();

  app.get("/health", (c) => {
    return c.json({ status: "ok", service: "telegram-bot-agent" });
  });

  /**
   * Auto-register webhook with ALL required allowed_updates.
   *
   * GET /register-webhook  — auto-detects URL from request
   * GET /register-webhook?url=https://...  — use explicit URL
   *
   * This ensures my_chat_member, channel_post, callback_query etc. are
   * delivered, so the bot can auto-track channels where it's admin.
   */
  app.get("/register-webhook", async (c) => {
    if (!env.TELEGRAM_BOT_TOKEN) {
      return c.json({ error: "TELEGRAM_BOT_TOKEN not configured" }, 500);
    }

    const explicitUrl = c.req.query("url");
    const requestUrl = new URL(c.req.url);
    const webhookUrl = explicitUrl || `${requestUrl.origin}/webhook`;

    // Persist worker origin so the bot's /pin command can build login links
    if (env.SESSIONS) {
      c.executionCtx.waitUntil(
        env.SESSIONS.put(WORKER_ORIGIN_KEY, requestUrl.origin),
      );
    }

    const params = new URLSearchParams({
      url: webhookUrl,
      ...(env.TELEGRAM_WEBHOOK_SECRET && {
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      }),
      allowed_updates: JSON.stringify([
        "message",
        "channel_post",
        "callback_query",
        "my_chat_member",
        "chat_member",
      ]),
    });

    const res = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook?${params}`,
    );
    const data = (await res.json()) as { ok: boolean; description?: string };

    if (data.ok) {
      return c.json({
        ok: true,
        webhook_url: webhookUrl,
        allowed_updates: [
          "message",
          "channel_post",
          "callback_query",
          "my_chat_member",
          "chat_member",
        ],
      });
    }
    return c.json({ ok: false, error: data.description }, 400);
  });

  app.post("/webhook", async (c) => {
    try {
      // Validate webhook secret
      if (env.TELEGRAM_WEBHOOK_SECRET) {
        const secret = c.req.header("X-Telegram-Bot-Api-Secret-Token");
        if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
          return c.json({ error: "Unauthorized" }, 401);
        }
      }

      // Reset per-request log (previous request's log is already flushed)
      logRef.current = undefined;
      const logChatId = await getLogChatId(env.SESSIONS, env.LOG_CHAT_ID);
      if (logChatId) {
        logRef.current = new TelegramLog(env.TELEGRAM_BOT_TOKEN, logChatId);
      }

      // Process the update through the cached bot pipeline
      const result = await webhookHandler(c.req.raw);

      // Flush activity logs
      if (logRef.current?.hasEntries()) {
        c.executionCtx.waitUntil(logRef.current.flush());
      }

      return result;
    } catch (error) {
      log.error("Webhook error", error);
      if (logRef.current) {
        logRef.current.error(`Webhook error: ${formatError(error)}`);
        c.executionCtx.waitUntil(logRef.current.flush());
      }
      // CRITICAL: Always return 200 to Telegram, even on error.
      // Returning 500 causes Telegram to retry the same update forever,
      // blocking all subsequent updates from being delivered.
      return c.json({ ok: true }, 200);
    }
  });

  log.info("Bot singleton initialized (handlers registered once)");
  _singleton = {
    bot,
    app,
    webhookHandler,
    logRef,
    token: env.TELEGRAM_BOT_TOKEN,
  };
  return _singleton;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    execCtx: ExecutionContext,
  ): Promise<Response> {
    setLogLevel(env.LOG_LEVEL);
    const { app } = ensureSingleton(env);
    return app.fetch(request, env, execCtx);
  },

  // Cron trigger for kanban tasks (runs every minute)
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    log.info("Cron trigger", { cron: event.cron });

    // Short-circuit: skip if kanban board is empty (single index read)
    const hasTasks = await hasAnyTasks(env.SESSIONS);
    if (!hasTasks) {
      log.debug("No kanban tasks — skipping cron processing");
      return;
    }

    // Load the board ONCE and pass to both processors (avoids duplicate KV reads)
    const board = await getKanbanBoard(env.SESSIONS);

    // Process one-shot scheduled tasks (schedule.runAt <= now)
    ctx.waitUntil(processKanbanScheduledTasks(env, board));

    // Process recurring tasks (schedule.cron matches current minute)
    ctx.waitUntil(processKanbanRecurringTasks(env, board));

    // Run cleanup once per hour (when minute = 0)
    const now = new Date();
    if (now.getUTCMinutes() === 0) {
      ctx.waitUntil(
        cleanupOldTasks(env.SESSIONS, 30).then((removed) => {
          if (removed > 0) {
            log.info("Cleanup: removed old tasks", { removed });
          }
        }),
      );
    }
  },
};
