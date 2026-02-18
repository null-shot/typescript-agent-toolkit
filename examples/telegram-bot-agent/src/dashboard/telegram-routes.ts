/**
 * Telegram Routes (Reusable Module)
 *
 * Shared telegram webhook/test/health routes used by BOTH single-worker
 * and wizard-generated bundles. Parameterized by TelegramRoutesConfig
 * so each project just passes its DO namespace map.
 *
 * Contains:
 * - POST /telegram/test  — playground chat simulation (DM + group mode)
 * - GET  /telegram/health — telegram health check
 * - POST /telegram/webhook — webhook handler with bot singleton
 *
 * Bot singleton uses setupCoreHandlers (full plug-and-play).
 * Dashboard PIN extensions injected via CoreHandlerHooks.
 */

import type { Hono } from "hono";
import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import type { TelegramBotEnv } from "../types/env";
import { setupCoreHandlers } from "../handlers/core-handlers";
import { TelegramLog, getLogChatId } from "../utils/telegram-logger";
import {
  DASHBOARD_PIN_KEY,
  WORKER_ORIGIN_KEY,
  generatePin,
  hashPin,
} from "./setup-dashboard";
import { isOwner } from "../utils/owner";

// ============================================================================
// CONFIG INTERFACE
// ============================================================================

/**
 * Configuration for setupTelegramRoutes.
 * Each project provides its own agent namespace mapping.
 */
export interface TelegramRoutesConfig {
  /**
   * Map of route keys to Durable Object namespaces.
   * Used to route internal agent requests to the correct DO.
   * Example: { 'dependent': env.DEPENDENT_AGENT }
   */
  getAgentNamespaces: (env: any) => Record<string, DurableObjectNamespace>;

  /**
   * Get the default (fallback) DO namespace for agents.
   * Example: (env) => env.SIMPLE_PROMPT_AGENT
   */
  getDefaultNamespace: (env: any) => DurableObjectNamespace;

  /**
   * Default agent label for display in agent list.
   * Example: "Simple Prompt Agent"
   */
  defaultAgentLabel: string;
}

// ============================================================================
// INTERNAL AGENT SERVICE FACTORY
// ============================================================================

function createInternalAgentService(
  env: any,
  config: TelegramRoutesConfig,
): Fetcher {
  return {
    fetch: async (
      request: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const req =
        request instanceof Request ? request : new Request(request, init);
      const url = new URL(req.url);
      const path = url.pathname;

      let namespace: DurableObjectNamespace = config.getDefaultNamespace(env);
      const namespaces = config.getAgentNamespaces(env);
      for (const [key, ns] of Object.entries(namespaces)) {
        if (path.includes(`/${key}/`)) {
          namespace = ns;
          break;
        }
      }

      const parts = path.split("/");
      const chatIdx = parts.indexOf("chat");
      const sessionId =
        chatIdx !== -1 && parts[chatIdx + 1]
          ? parts[chatIdx + 1]
          : crypto.randomUUID();

      const id = namespace.idFromName(sessionId);
      const stub = namespace.get(id);
      const internalUrl = new URL(
        `/agent/chat/${sessionId}`,
        "https://internal.do",
      );
      const internalReq = new Request(internalUrl.toString(), {
        method: req.method,
        headers: req.headers,
        body: req.body,
      });

      return stub.fetch(internalReq);
    },
  } as Fetcher;
}

// ============================================================================
// TELEGRAM ENV FACTORY
// ============================================================================

function buildTelegramEnv(
  env: any,
  internalAgentService: Fetcher,
  config: TelegramRoutesConfig,
  includeWebhookSecret = false,
): any {
  const INTERNAL_AGENT_URL = "https://internal.single-worker";

  const internalAgents = (env.AGENTS || "")
    .split(",")
    .filter(Boolean)
    .map((entry: string) => {
      const parts = entry.split("|");
      const name = parts[0]?.trim() || "Agent";
      const desc = parts[2]?.trim() || "";
      return desc
        ? `${name}|${INTERNAL_AGENT_URL}|${desc}`
        : `${name}|${INTERNAL_AGENT_URL}`;
    })
    .join(",");

  const telegramEnv: Record<string, unknown> = {
    TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN!,
    AGENT_URL: INTERNAL_AGENT_URL,
    AGENTS:
      internalAgents || `${config.defaultAgentLabel}|${INTERNAL_AGENT_URL}`,
    SESSIONS: env.SESSIONS,
    AGENT_SERVICE: internalAgentService,
    // Pass through optional bindings needed by handlers
    AI: env.AI,
    CHAT_MEMORY: env.CHAT_MEMORY,
    OWNER_ID: env.OWNER_ID,
  };

  if (includeWebhookSecret) {
    telegramEnv.TELEGRAM_WEBHOOK_SECRET = env.TELEGRAM_WEBHOOK_SECRET;
    telegramEnv.LOG_CHAT_ID = env.LOG_CHAT_ID;
  }

  return telegramEnv;
}

// ============================================================================
// ROUTE SETUP
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setupTelegramRoutes(
  app: Hono<any>,
  config: TelegramRoutesConfig,
): void {
  // ============================================================================
  // TELEGRAM BOT TEST ENDPOINT (playground chat simulation)
  // ============================================================================

  app.post("/telegram/test", async (c) => {
    const env = c.env;
    if (!env.TELEGRAM_BOT_TOKEN || !env.SESSIONS) {
      return c.json({ error: "Telegram bot not configured" }, 503);
    }

    try {
      const body = (await c.req.json()) as {
        messages: Array<{ role: string; content: string }>;
        id?: string;
        groupMode?: boolean;
        groupChatId?: string;
      };

      const userMessages = body.messages || [];
      const lastUserMsg = userMessages
        .filter((m: any) => m.role === "user")
        .pop();
      if (!lastUserMsg) {
        return new Response("No user message provided", { status: 400 });
      }

      const messageText = lastUserMsg.content;
      const sessionId = body.id || crypto.randomUUID();
      const isGroupMode = body.groupMode === true;

      // Import utilities
      const { getOrCreateSessionData } = await import("../utils/session");
      const { getCurrentAgentInfo } = await import("../handlers/agent-handler");
      const {
        getMessageHistory,
        addToHistory,
        historyToModelMessages,
        getAgentSystemPromptAsync,
      } = await import("../utils/message-history");
      const { streamAgentResponse } = await import("../utils/agent-client");

      const chatId = `playground-${sessionId}`;
      await getOrCreateSessionData(env.SESSIONS, chatId);

      // Build internal agent env
      const internalAgentService = createInternalAgentService(env, config);
      const telegramEnv = buildTelegramEnv(env, internalAgentService, config);

      // ── Group Mode: moderation + proactive pipeline ──
      if (isGroupMode) {
        const groupChatId = body.groupChatId || "playground-group";
        const results: string[] = [];

        // Run moderation check
        const { getModerationSettings } =
          await import("../utils/moderation-storage");
        const { quickModerateMessage } = await import("../utils/spam-detector");
        const modSettings = await getModerationSettings(
          env.SESSIONS,
          Number(groupChatId) || 0,
        );

        if (modSettings?.enabled) {
          const modResult = await quickModerateMessage(
            messageText,
            Number(groupChatId) || 0,
            123456789,
            modSettings,
            telegramEnv as any,
          );
          if (modResult) {
            results.push(
              `🔍 Moderation: ${modResult.category} (${Math.round((modResult.confidence || 0) * 100)}% confidence)`,
            );
            if (modResult.action && modResult.action !== "none") {
              results.push(
                `⚠️ Action: ${modResult.action} — ${modResult.reason}`,
              );
            } else {
              results.push("✅ Moderation passed — no action needed");
            }
          } else {
            results.push("✅ Quick moderation: clean");
          }
        } else {
          results.push("💭 Moderation: disabled for this chat");
        }

        // Run proactive response check
        const { generateProactiveResponse } =
          await import("../utils/proactive-responder");
        const { getProactiveSettings } =
          await import("../utils/proactive-storage");
        const proactiveSettings = await getProactiveSettings(
          env.SESSIONS,
          Number(groupChatId) || 0,
        );

        if (proactiveSettings && proactiveSettings.mode !== "off") {
          results.push(`⚡ Proactive mode: ${proactiveSettings.mode}`);

          let trigger: string | null = null;
          let triggerReason = "";

          // Check for mention
          if (proactiveSettings.respondToMentions) {
            const botInfo = (await fetch(
              `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`,
            ).then((r: Response) => r.json())) as any;
            const botUsername = botInfo?.result?.username || "";
            if (
              botUsername &&
              messageText
                .toLowerCase()
                .includes(`@${botUsername.toLowerCase()}`)
            ) {
              trigger = "mention";
              triggerReason = "Bot @mentioned";
            }
          }

          // Check for question
          if (!trigger && proactiveSettings.respondToQuestions) {
            if (
              /\?/.test(messageText) ||
              /^(what|how|why|when|where|who|can|do|does|is|are|will|would|could|should)\b/i.test(
                messageText,
              )
            ) {
              const roll = Math.random() * 100;
              if (roll <= proactiveSettings.responseProbability) {
                trigger = "question";
                triggerReason = "Question detected";
              } else {
                results.push(
                  `💤 Question detected but probability miss (${Math.round(roll)}% > ${proactiveSettings.responseProbability}%)`,
                );
              }
            }
          }

          if (trigger) {
            results.push(`🎯 Trigger: ${trigger} — ${triggerReason}`);

            const proactiveResponse = await generateProactiveResponse(
              telegramEnv as any,
              proactiveSettings,
              messageText,
              trigger,
              "PlaygroundUser",
            );

            if (proactiveResponse) {
              results.push("");
              results.push("💬 Bot response:");
              results.push(proactiveResponse);
            } else {
              results.push("⚠️ Proactive response generation failed");
            }
          } else {
            results.push("💤 No proactive trigger matched");
          }
        } else {
          results.push("💤 Proactive mode: off");
        }

        return new Response(results.join("\n"), {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "X-Session-Id": sessionId,
            "X-Group-Mode": "true",
          },
        });
      }

      // ── DM Mode: standard agent pipeline ──
      const {
        url: agentUrl,
        name: agentName,
        id: agentId,
        sessionId: agentSessionId,
      } = await getCurrentAgentInfo(telegramEnv, chatId);

      const history = await getMessageHistory(env.SESSIONS, agentSessionId);
      const historyMessages = historyToModelMessages(history, agentId);
      const systemPrompt = await getAgentSystemPromptAsync(
        env.SESSIONS,
        agentName,
        history,
      );

      await addToHistory(env.SESSIONS, agentSessionId, "user", messageText);

      const allMessages = [
        { role: "system" as const, content: systemPrompt },
        ...historyMessages,
        { role: "user" as const, content: messageText },
      ];

      let fullResponse = "";
      await streamAgentResponse(
        agentUrl,
        agentSessionId,
        allMessages,
        async (chunk: string) => {
          fullResponse += chunk;
        },
        internalAgentService,
      );

      if (fullResponse.length > 0) {
        await addToHistory(
          env.SESSIONS,
          agentSessionId,
          "assistant",
          fullResponse,
          agentId,
          agentName,
        );
      }

      return new Response(fullResponse || "No response from agent.", {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Session-Id": sessionId,
          "X-Agent-Name": agentName,
        },
      });
    } catch (error) {
      console.error("[TelegramTest] Error:", error);
      return new Response(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        },
      );
    }
  });

  // ============================================================================
  // TELEGRAM HEALTH & WEBHOOK
  // ============================================================================

  app.get("/telegram/health", (c) => {
    return c.json({
      status: "ok",
      service: "telegram-bot-agent",
      configured: !!c.env.TELEGRAM_BOT_TOKEN,
    });
  });

  // ── Telegram Bot Singleton ──────────────────────────────────────────
  // Bot + handlers created ONCE per isolate via setupCoreHandlers.

  let _tgBot:
    | {
        webhookHandler: (req: Request) => Promise<Response>;
        logRef: { current?: InstanceType<typeof TelegramLog> };
      }
    | undefined;

  async function ensureTelegramBot(
    env: any,
  ): Promise<NonNullable<typeof _tgBot>> {
    if (_tgBot) return _tgBot;

    const internalAgentService = createInternalAgentService(env, config);
    const telegramEnv = buildTelegramEnv(
      env,
      internalAgentService,
      config,
      true,
    ) as TelegramBotEnv;

    const logRef: { current?: InstanceType<typeof TelegramLog> } = {};

    const bot = new Bot(env.TELEGRAM_BOT_TOKEN!, {
      client: { apiRoot: "https://api.telegram.org" },
    });

    // Register ALL handlers via shared core-handlers (plug-and-play).
    // Dashboard PIN extensions injected via hooks.
    setupCoreHandlers(bot, telegramEnv, logRef, {
      onPrivateStart: async (ctx: any) => {
        const userId = ctx.from?.id;
        // Only the bot owner can receive the dashboard PIN
        const userIsOwner = await isOwner(telegramEnv, userId);
        if (!userIsOwner) return "";

        const existingPin = await env.SESSIONS.get(DASHBOARD_PIN_KEY);
        if (!existingPin) {
          const pin = generatePin();
          await env.SESSIONS.put(DASHBOARD_PIN_KEY, await hashPin(pin));

          // Include a login link if we know the worker origin
          const origin = await env.SESSIONS.get(WORKER_ORIGIN_KEY);
          const linkHint = origin
            ? `\nOpen dashboard: ${origin}/pin?pin=${pin}`
            : "";
          return `\n\n🔐 <b>Dashboard PIN:</b> <code>${pin}</code>\nUse this to access the Manager Dashboard. Use /pin to regenerate.${linkHint}`;
        }
        return "";
      },

      registerExtraCommands: (pinBot) => {
        pinBot.command("pin", async (ctx) => {
          const chatId = ctx.chat?.id;
          if (!chatId || ctx.chat?.type !== "private") {
            await ctx.reply("This command only works in private chats.");
            return;
          }
          // Only the bot owner can generate/regenerate the dashboard PIN
          const userIsOwner = await isOwner(telegramEnv, ctx.from?.id);
          if (!userIsOwner) {
            await ctx.reply(
              "⛔ You are not authorized to manage dashboard access.",
            );
            return;
          }
          const pin = generatePin();
          await env.SESSIONS.put(DASHBOARD_PIN_KEY, await hashPin(pin));

          // Build a one-tap login link if we know the worker origin
          const origin = await env.SESSIONS.get(WORKER_ORIGIN_KEY);
          if (origin) {
            const loginUrl = `${origin}/pin?pin=${pin}`;
            const keyboard = new InlineKeyboard().url(
              "📊 Open Dashboard",
              loginUrl,
            );
            await ctx.reply(
              `🔐 <b>New Dashboard PIN:</b> <code>${pin}</code>\n\nTap the button to open the dashboard:`,
              { parse_mode: "HTML", reply_markup: keyboard },
            );
          } else {
            await ctx.reply(
              `🔐 <b>New Dashboard PIN:</b> <code>${pin}</code>\n\nPrevious PIN has been invalidated.\n\n<i>Tip: Register the webhook first so the bot can generate login links.</i>`,
              { parse_mode: "HTML" },
            );
          }
        });
      },
    });

    const webhookHandler = webhookCallback(bot, "std/http", {
      secretToken: env.TELEGRAM_WEBHOOK_SECRET,
      timeoutMilliseconds: 55_000,
    });

    console.log(
      "[TelegramBot] Singleton initialized via setupCoreHandlers (full plug-and-play)",
    );
    _tgBot = { webhookHandler, logRef };
    return _tgBot;
  }

  // ── Auto-register webhook with correct allowed_updates ──────────
  // GET /telegram/register-webhook — auto-detects URL
  // GET /telegram/register-webhook?url=https://... — explicit URL
  app.get("/telegram/register-webhook", async (c) => {
    const env = c.env;
    if (!env.TELEGRAM_BOT_TOKEN) {
      return c.json({ error: "TELEGRAM_BOT_TOKEN not configured" }, 500);
    }

    const explicitUrl = c.req.query("url");
    const requestUrl = new URL(c.req.url);
    const webhookUrl = explicitUrl || `${requestUrl.origin}/telegram/webhook`;

    // Persist worker origin so the bot's /pin command can build login links
    if (env.SESSIONS) {
      await env.SESSIONS.put(WORKER_ORIGIN_KEY, requestUrl.origin);
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

  // ── Debug: Chat Memory search (test vectorization) ──
  app.get("/telegram/debug/memory", async (c) => {
    const env = c.env;
    const chatId = Number(c.req.query("chat_id"));
    const query = c.req.query("q") || "test";
    const topK = Math.min(Number(c.req.query("top_k")) || 5, 20);

    if (!chatId || isNaN(chatId)) {
      return c.json({ error: "chat_id query param required" }, 400);
    }

    const hasAI = !!env.AI;
    const hasChatMemory = !!(env as any).CHAT_MEMORY;

    if (!hasAI || !hasChatMemory) {
      return c.json(
        {
          error: "Bindings missing",
          bindings: { AI: hasAI, CHAT_MEMORY: hasChatMemory },
        },
        503,
      );
    }

    try {
      const { searchMemory, formatMemoryContext } =
        await import("../utils/chat-memory");
      const results = await searchMemory(env as any, chatId, query, topK);
      return c.json({
        ok: true,
        query,
        chatId,
        totalResults: results.length,
        results: results.map((r) => ({
          score: r.score,
          user: r.metadata.userName,
          text: r.metadata.text,
          date: new Date(r.metadata.timestamp).toISOString(),
          messageId: r.metadata.messageId,
        })),
        formattedContext: formatMemoryContext(results),
      });
    } catch (error) {
      return c.json(
        {
          error: "Search failed",
          details: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  });

  // Telegram webhook endpoint — uses cached bot singleton
  app.post("/telegram/webhook", async (c) => {
    const env = c.env;

    if (!env.TELEGRAM_BOT_TOKEN) {
      return c.json({ error: "TELEGRAM_BOT_TOKEN not configured" }, 503);
    }

    try {
      if (env.TELEGRAM_WEBHOOK_SECRET) {
        const secret = c.req.header("X-Telegram-Bot-Api-Secret-Token");
        if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
          return c.json({ error: "Unauthorized" }, 401);
        }
      }

      const { webhookHandler, logRef } = await ensureTelegramBot(env);

      // Reset per-request log context
      logRef.current = undefined;
      const logChatId = await getLogChatId(env.SESSIONS, env.LOG_CHAT_ID);
      if (logChatId) {
        logRef.current = new TelegramLog(env.TELEGRAM_BOT_TOKEN!, logChatId);
      }

      const result = await webhookHandler(c.req.raw);

      // Flush logs after response
      if (logRef.current) {
        c.executionCtx.waitUntil(logRef.current.flush());
      }

      return result;
    } catch (error) {
      console.error("[TelegramWebhook] Error:", error);
      return c.json({ ok: true }); // Return 200 to prevent Telegram retries
    }
  });
}
