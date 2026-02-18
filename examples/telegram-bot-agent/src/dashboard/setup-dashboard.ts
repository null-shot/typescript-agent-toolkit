/**
 * Dashboard Routes (Reusable Module)
 *
 * Shared dashboard API used by BOTH single-worker and wizard-generated bundles.
 * Eliminates code duplication between examples and CLI templates.
 *
 * Contains:
 * - PIN authentication system (constants, utilities, endpoints, middleware)
 * - Manager Dashboard API (/api/dashboard)
 * - Chat settings API (moderation, proactive, agent)
 * - Webhook management
 * - Bot settings API (name, description, commands, profile)
 * - Kanban task board API
 * - Setup wizard API
 * - Moderation logs API
 *
 * Auth helpers (DASHBOARD_PIN_KEY, generatePin, hashPin) are exported for
 * use by webhook handlers (bot /start and /pin commands).
 * PIN generation is owner-only — uses isOwner() from utils/owner.ts.
 *
 * Uses `any` for Hono bindings to work with any project's Env type.
 * All env vars are checked at runtime before use.
 */

import type { Hono } from "hono";
import { setLogChatId, removeLogChatId } from "../utils/telegram-logger";
import { telegramApiFetch } from "../utils/helpers";
import {
  DASHBOARD_POST_PROMPT,
  IMAGE_POST_PROMPT,
  parseFormatHints,
  getPromptForFormat,
  getPromptForFormatAsync,
  getAllCustomPrompts,
  setCustomPrompt,
  DEFAULT_PROMPTS,
  CUSTOMIZABLE_FORMATS,
  type CustomizableFormat,
} from "../utils/prompts";
import {
  normalizePostFormat,
  parseContentBlock,
  truncateToLimit,
} from "../types/content";
import { removeStaleBotChat } from "../utils/bot-chats-storage";

// ============================================================================
// AUTH CONSTANTS & UTILITIES (exported for telegram-routes.ts)
// ============================================================================

export const DASHBOARD_PIN_KEY = "dashboard_pin";
export const WORKER_ORIGIN_KEY = "worker_origin";
const PIN_ATTEMPTS_KEY = "pin_attempts";

/** Retry KV get with cacheTtl to reduce billable reads (cached reads don't count) */
async function kvGetWithRetry(
  kv: KVNamespace,
  key: string,
  maxAttempts = 3,
  cacheTtlSeconds = 60,
): Promise<string | null> {
  let lastError: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await kv.get(key, { cacheTtl: cacheTtlSeconds });
    } catch (e) {
      lastError = e;
      if (i < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 200 * (i + 1)));
      }
    }
  }
  throw lastError;
}
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCKOUT_SECONDS = 15 * 60; // 15 minutes

/**
 * Generate a 6-digit PIN
 */
export function generatePin(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1000000).padStart(6, "0");
}

/**
 * Hash a PIN for storage (simple but effective for a 6-digit PIN)
 */
export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + "_dashboard_salt");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Check if a Telegram user ID is in the admin whitelist.
 * If ADMIN_CHAT_IDS is not set, returns true (no restriction).
 * ADMIN_CHAT_IDS should be a comma-separated list of Telegram user IDs.
 */
export function isAdmin(
  env: Record<string, unknown>,
  userId?: number,
): boolean {
  if (!userId) return false;
  const adminIds = (env as Record<string, unknown>)["ADMIN_CHAT_IDS"] as
    | string
    | undefined;
  if (!adminIds || adminIds.trim() === "") return true; // No restriction if not configured
  const ids = adminIds.split(",").map((id) => id.trim());
  return ids.includes(String(userId));
}

/**
 * Rate limiting for PIN login attempts.
 * Returns { allowed: boolean, remaining: number, retryAfter?: number }
 */
async function checkPinRateLimit(
  kv: KVNamespace,
): Promise<{ allowed: boolean; remaining: number; retryAfter?: number }> {
  try {
    const raw = await kv.get(PIN_ATTEMPTS_KEY);
    if (!raw) return { allowed: true, remaining: MAX_PIN_ATTEMPTS };

    const data = JSON.parse(raw) as { count: number; firstAttempt: number };
    const elapsed = (Date.now() - data.firstAttempt) / 1000;

    // Lockout expired — reset
    if (elapsed > PIN_LOCKOUT_SECONDS) {
      await kv.delete(PIN_ATTEMPTS_KEY);
      return { allowed: true, remaining: MAX_PIN_ATTEMPTS };
    }

    if (data.count >= MAX_PIN_ATTEMPTS) {
      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.ceil(PIN_LOCKOUT_SECONDS - elapsed),
      };
    }

    return { allowed: true, remaining: MAX_PIN_ATTEMPTS - data.count };
  } catch {
    return { allowed: true, remaining: MAX_PIN_ATTEMPTS };
  }
}

async function recordPinAttempt(kv: KVNamespace): Promise<void> {
  try {
    const raw = await kv.get(PIN_ATTEMPTS_KEY);
    const now = Date.now();

    if (!raw) {
      await kv.put(
        PIN_ATTEMPTS_KEY,
        JSON.stringify({ count: 1, firstAttempt: now }),
        { expirationTtl: PIN_LOCKOUT_SECONDS },
      );
      return;
    }

    const data = JSON.parse(raw) as { count: number; firstAttempt: number };
    data.count++;
    await kv.put(PIN_ATTEMPTS_KEY, JSON.stringify(data), {
      expirationTtl: PIN_LOCKOUT_SECONDS,
    });
  } catch {
    /* ignore rate limit storage errors */
  }
}

async function resetPinAttempts(kv: KVNamespace): Promise<void> {
  try {
    await kv.delete(PIN_ATTEMPTS_KEY);
  } catch {
    /* ignore */
  }
}

// ============================================================================
// ROUTE SETUP
// ============================================================================

/**
 * Options for dashboard routes setup.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface DashboardRoutesOptions {
  /**
   * Optional factory to create a Fetcher that can reach the AI agent.
   * Used by the "Generate with AI" post feature.
   * For single-worker: create a Fetcher that routes to the agent DO namespace.
   * For multi-worker: AGENT_SERVICE / AGENT_URL env vars are used automatically.
   */
  getAgentService?: (env: any) => Fetcher | undefined;
}

/**
 * Register all dashboard routes on the given Hono app.
 *
 * @param app     The Hono application instance
 * @param getAgents  Callback to get the list of agents for a given env
 * @param options  Optional configuration (e.g. agent service factory)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setupDashboardRoutes(
  app: Hono<any>,
  getAgents: (env: any) => Array<{
    id: string;
    name: string;
    description?: string;
    path: string;
  }>,
  options?: DashboardRoutesOptions,
): void {
  // ============================================================================
  // AUTH ENDPOINTS
  // ============================================================================

  /**
   * Login endpoint — validates PIN and returns success/failure
   * Rate-limited: max 5 attempts per 15 minutes
   */
  app.post("/api/auth/login", async (c) => {
    if (!c.env.SESSIONS)
      return c.json({ error: "SESSIONS not configured" }, 500);

    try {
      // Check rate limit first
      const rateLimit = await checkPinRateLimit(c.env.SESSIONS);
      if (!rateLimit.allowed) {
        return c.json(
          {
            success: false,
            error: `Too many attempts. Try again in ${Math.ceil((rateLimit.retryAfter || 900) / 60)} minutes.`,
            retryAfter: rateLimit.retryAfter,
          },
          429,
        );
      }

      const body = (await c.req.json()) as { pin: string };
      if (!body.pin || typeof body.pin !== "string") {
        return c.json({ success: false, error: "PIN is required" }, 400);
      }

      const inputHash = await hashPin(body.pin.trim());

      // Try matching with up to one KV re-read.
      // KV is eventually consistent: a PIN generated on one colo (e.g. AMS
      // from Telegram webhook) may not have propagated to the reader colo
      // (e.g. PRG from the user's browser) yet.  A single retry after a
      // short pause covers most propagation windows.
      let storedHash = await c.env.SESSIONS.get(DASHBOARD_PIN_KEY);
      if (!storedHash) {
        return c.json(
          {
            success: false,
            error:
              "No PIN configured. Send /pin to the bot in Telegram (owner only).",
          },
          403,
        );
      }

      if (inputHash === storedHash) {
        await resetPinAttempts(c.env.SESSIONS);
        return c.json({ success: true });
      }

      // First comparison failed — retry once after a short delay to handle
      // KV eventual consistency across Cloudflare colos.
      await new Promise((r) => setTimeout(r, 1500));
      storedHash = await c.env.SESSIONS.get(DASHBOARD_PIN_KEY);
      if (storedHash && inputHash === storedHash) {
        await resetPinAttempts(c.env.SESSIONS);
        return c.json({ success: true });
      }

      // Wrong PIN — record the attempt
      await recordPinAttempt(c.env.SESSIONS);
      const remaining = rateLimit.remaining - 1;
      return c.json(
        {
          success: false,
          error:
            remaining > 0
              ? `Invalid PIN. ${remaining} attempts remaining.`
              : "Invalid PIN. Account locked for 15 minutes.",
        },
        403,
      );
    } catch (error) {
      return c.json({ error: "Authentication failed" }, 500);
    }
  });

  /**
   * Check if a valid PIN exists (used by UI to decide whether to show login)
   */
  app.get("/api/auth/status", async (c) => {
    if (!c.env.SESSIONS) return c.json({ configured: false });
    const storedHash = await c.env.SESSIONS.get(DASHBOARD_PIN_KEY);
    return c.json({ configured: !!storedHash });
  });

  // PIN generation is ONLY available via the Telegram /pin command.
  // This ensures that only the verified bot owner (authenticated through
  // Telegram) can obtain or regenerate the dashboard PIN.
  // There is intentionally NO HTTP endpoint to generate PINs.

  // ============================================================================
  // PIN AUTO-LOGIN PAGE (opens in Telegram's in-app browser)
  // ============================================================================

  /**
   * PIN auto-login page — the bot's /pin command sends a link here.
   * When opened in Telegram's browser, auto-validates the PIN from URL,
   * stores it in localStorage, and redirects to the dashboard.
   * Also serves as a manual login page if no PIN is in the URL.
   */
  app.get("/pin", async (c) => {
    // Persist worker origin so the bot can construct login links
    if (c.env.SESSIONS) {
      const origin = new URL(c.req.url).origin;
      await c.env.SESSIONS.put(WORKER_ORIGIN_KEY, origin);
    }

    const pin = c.req.query("pin") || "";
    const dashboardPath = c.env.DASHBOARD_URL || "/";
    return c.html(generatePinLoginPage(pin, dashboardPath));
  });

  // ============================================================================
  // AUTH MIDDLEWARE (protects all /api/dashboard/* routes)
  // ============================================================================

  /**
   * Dashboard auth middleware — protects all /api/dashboard/* routes
   * Validates X-Dashboard-Pin header against stored PIN hash
   *
   * Exception: webhook setup is allowed without PIN when no PIN is configured yet
   * (bootstrap scenario: need webhook before /start can generate PIN)
   * Exception: /api/dashboard/status is public (no auth) for health/error diagnosis
   */
  app.use("/api/dashboard/*", async (c, next) => {
    const path = new URL(c.req.url).pathname;

    // Public status endpoint — no auth, helps frontend show clearer errors
    if (path === "/api/dashboard/status") {
      const configured = !!c.env.TELEGRAM_BOT_TOKEN;
      let hasPin = false;
      let error: string | undefined;
      if (c.env.SESSIONS) {
        try {
          const hash = await kvGetWithRetry(c.env.SESSIONS, DASHBOARD_PIN_KEY);
          hasPin = !!hash;
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          console.error("[Dashboard] KV error reading status:", e);
          if (errMsg.includes("limit exceeded")) {
            error =
              "KV daily read limit exceeded. Free tier: 100k reads/day. Wait for reset or upgrade.";
          } else {
            error = `Storage temporarily unavailable. ${errMsg}`;
          }
        }
      } else {
        error = "SESSIONS KV namespace not configured";
      }
      return c.json({ configured, hasPin, error });
    }

    // Dashboard requires Telegram Bot to be configured
    if (!c.env.TELEGRAM_BOT_TOKEN) {
      return c.json(
        {
          error:
            "Dashboard requires Telegram Bot to be configured. Set TELEGRAM_BOT_TOKEN to enable.",
        },
        404,
      );
    }
    if (!c.env.SESSIONS) {
      return c.json({ error: "SESSIONS KV namespace not configured" }, 500);
    }

    let storedHash: string | null = null;
    try {
      storedHash = await kvGetWithRetry(c.env.SESSIONS, DASHBOARD_PIN_KEY);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error("[Auth] KV error reading PIN:", e);
      const message = errMsg.includes("limit exceeded")
        ? "KV daily read limit exceeded (100k/day free tier). Wait for reset or upgrade."
        : "Storage temporarily unavailable. Check SESSIONS KV binding and retry.";
      return c.json({ error: message }, 503);
    }

    // Allow webhook setup without PIN when no PIN exists yet (bootstrap)
    if (!storedHash) {
      if (path === "/api/dashboard/webhook") {
        await next();
        return;
      }
      return c.json(
        {
          error:
            "No PIN configured. Send /pin to the bot in Telegram (owner only).",
        },
        403,
      );
    }

    const pin = c.req.header("X-Dashboard-Pin");
    if (!pin) {
      return c.json(
        { error: "Authentication required. Please enter your PIN." },
        401,
      );
    }

    const inputHash = await hashPin(pin.trim());
    if (inputHash !== storedHash) {
      // KV eventual consistency: retry once after a short delay in case the
      // PIN was just regenerated on a different colo.
      await new Promise((r) => setTimeout(r, 1500));
      const freshHash = await c.env.SESSIONS.get(DASHBOARD_PIN_KEY);
      if (!freshHash || inputHash !== freshHash) {
        return c.json({ error: "Invalid PIN" }, 403);
      }
    }

    await next();
  });

  // ============================================================================
  // MANAGER DASHBOARD API
  // ============================================================================

  /**
   * Dashboard data endpoint - returns Telegram bot status, channels, groups,
   * scheduled posts, moderation stats, and connected agents
   */
  app.get("/api/dashboard", async (c) => {
    const env = c.env;

    // Bot configuration status
    const botConfigured = !!env.TELEGRAM_BOT_TOKEN;
    let botUsername = "";

    if (botConfigured) {
      try {
        const meResponse = await telegramApiFetch(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`,
          {
            signal: AbortSignal.timeout(5000),
          },
        );
        if (meResponse.ok) {
          const meData = (await meResponse.json()) as {
            ok: boolean;
            result?: { username?: string };
          };
          botUsername = meData.result?.username || "";
        }
      } catch {
        // Silently fail - bot info is non-critical
      }
    }

    // Fetch channels and groups from KV
    let channels: Array<Record<string, unknown>> = [];
    let groups: Array<Record<string, unknown>> = [];

    if (env.SESSIONS) {
      try {
        // Read bot chats — same key as bot-chats-storage.ts
        const botChatsRaw = await env.SESSIONS.get("bot_chats");
        if (botChatsRaw) {
          const allChats = JSON.parse(botChatsRaw) as Array<
            Record<string, unknown>
          >;
          for (const chat of allChats) {
            if (chat.type === "channel") {
              channels.push(chat);
            } else {
              groups.push(chat);
            }
          }
        }
      } catch (error) {
        console.error("[Dashboard] Error loading KV data:", error);
      }
    }

    // Agents are co-located Durable Objects (single-worker architecture)
    const configuredAgents = getAgents(env).map((a) => ({
      name: a.name,
      url: "Durable Object (internal)",
      path: a.path,
    }));

    // Aggregate moderation status from all groups
    let moderationEnabled = false;
    let totalActions = 0;
    let spamBlocked = 0;
    let usersWarned = 0;

    if (env.SESSIONS) {
      // Fetch moderation settings + logs for ALL groups in parallel
      const groupIds = groups
        .map((g) => g.chatId || g.id)
        .filter(Boolean) as string[];
      const modResults = await Promise.all(
        groupIds.map(async (gid) => {
          try {
            const [modRaw, logsRaw] = await Promise.all([
              env.SESSIONS.get(`mod_settings:${gid}`),
              env.SESSIONS.get(`mod_logs:${gid}`),
            ]);
            return { modRaw, logsRaw };
          } catch {
            return { modRaw: null, logsRaw: null };
          }
        }),
      );

      for (const { modRaw, logsRaw } of modResults) {
        if (modRaw) {
          const modSettings = JSON.parse(modRaw);
          if (modSettings.enabled) moderationEnabled = true;
        }
        if (logsRaw) {
          const logs = JSON.parse(logsRaw) as Array<Record<string, unknown>>;
          totalActions += logs.length;
          spamBlocked += logs.filter((l: Record<string, unknown>) => {
            const result = l.result as Record<string, unknown> | undefined;
            return result?.category === "spam";
          }).length;
          usersWarned += logs.filter(
            (l: Record<string, unknown>) => l.actionTaken === "warn",
          ).length;
        }
      }
    }

    return c.json({
      bot: {
        configured: botConfigured,
        username: botUsername,
      },
      channels,
      groups,
      moderation: {
        enabled: moderationEnabled,
        stats: {
          totalActions,
          spamBlocked,
          usersWarned,
        },
      },
      agents: configuredAgents,
    });
  });

  // ============================================================================
  // DASHBOARD SETTINGS API
  // ============================================================================

  /**
   * Get all settings for a specific chat (moderation, proactive, agent)
   */
  app.get("/api/dashboard/settings/:chatId", async (c) => {
    const chatId = c.req.param("chatId");
    if (!chatId || !c.env.SESSIONS) {
      return c.json(
        { error: "Missing chatId or SESSIONS not configured" },
        400,
      );
    }

    try {
      // Load all settings in parallel
      const [modRaw, proRaw, sesRaw, chRaw] = await Promise.all([
        c.env.SESSIONS.get(`mod_settings:${chatId}`),
        c.env.SESSIONS.get(`proactive:${chatId}`),
        c.env.SESSIONS.get(`session:${chatId}`),
        c.env.SESSIONS.get(`channel_settings:${chatId}`),
      ]);
      const moderation = modRaw ? JSON.parse(modRaw) : null;
      const proactive = proRaw ? JSON.parse(proRaw) : null;
      const session = sesRaw ? JSON.parse(sesRaw) : null;
      const channel = chRaw ? JSON.parse(chRaw) : null;

      return c.json({
        chatId,
        moderation,
        proactive,
        channel,
        session,
        availableAgents: getAgents(c.env).map((a) => ({
          id: a.id,
          name: a.name,
          path: a.path,
        })),
      });
    } catch (error) {
      console.error("[Settings] Error loading:", error);
      return c.json({ error: "Failed to load settings" }, 500);
    }
  });

  /**
   * Update moderation settings for a chat
   */
  app.post("/api/dashboard/settings/moderation", async (c) => {
    if (!c.env.SESSIONS)
      return c.json({ error: "SESSIONS not configured" }, 400);

    try {
      const body = (await c.req.json()) as {
        chatId: string;
        chatTitle?: string;
        enabled?: boolean;
        detectSpam?: boolean;
        detectScam?: boolean;
        detectHate?: boolean;
        detectFlood?: boolean;
        detectLinks?: boolean;
        spamAction?: string;
        scamAction?: string;
        hateAction?: string;
        floodAction?: string;
        linksAction?: string;
      };

      if (!body.chatId) return c.json({ error: "chatId required" }, 400);

      // Get existing or create default
      const existing = await c.env.SESSIONS.get(`mod_settings:${body.chatId}`);
      const settings = existing
        ? JSON.parse(existing)
        : {
            chatId: Number(body.chatId),
            chatTitle: body.chatTitle || `Chat ${body.chatId}`,
            enabled: false,
            detectSpam: true,
            detectScam: true,
            detectHate: true,
            detectFlood: true,
            detectLinks: false,
            spamAction: "delete",
            scamAction: "ban",
            hateAction: "warn",
            floodAction: "mute",
            linksAction: "delete",
            whitelistedUsers: [],
            whitelistedDomains: [],
            updatedAt: Date.now(),
          };

      // Merge updates
      const boolFields = [
        "enabled",
        "detectSpam",
        "detectScam",
        "detectHate",
        "detectFlood",
        "detectLinks",
      ] as const;
      for (const key of boolFields) {
        if (body[key] !== undefined) settings[key] = body[key];
      }
      const actionFields = [
        "spamAction",
        "scamAction",
        "hateAction",
        "floodAction",
        "linksAction",
      ] as const;
      for (const key of actionFields) {
        if (body[key] !== undefined) settings[key] = body[key];
      }
      settings.updatedAt = Date.now();

      await c.env.SESSIONS.put(
        `mod_settings:${body.chatId}`,
        JSON.stringify(settings),
      );

      return c.json({ success: true, settings });
    } catch (error) {
      console.error("[Settings] Moderation save error:", error);
      return c.json({ error: "Failed to save moderation settings" }, 500);
    }
  });

  /**
   * Update proactive mode settings for a chat
   */
  app.post("/api/dashboard/settings/proactive", async (c) => {
    if (!c.env.SESSIONS)
      return c.json({ error: "SESSIONS not configured" }, 400);

    try {
      const body = (await c.req.json()) as {
        chatId: string;
        chatTitle?: string;
        enabled?: boolean;
        mode?: string;
        systemPrompt?: string;
        respondToMentions?: boolean;
        respondToReplies?: boolean;
        respondToQuestions?: boolean;
        responseProbability?: number;
        maxResponsesPerHour?: number;
      };

      if (!body.chatId) return c.json({ error: "chatId required" }, 400);

      const existing = await c.env.SESSIONS.get(`proactive:${body.chatId}`);
      const settings = existing
        ? JSON.parse(existing)
        : {
            chatId: Number(body.chatId),
            chatTitle: body.chatTitle || `Chat ${body.chatId}`,
            enabled: false,
            mode: "off",
            systemPrompt: "",
            respondToMentions: true,
            respondToReplies: true,
            respondToQuestions: false,
            responseProbability: 30,
            triggerKeywords: [],
            cooldownSeconds: 60,
            maxResponsesPerHour: 20,
            responsesThisHour: 0,
            lastResponseTime: 0,
            hourStartTime: 0,
            updatedAt: Date.now(),
          };

      // Merge updates
      if (body.enabled !== undefined) settings.enabled = body.enabled;
      if (body.mode !== undefined) {
        settings.mode = body.mode;
        settings.enabled = body.mode !== "off";
      }
      if (body.systemPrompt !== undefined)
        settings.systemPrompt = body.systemPrompt;
      if (body.respondToMentions !== undefined)
        settings.respondToMentions = body.respondToMentions;
      if (body.respondToReplies !== undefined)
        settings.respondToReplies = body.respondToReplies;
      if (body.respondToQuestions !== undefined)
        settings.respondToQuestions = body.respondToQuestions;
      if (body.responseProbability !== undefined)
        settings.responseProbability = body.responseProbability;
      if (body.maxResponsesPerHour !== undefined)
        settings.maxResponsesPerHour = body.maxResponsesPerHour;
      settings.updatedAt = Date.now();

      await c.env.SESSIONS.put(
        `proactive:${body.chatId}`,
        JSON.stringify(settings),
      );

      return c.json({ success: true, settings });
    } catch (error) {
      console.error("[Settings] Proactive save error:", error);
      return c.json({ error: "Failed to save proactive settings" }, 500);
    }
  });

  /**
   * Switch agent for a chat
   */
  app.post("/api/dashboard/settings/agent", async (c) => {
    if (!c.env.SESSIONS)
      return c.json({ error: "SESSIONS not configured" }, 400);

    try {
      const body = (await c.req.json()) as { chatId: string; agentId: string };
      if (!body.chatId || !body.agentId)
        return c.json({ error: "chatId and agentId required" }, 400);

      const agent = getAgents(c.env).find((a) => a.id === body.agentId);
      if (!agent) return c.json({ error: "Agent not found" }, 404);

      const sesRaw = await c.env.SESSIONS.get(`session:${body.chatId}`);
      const session = sesRaw
        ? JSON.parse(sesRaw)
        : {
            sessionId: crypto.randomUUID(),
            createdAt: Date.now(),
          };

      session.selectedAgentId = agent.id;
      session.selectedAgentUrl = agent.path;
      session.updatedAt = Date.now();

      await c.env.SESSIONS.put(
        `session:${body.chatId}`,
        JSON.stringify(session),
        {
          expirationTtl: 30 * 24 * 60 * 60, // 30 days
        },
      );

      return c.json({
        success: true,
        agent: { id: agent.id, name: agent.name },
      });
    } catch (error) {
      console.error("[Settings] Agent switch error:", error);
      return c.json({ error: "Failed to switch agent" }, 500);
    }
  });

  /**
   * Update channel posting settings
   */
  app.post("/api/dashboard/settings/channel", async (c) => {
    if (!c.env.SESSIONS)
      return c.json({ error: "SESSIONS not configured" }, 400);

    try {
      const body = (await c.req.json()) as {
        chatId: string;
        autoPost?: boolean;
        frequency?: string;
        tone?: string;
        maxPostsPerDay?: number;
        guidelines?: string;
        signature?: string;
        autoHashtags?: boolean;
      };

      if (!body.chatId) return c.json({ error: "chatId required" }, 400);

      const existing = await c.env.SESSIONS.get(
        `channel_settings:${body.chatId}`,
      );
      const settings = existing
        ? JSON.parse(existing)
        : {
            chatId: Number(body.chatId),
            autoPost: false,
            frequency: "manual",
            tone: "neutral",
            maxPostsPerDay: 5,
            guidelines: "",
            signature: "",
            autoHashtags: false,
            updatedAt: Date.now(),
          };

      if (body.autoPost !== undefined) settings.autoPost = body.autoPost;
      if (body.frequency !== undefined) settings.frequency = body.frequency;
      if (body.tone !== undefined) settings.tone = body.tone;
      if (body.maxPostsPerDay !== undefined)
        settings.maxPostsPerDay = body.maxPostsPerDay;
      if (body.guidelines !== undefined) settings.guidelines = body.guidelines;
      if (body.signature !== undefined) settings.signature = body.signature;
      if (body.autoHashtags !== undefined)
        settings.autoHashtags = body.autoHashtags;
      settings.updatedAt = Date.now();

      await c.env.SESSIONS.put(
        `channel_settings:${body.chatId}`,
        JSON.stringify(settings),
      );

      return c.json({ success: true, settings });
    } catch (error) {
      console.error("[Settings] Channel save error:", error);
      return c.json({ error: "Failed to save channel settings" }, 500);
    }
  });

  // ============================================================================
  // WEBHOOK MANAGEMENT
  // ============================================================================

  /**
   * Set Telegram webhook URL
   */
  app.post("/api/dashboard/webhook", async (c) => {
    if (!c.env.TELEGRAM_BOT_TOKEN) {
      return c.json({ error: "TELEGRAM_BOT_TOKEN not configured" }, 400);
    }

    try {
      const body = (await c.req.json()) as { url?: string; auto?: boolean };

      // Auto-detect URL from request
      let webhookUrl = body.url;
      if (body.auto || !webhookUrl) {
        const requestUrl = new URL(c.req.url);
        webhookUrl = `${requestUrl.origin}/telegram/webhook`;
      }

      // Set webhook via Telegram API
      const params = new URLSearchParams({
        url: webhookUrl,
        ...(c.env.TELEGRAM_WEBHOOK_SECRET && {
          secret_token: c.env.TELEGRAM_WEBHOOK_SECRET,
        }),
        allowed_updates: JSON.stringify([
          "message",
          "channel_post",
          "callback_query",
          "my_chat_member",
          "chat_member",
        ]),
      });

      const response = await telegramApiFetch(
        `https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/setWebhook?${params}`,
      );
      const data = (await response.json()) as {
        ok: boolean;
        description?: string;
      };

      if (data.ok) {
        return c.json({ success: true, webhookUrl });
      } else {
        return c.json(
          {
            success: false,
            error: data.description || "Failed to set webhook",
            webhookUrl,
          },
          400,
        );
      }
    } catch (error) {
      console.error("[Webhook] Error:", error);
      return c.json({ error: "Failed to set webhook" }, 500);
    }
  });

  /**
   * Get current webhook info
   */
  app.get("/api/dashboard/webhook", async (c) => {
    if (!c.env.TELEGRAM_BOT_TOKEN) {
      return c.json({ configured: false });
    }

    try {
      const response = await telegramApiFetch(
        `https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`,
      );
      const data = (await response.json()) as {
        ok: boolean;
        result?: Record<string, unknown>;
      };

      return c.json({
        configured: true,
        webhook: data.result,
      });
    } catch (error) {
      return c.json({
        configured: false,
        error: "Failed to get webhook info",
      });
    }
  });

  // ============================================================================
  // TELEGRAM BOT SETTINGS API
  // ============================================================================

  /**
   * Get full bot profile info via Telegram API (getMe + description + about)
   */
  app.get("/api/dashboard/bot-settings", async (c) => {
    if (!c.env.TELEGRAM_BOT_TOKEN) {
      return c.json({ error: "TELEGRAM_BOT_TOKEN not configured" }, 400);
    }

    const token = c.env.TELEGRAM_BOT_TOKEN!;

    try {
      // Fetch bot info, description, short description, and commands in parallel
      const [meRes, descRes, shortDescRes, cmdsRes, menuBtnRes] =
        await Promise.all([
          telegramApiFetch(`https://api.telegram.org/bot${token}/getMe`, {
            signal: AbortSignal.timeout(5000),
          }),
          telegramApiFetch(
            `https://api.telegram.org/bot${token}/getMyDescription`,
            {
              signal: AbortSignal.timeout(5000),
            },
          ),
          telegramApiFetch(
            `https://api.telegram.org/bot${token}/getMyShortDescription`,
            {
              signal: AbortSignal.timeout(5000),
            },
          ),
          telegramApiFetch(
            `https://api.telegram.org/bot${token}/getMyCommands`,
            {
              signal: AbortSignal.timeout(5000),
            },
          ),
          telegramApiFetch(
            `https://api.telegram.org/bot${token}/getChatMenuButton`,
            {
              signal: AbortSignal.timeout(5000),
            },
          ),
        ]);

      const meData = (await meRes.json()) as {
        ok: boolean;
        result?: Record<string, unknown>;
      };
      const descData = (await descRes.json()) as {
        ok: boolean;
        result?: { description?: string };
      };
      const shortDescData = (await shortDescRes.json()) as {
        ok: boolean;
        result?: { short_description?: string };
      };
      const cmdsData = (await cmdsRes.json()) as {
        ok: boolean;
        result?: Array<{ command: string; description: string }>;
      };
      const menuBtnData = (await menuBtnRes.json()) as {
        ok: boolean;
        result?: Record<string, unknown>;
      };

      // Load saved bot profile from KV (custom settings like log chat, welcome message)
      let savedProfile: Record<string, unknown> = {};
      if (c.env.SESSIONS) {
        try {
          const raw = await c.env.SESSIONS.get("bot_profile_settings");
          if (raw) savedProfile = JSON.parse(raw);
        } catch {
          /* non-critical */
        }
      }

      return c.json({
        bot: meData.result || {},
        description: descData.result?.description || "",
        shortDescription: shortDescData.result?.short_description || "",
        commands: cmdsData.result || [],
        menuButton: menuBtnData.result || {},
        savedProfile,
      });
    } catch (error) {
      console.error("[BotSettings] Error fetching bot info:", error);
      return c.json({ error: "Failed to fetch bot settings" }, 500);
    }
  });

  /**
   * Update bot name
   */
  app.post("/api/dashboard/bot-settings/name", async (c) => {
    if (!c.env.TELEGRAM_BOT_TOKEN)
      return c.json({ error: "Not configured" }, 400);

    try {
      const body = (await c.req.json()) as { name: string };
      if (!body.name || body.name.length < 1)
        return c.json({ error: "Name is required" }, 400);

      const res = await telegramApiFetch(
        `https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/setMyName`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: body.name }),
        },
      );
      const data = (await res.json()) as { ok: boolean; description?: string };

      if (data.ok) {
        return c.json({ success: true });
      }
      return c.json(
        { error: data.description || "Failed to update name" },
        400,
      );
    } catch (error) {
      return c.json({ error: "Failed to update bot name" }, 500);
    }
  });

  /**
   * Update bot description (shown in the bot profile page)
   */
  app.post("/api/dashboard/bot-settings/description", async (c) => {
    if (!c.env.TELEGRAM_BOT_TOKEN)
      return c.json({ error: "Not configured" }, 400);

    try {
      const body = (await c.req.json()) as { description: string };

      const res = await telegramApiFetch(
        `https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/setMyDescription`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: body.description || "" }),
        },
      );
      const data = (await res.json()) as { ok: boolean; description?: string };

      if (data.ok) return c.json({ success: true });
      return c.json(
        { error: data.description || "Failed to update description" },
        400,
      );
    } catch (error) {
      return c.json({ error: "Failed to update bot description" }, 500);
    }
  });

  /**
   * Update bot short description (shown in search results / share links)
   */
  app.post("/api/dashboard/bot-settings/short-description", async (c) => {
    if (!c.env.TELEGRAM_BOT_TOKEN)
      return c.json({ error: "Not configured" }, 400);

    try {
      const body = (await c.req.json()) as { shortDescription: string };

      const res = await telegramApiFetch(
        `https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/setMyShortDescription`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            short_description: body.shortDescription || "",
          }),
        },
      );
      const data = (await res.json()) as { ok: boolean; description?: string };

      if (data.ok) return c.json({ success: true });
      return c.json(
        { error: data.description || "Failed to update short description" },
        400,
      );
    } catch (error) {
      return c.json({ error: "Failed to update bot short description" }, 500);
    }
  });

  /**
   * Update bot commands list
   */
  app.post("/api/dashboard/bot-settings/commands", async (c) => {
    if (!c.env.TELEGRAM_BOT_TOKEN)
      return c.json({ error: "Not configured" }, 400);

    try {
      const body = (await c.req.json()) as {
        commands: Array<{ command: string; description: string }>;
      };

      // Validate commands
      const validCommands = (body.commands || [])
        .filter((cmd) => cmd.command && cmd.description)
        .map((cmd) => ({
          command: cmd.command
            .replace(/^\//, "")
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, ""),
          description: cmd.description.substring(0, 256),
        }))
        .filter((cmd) => cmd.command.length >= 1 && cmd.command.length <= 32);

      const res = await telegramApiFetch(
        `https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/setMyCommands`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commands: validCommands }),
        },
      );
      const data = (await res.json()) as { ok: boolean; description?: string };

      if (data.ok) return c.json({ success: true, commands: validCommands });
      return c.json(
        { error: data.description || "Failed to update commands" },
        400,
      );
    } catch (error) {
      return c.json({ error: "Failed to update bot commands" }, 500);
    }
  });

  /**
   * Delete all bot commands
   */
  app.delete("/api/dashboard/bot-settings/commands", async (c) => {
    if (!c.env.TELEGRAM_BOT_TOKEN)
      return c.json({ error: "Not configured" }, 400);

    try {
      const res = await telegramApiFetch(
        `https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/deleteMyCommands`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const data = (await res.json()) as { ok: boolean; description?: string };

      if (data.ok) return c.json({ success: true });
      return c.json(
        { error: data.description || "Failed to delete commands" },
        400,
      );
    } catch (error) {
      return c.json({ error: "Failed to delete bot commands" }, 500);
    }
  });

  /**
   * Save custom bot profile settings (welcome message, log chat, etc.)
   */
  app.post("/api/dashboard/bot-settings/profile", async (c) => {
    if (!c.env.SESSIONS)
      return c.json({ error: "SESSIONS not configured" }, 400);

    try {
      const body = (await c.req.json()) as {
        welcomeMessage?: string;
        logChatId?: string;
        defaultAgent?: string;
        maxHistoryMessages?: number;
        personality?: string;
        knowledgeBase?: {
          websiteUrl?: string;
          docsUrl?: string;
          additionalLinks?: string;
          instructions?: string;
        };
      };

      const existing = await c.env.SESSIONS.get("bot_profile_settings");
      const settings = existing ? JSON.parse(existing) : {};

      if (body.welcomeMessage !== undefined)
        settings.welcomeMessage = body.welcomeMessage;
      if (body.logChatId !== undefined) settings.logChatId = body.logChatId;
      if (body.defaultAgent !== undefined)
        settings.defaultAgent = body.defaultAgent;
      if (body.maxHistoryMessages !== undefined)
        settings.maxHistoryMessages = body.maxHistoryMessages;
      if (body.personality !== undefined) settings.personality = body.personality;
      if (body.knowledgeBase !== undefined)
        settings.knowledgeBase = body.knowledgeBase;
      settings.updatedAt = Date.now();

      await c.env.SESSIONS.put(
        "bot_profile_settings",
        JSON.stringify(settings),
      );

      // Also update log chat ID via shared utility (uses canonical KV key)
      if (body.logChatId !== undefined) {
        if (body.logChatId) {
          await setLogChatId(c.env.SESSIONS, body.logChatId);
        } else {
          await removeLogChatId(c.env.SESSIONS);
        }
      }

      return c.json({ success: true, settings });
    } catch (error) {
      return c.json({ error: "Failed to save profile settings" }, 500);
    }
  });

  // ============================================================================
  // CUSTOM POST PROMPTS API
  // ============================================================================

  /**
   * Get all custom post prompts (with defaults for comparison).
   */
  app.get("/api/dashboard/bot-settings/prompts", async (c) => {
    if (!c.env.SESSIONS)
      return c.json({ error: "SESSIONS not configured" }, 400);

    try {
      const custom = await getAllCustomPrompts(c.env.SESSIONS);
      return c.json({
        prompts: Object.fromEntries(
          CUSTOMIZABLE_FORMATS.map((fmt) => [
            fmt,
            {
              custom: custom[fmt],
              default: DEFAULT_PROMPTS[fmt],
              isCustom: !!custom[fmt],
            },
          ]),
        ),
      });
    } catch (error) {
      return c.json({ error: "Failed to load prompts" }, 500);
    }
  });

  /**
   * Save a custom prompt for a specific post format.
   * Send empty string to reset to default.
   */
  app.post("/api/dashboard/bot-settings/prompts", async (c) => {
    if (!c.env.SESSIONS)
      return c.json({ error: "SESSIONS not configured" }, 400);

    try {
      const body = (await c.req.json()) as {
        format: string;
        prompt: string;
      };

      if (
        !body.format ||
        !CUSTOMIZABLE_FORMATS.includes(body.format as CustomizableFormat)
      ) {
        return c.json(
          {
            error: `Invalid format. Must be one of: ${CUSTOMIZABLE_FORMATS.join(", ")}`,
          },
          400,
        );
      }

      await setCustomPrompt(
        c.env.SESSIONS,
        body.format as CustomizableFormat,
        body.prompt || "",
      );

      return c.json({
        success: true,
        format: body.format,
        isCustom: !!body.prompt?.trim(),
      });
    } catch (error) {
      return c.json({ error: "Failed to save prompt" }, 500);
    }
  });

  // ============================================================================
  // POST PREVIEW API (generate example without publishing)
  // ============================================================================

  /**
   * Generate a preview post from a topic. Does not create or publish anything.
   */
  app.post("/api/dashboard/posts/preview", async (c) => {
    if (!c.env.SESSIONS)
      return c.json({ error: "SESSIONS not configured" }, 400);

    try {
      const body = (await c.req.json()) as {
        topic: string;
        format?: "auto" | "text" | "photo" | "voice" | "poll";
      };
      const topic = body.topic?.trim();
      if (!topic) {
        return c.json({ error: "Topic is required" }, 400);
      }
      const formatOverride = body.format;

      const { sendAgentMessage } = await import("../utils/agent-client");
      const { getKnowledgeBasePrompt } =
        await import("../utils/knowledge-base");
      const kbPrompt = c.env.SESSIONS
        ? await getKnowledgeBasePrompt(c.env.SESSIONS)
        : "";

      let agentUrl = c.env.AGENT_URL || "";
      let agentService: Fetcher | undefined = c.env.AGENT_SERVICE;

      if (!agentService && options?.getAgentService) {
        agentService = options.getAgentService(c.env);
      }

      if (!agentService) {
        for (const key of Object.keys(c.env)) {
          try {
            const val = c.env[key];
            if (
              val &&
              typeof val === "object" &&
              typeof val.idFromName === "function"
            ) {
              const ns = val as DurableObjectNamespace;
              agentService = {
                fetch(
                  input: Request | string | URL,
                  init?: RequestInit,
                ): Promise<Response> {
                  const req =
                    input instanceof Request
                      ? input
                      : new Request(
                          typeof input === "string" ? input : input.href,
                          init,
                        );
                  const u = new URL(req.url);
                  const parts = u.pathname.split("/");
                  const sid = parts[parts.length - 1] || "default";
                  return ns.get(ns.idFromName(sid)).fetch(req);
                },
                connect: undefined as never,
              } as Fetcher;
              break;
            }
          } catch {
            /* not a DO namespace */
          }
        }
      }

      if (agentService && !agentUrl) {
        agentUrl = "https://internal.single-worker";
      }

      if (!agentUrl && !agentService) {
        return c.json({ error: "No AI agent configured" }, 400);
      }

      const { cleanTopic: parsedTopic, format: parsedFormat } =
        parseFormatHints(topic);
      const postFormat =
        formatOverride && ["auto", "text", "photo", "voice", "poll"].includes(formatOverride)
          ? formatOverride
          : parsedFormat;
      const imagesEnabled =
        !!c.env.AI &&
        (await c.env.SESSIONS?.get("setting:image_with_posts")) !== "false";
      const basePrompt = await getPromptForFormatAsync(
        postFormat,
        !!c.env.AI,
        imagesEnabled,
        c.env.SESSIONS,
      );
      const systemContent = basePrompt + parsedTopic + kbPrompt;
      const sessionId = `dashboard-preview-${Date.now()}`;

      const generated = await sendAgentMessage(
        agentUrl,
        sessionId,
        [
          { role: "system", content: systemContent },
          { role: "user", content: `Write a post about: ${parsedTopic}` },
        ],
        agentService,
      );

      const content = generated?.trim() || "";
      if (!content) {
        return c.json(
          { error: "AI generated empty content. Please try again." },
          500,
        );
      }

      return c.json({ success: true, content });
    } catch (error) {
      console.error("[Posts] Preview error:", error);
      return c.json(
        {
          error: `Preview failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
        500,
      );
    }
  });

  // ============================================================================
  // CREATE POST API
  // ============================================================================

  /**
   * Create & optionally publish post(s) to selected channels/groups.
   * Supports: immediate publish, scheduled (one-shot), recurring (cron).
   * Auto-approve: publishes directly. Otherwise goes to approval queue.
   */
  app.post("/api/dashboard/posts", async (c) => {
    if (!c.env.SESSIONS)
      return c.json({ error: "SESSIONS not configured" }, 400);
    if (!c.env.TELEGRAM_BOT_TOKEN)
      return c.json({ error: "Bot not configured" }, 400);

    try {
      const body = (await c.req.json()) as {
        targetChats: Array<{ chatId: string; chatTitle: string }>;
        content: string;
        scheduleType: "now" | "scheduled" | "recurring";
        scheduledAt?: string;
        cronExpression?: string;
        timezone?: string;
        autoApprove: boolean;
        generateWithAI?: boolean;
        format?: "auto" | "text" | "photo" | "voice" | "poll";
      };

      const {
        targetChats,
        content,
        scheduleType,
        scheduledAt,
        cronExpression,
        timezone,
        autoApprove,
        generateWithAI,
        format: formatOverride,
      } = body;

      if (
        !targetChats ||
        !Array.isArray(targetChats) ||
        targetChats.length === 0
      ) {
        return c.json(
          { error: "Select at least one target channel or group" },
          400,
        );
      }
      if (!content || content.trim().length === 0) {
        return c.json({ error: "Post content is required" }, 400);
      }

      const { createTask, createApprovalTask, updateTask } =
        await import("../utils/kanban-storage");

      // ── AI content generation ──
      // When generateWithAI is true, the user's input is a topic/prompt
      // and we ask the AI agent to produce the actual post text.
      let publishContent = content.trim();
      const topic = content.trim(); // Always keep original as topic
      // For recurring: append format hint so cron processor picks the right format
      const topicForRecurring =
        formatOverride === "voice"
          ? topic + " +voice"
          : formatOverride === "poll"
            ? topic + " +poll"
            : topic;

      if (
        generateWithAI &&
        (scheduleType === "now" || scheduleType === "scheduled")
      ) {
        // Generate content via AI agent right now
        const { sendAgentMessage } = await import("../utils/agent-client");
        const { getKnowledgeBasePrompt } =
          await import("../utils/knowledge-base");
        const kbPrompt = c.env.SESSIONS
          ? await getKnowledgeBasePrompt(c.env.SESSIONS)
          : "";

        // Resolve agent access:
        // 1. c.env.AGENT_SERVICE (service binding)
        // 2. options.getAgentService (explicit factory from caller)
        // 3. Auto-detect DO namespace in env (SIMPLE_PROMPT_AGENT etc.)
        // 4. c.env.AGENT_URL (HTTP fallback)
        let agentUrl = c.env.AGENT_URL || "";
        let agentService: Fetcher | undefined = c.env.AGENT_SERVICE;

        if (!agentService && options?.getAgentService) {
          agentService = options.getAgentService(c.env);
        }

        // Fallback: auto-detect DO agent namespace in env
        if (!agentService) {
          for (const key of Object.keys(c.env)) {
            try {
              const val = c.env[key];
              if (
                val &&
                typeof val === "object" &&
                typeof val.idFromName === "function"
              ) {
                const ns = val as DurableObjectNamespace;
                agentService = {
                  fetch(
                    input: Request | string | URL,
                    init?: RequestInit,
                  ): Promise<Response> {
                    const req =
                      input instanceof Request
                        ? input
                        : new Request(
                            typeof input === "string" ? input : input.href,
                            init,
                          );
                    const u = new URL(req.url);
                    const parts = u.pathname.split("/");
                    const sid = parts[parts.length - 1] || "default";
                    return ns.get(ns.idFromName(sid)).fetch(req);
                  },
                  connect: undefined as never,
                } as Fetcher;
                console.log(`[Posts] Auto-detected DO namespace: ${key}`);
                break;
              }
            } catch {
              // not a DO namespace
            }
          }
        }

        if (agentService && !agentUrl) {
          agentUrl = "https://internal.single-worker";
        }

        if (!agentUrl && !agentService) {
          return c.json({ error: "No AI agent configured" }, 400);
        }

        // Parse format hints from topic, or use explicit format from UI
        const { cleanTopic: parsedTopic, format: parsedFormat } =
          parseFormatHints(topic);
        const postFormat =
          formatOverride && ["auto", "text", "photo", "voice", "poll"].includes(formatOverride)
            ? formatOverride
            : parsedFormat;
        const imagesEnabled =
          !!c.env.AI &&
          (await c.env.SESSIONS?.get("setting:image_with_posts")) !== "false";
        const basePrompt = await getPromptForFormatAsync(
          postFormat,
          !!c.env.AI,
          imagesEnabled,
          c.env.SESSIONS,
        );
        const systemContent = basePrompt + parsedTopic + kbPrompt;
        const sessionId = `dashboard-post-${Date.now()}`;

        // #region agent log
        console.log(
          "[DEBUG:dashboard:aiGen:start]",
          JSON.stringify({
            agentUrl: agentUrl?.substring(0, 80),
            hasAgentService: !!agentService,
            sessionId,
            parsedTopic,
            postFormat,
            imagesEnabled,
            systemContentLength: systemContent.length,
            hypothesisId: "A,D,E",
          }),
        );
        // #endregion
        try {
          const generated = await sendAgentMessage(
            agentUrl,
            sessionId,
            [
              { role: "system", content: systemContent },
              {
                role: "user",
                content: `Write a post about: ${parsedTopic}`,
              },
            ],
            agentService,
          );
          // #region agent log
          console.log(
            "[DEBUG:dashboard:aiGen:result]",
            JSON.stringify({
              generatedLength: generated?.length,
              trimmedLength: generated?.trim()?.length,
              isEmpty: !generated?.trim(),
              preview: generated?.substring(0, 200),
              hypothesisId: "B,C",
            }),
          );
          // #endregion
          if (generated && generated.trim().length > 0) {
            publishContent = generated.trim();
          } else {
            return c.json(
              { error: "AI generated empty content. Please try again." },
              500,
            );
          }
        } catch (aiError) {
          // #region agent log
          console.error(
            "[DEBUG:dashboard:aiGen:error]",
            JSON.stringify({
              error:
                aiError instanceof Error ? aiError.message : String(aiError),
              stack:
                aiError instanceof Error
                  ? aiError.stack?.substring(0, 300)
                  : undefined,
              hypothesisId: "A,D,E",
            }),
          );
          // #endregion
          console.error("[Posts] AI generation error:", aiError);
          return c.json(
            {
              error: `AI generation failed: ${aiError instanceof Error ? aiError.message : "Unknown error"}`,
            },
            500,
          );
        }

        // If AI returned plain text (not JSON), wrap it as the expected format.
        // Only for formats that expect JSON (photo, poll, voice).
        const contentLooksLikeJson =
          /^\s*\{/.test(publishContent) && publishContent.includes('"type"');
        if (!contentLooksLikeJson) {
          if (postFormat === "auto" && imagesEnabled) {
            // Default: wrap as photo post
            const caption =
              publishContent.length > 500
                ? truncateToLimit(publishContent, 400)
                : publishContent;
            publishContent = JSON.stringify({
              type: "photo",
              imagePrompt: `Clean editorial illustration about: ${parsedTopic.slice(0, 200)}. Minimal flat design, warm tones, no text in image.`,
              caption,
            });
            console.log("[Posts] Wrapped plain-text AI response as image post");
          } else if (postFormat === "voice") {
            // Wrap as voice post
            publishContent = JSON.stringify({
              type: "voice",
              text: publishContent,
              caption:
                publishContent.length > 500
                  ? truncateToLimit(publishContent, 400)
                  : publishContent,
            });
            console.log("[Posts] Wrapped plain-text AI response as voice post");
          }
          // For "poll" and "text" — if AI didn't return JSON, just use plain text
        }
      }

      // Normalize post formatting only for plain text (not JSON content blocks)
      const isJsonContent =
        /^\s*\{/.test(publishContent) && publishContent.includes('"type"');
      if (!isJsonContent) {
        publishContent = normalizePostFormat(publishContent);
      }

      const results: Array<{
        chatId: number;
        chatTitle: string;
        status: string;
        taskId?: string;
        error?: string;
      }> = [];

      for (const chat of targetChats) {
        const chatId = Number(chat.chatId);
        const chatTitle = chat.chatTitle || `Chat ${chatId}`;

        try {
          if (scheduleType === "now" && autoApprove) {
            // ── Publish immediately via publishContent (supports photos, polls, etc.) ──
            try {
              const { publishContent: publishContentFn } =
                await import("../utils/content-publisher");
              const { getTelegramApi } = await import("../utils/telegram-api");
              const contentBlock = parseContentBlock(publishContent);
              const api = getTelegramApi(c.env.TELEGRAM_BOT_TOKEN!);
              await publishContentFn(api, chatId, contentBlock, c.env.AI);

              // Log as completed task
              await createTask(c.env.SESSIONS, {
                kind: "one-shot",
                status: "done",
                source: "owner",
                action: "write_post",
                title: `Post → ${chatTitle}`,
                description: generateWithAI
                  ? `AI: ${topic.substring(0, 100)}`
                  : publishContent.substring(0, 120),
                chatId,
                chatTitle,
                role: "content",
                approval: {
                  content: publishContent,
                  targetChatId: chatId,
                  targetChatTitle: chatTitle,
                  requestedAt: new Date().toISOString(),
                  respondedAt: new Date().toISOString(),
                  decision: "approved",
                },
                runCount: 1,
                logs: [
                  {
                    time: new Date().toISOString(),
                    message: generateWithAI
                      ? `AI-generated and published to ${chatTitle}`
                      : `Published immediately to ${chatTitle}`,
                    category: "post",
                  },
                ],
              });
              results.push({ chatId, chatTitle, status: "published" });
            } catch (publishError) {
              const errDesc =
                publishError instanceof Error
                  ? publishError.message
                  : "Publish error";

              // Auto-cleanup stale entries the bot can no longer reach
              const isChatGone =
                errDesc.includes("chat not found") ||
                errDesc.includes("bot was kicked") ||
                errDesc.includes("bot is not a member");
              if (isChatGone && c.env.SESSIONS) {
                await removeStaleBotChat(c.env.SESSIONS, chatId);
                console.warn(
                  `[Posts] Removed stale chat "${chatTitle}" (${chatId}): ${errDesc}`,
                );
              }

              results.push({
                chatId,
                chatTitle,
                status: "failed",
                error: isChatGone
                  ? `${errDesc}. Chat removed — re-add the bot as admin.`
                  : errDesc,
              });
            }
          } else if (scheduleType === "now" && !autoApprove) {
            // ── Awaiting approval (content already AI-generated above if needed) ──
            const task = await createApprovalTask(c.env.SESSIONS, {
              title: `Post → ${chatTitle}`,
              description: generateWithAI
                ? `AI: ${topic.substring(0, 100)}`
                : publishContent.substring(0, 120),
              action: "write_post",
              content: publishContent,
              targetChatId: chatId,
              targetChatTitle: chatTitle,
              role: "content",
              source: "owner",
            });
            results.push({
              chatId,
              chatTitle,
              status: "awaiting-approval",
              taskId: task.id,
            });
          } else if (scheduleType === "scheduled") {
            if (!scheduledAt) {
              results.push({
                chatId,
                chatTitle,
                status: "error",
                error: "Schedule time is required",
              });
              continue;
            }

            const runAt = new Date(scheduledAt).toISOString();

            if (autoApprove) {
              // ── Scheduled auto-publish ──
              const task = await createTask(c.env.SESSIONS, {
                kind: "one-shot",
                status: "queued",
                source: "owner",
                action: "write_post",
                title: `Scheduled post → ${chatTitle}`,
                description: generateWithAI
                  ? `AI: ${topic.substring(0, 100)}`
                  : publishContent.substring(0, 120),
                chatId,
                chatTitle,
                role: "content",
                schedule: { runAt, timezone: timezone || undefined },
                approval: {
                  content: publishContent,
                  targetChatId: chatId,
                  targetChatTitle: chatTitle,
                  requestedAt: new Date().toISOString(),
                  respondedAt: new Date().toISOString(),
                  decision: "approved",
                },
              });
              results.push({
                chatId,
                chatTitle,
                status: "scheduled",
                taskId: task.id,
              });
            } else {
              // ── Scheduled but needs approval first ──
              const task = await createApprovalTask(c.env.SESSIONS, {
                title: `Scheduled post → ${chatTitle}`,
                description: generateWithAI
                  ? `AI: ${topic.substring(0, 100)}`
                  : publishContent.substring(0, 120),
                action: "write_post",
                content: publishContent,
                targetChatId: chatId,
                targetChatTitle: chatTitle,
                role: "content",
                source: "owner",
              });
              // Attach schedule info (after approval → move to queued with runAt)
              await updateTask(c.env.SESSIONS, task.id, {
                schedule: { runAt, timezone: timezone || undefined },
              });
              results.push({
                chatId,
                chatTitle,
                status: "awaiting-approval",
                taskId: task.id,
              });
            }
          } else if (scheduleType === "recurring") {
            if (!cronExpression) {
              results.push({
                chatId,
                chatTitle,
                status: "error",
                error: "Cron expression is required",
              });
              continue;
            }

            if (autoApprove) {
              // ── Recurring auto-publish ──
              // For recurring: store the topic. Cron processor generates fresh content each time.
              const task = await createTask(c.env.SESSIONS, {
                kind: "recurring",
                status: "in-progress",
                source: "owner",
                action: "write_post",
                title: `Recurring post → ${chatTitle}`,
                description: `Generate and publish a post about: ${topic}`,
                chatId,
                chatTitle,
                role: "content",
                schedule: {
                  cron: cronExpression,
                  timezone: timezone || undefined,
                },
                approval: {
                  content: topicForRecurring,
                  targetChatId: chatId,
                  targetChatTitle: chatTitle,
                  requestedAt: new Date().toISOString(),
                  respondedAt: new Date().toISOString(),
                  decision: "approved",
                },
              });
              results.push({
                chatId,
                chatTitle,
                status: "recurring",
                taskId: task.id,
              });
            } else {
              // ── Recurring but needs approval first ──
              const task = await createApprovalTask(c.env.SESSIONS, {
                title: `Recurring post → ${chatTitle}`,
                description: `Topic: ${topic.substring(0, 100)}`,
                action: "write_post",
                content: topicForRecurring,
                targetChatId: chatId,
                targetChatTitle: chatTitle,
                role: "content",
                source: "owner",
              });
              await updateTask(c.env.SESSIONS, task.id, {
                kind: "recurring",
                schedule: {
                  cron: cronExpression,
                  timezone: timezone || undefined,
                },
              });
              results.push({
                chatId,
                chatTitle,
                status: "awaiting-approval",
                taskId: task.id,
              });
            }
          }
        } catch (chatError) {
          results.push({
            chatId,
            chatTitle,
            status: "failed",
            error:
              chatError instanceof Error ? chatError.message : "Unknown error",
          });
        }
      }

      const allPublished = results.every((r) => r.status === "published");
      const anyFailed = results.some(
        (r) => r.status === "failed" || r.status === "error",
      );

      return c.json({
        success:
          !anyFailed ||
          results.some((r) => r.status !== "failed" && r.status !== "error"),
        results,
        message: allPublished
          ? "Published successfully!"
          : anyFailed
            ? "Some posts failed"
            : "Tasks created",
      });
    } catch (error) {
      console.error("[Posts] Error:", error);
      return c.json({ error: "Failed to create post" }, 500);
    }
  });

  // ============================================================================
  // KANBAN TASK BOARD API
  // ============================================================================

  /**
   * Get the full Kanban board (all tasks grouped by status)
   */
  app.get("/api/dashboard/tasks", async (c) => {
    if (!c.env.SESSIONS)
      return c.json({ error: "SESSIONS not configured" }, 400);

    try {
      const { getKanbanBoard } = await import("../utils/kanban-storage");
      const board = await getKanbanBoard(c.env.SESSIONS);
      return c.json(board);
    } catch (error) {
      console.error("[Tasks] Error loading board:", error);
      return c.json({ error: "Failed to load task board" }, 500);
    }
  });

  /**
   * Create a new task
   */
  app.post("/api/dashboard/tasks", async (c) => {
    if (!c.env.SESSIONS)
      return c.json({ error: "SESSIONS not configured" }, 400);

    try {
      const { createTask } = await import("../utils/kanban-storage");
      const body = (await c.req.json()) as {
        kind: "one-shot" | "recurring" | "persistent";
        status?: "queued" | "in-progress";
        title: string;
        description: string;
        schedule?: { cron?: string; runAt?: string; timezone?: string };
        chatId?: number;
        chatTitle?: string;
        role?: "content" | "moderator" | "support";
      };

      if (!body.title || !body.kind) {
        return c.json({ error: "title and kind are required" }, 400);
      }

      const task = await createTask(c.env.SESSIONS, {
        kind: body.kind,
        status:
          body.status ||
          (body.kind === "persistent" ? "in-progress" : "queued"),
        source: "owner",
        title: body.title,
        description: body.description || "",
        schedule: body.schedule,
        chatId: body.chatId,
        chatTitle: body.chatTitle,
        role: body.role,
      });

      return c.json({ success: true, task });
    } catch (error) {
      console.error("[Tasks] Error creating task:", error);
      return c.json({ error: "Failed to create task" }, 500);
    }
  });

  /**
   * Get a single task by ID
   */
  app.get("/api/dashboard/tasks/:taskId", async (c) => {
    if (!c.env.SESSIONS)
      return c.json({ error: "SESSIONS not configured" }, 400);

    try {
      const { getTask } = await import("../utils/kanban-storage");
      const task = await getTask(c.env.SESSIONS, c.req.param("taskId"));
      if (!task) return c.json({ error: "Task not found" }, 404);
      return c.json(task);
    } catch (error) {
      return c.json({ error: "Failed to load task" }, 500);
    }
  });

  /**
   * Update a task (move status, edit title/description)
   */
  app.post("/api/dashboard/tasks/:taskId", async (c) => {
    if (!c.env.SESSIONS)
      return c.json({ error: "SESSIONS not configured" }, 400);

    try {
      const { updateTask } = await import("../utils/kanban-storage");
      const body = (await c.req.json()) as {
        status?: "queued" | "in-progress" | "done" | "failed";
        title?: string;
        description?: string;
        schedule?: { cron?: string; runAt?: string; timezone?: string };
      };

      const task = await updateTask(
        c.env.SESSIONS,
        c.req.param("taskId"),
        body,
      );
      if (!task) return c.json({ error: "Task not found" }, 404);
      return c.json({ success: true, task });
    } catch (error) {
      // Surface state machine violations as 409 Conflict
      const msg =
        error instanceof Error ? error.message : "Failed to update task";
      const status = msg.includes("Invalid task transition") ? 409 : 500;
      return c.json({ error: msg }, status);
    }
  });

  /**
   * Move a task to a different status column
   */
  app.post("/api/dashboard/tasks/:taskId/move", async (c) => {
    if (!c.env.SESSIONS)
      return c.json({ error: "SESSIONS not configured" }, 400);

    try {
      const { moveTask } = await import("../utils/kanban-storage");
      const body = (await c.req.json()) as {
        status: "queued" | "in-progress" | "done" | "failed";
      };
      if (!body.status) return c.json({ error: "status is required" }, 400);

      const task = await moveTask(
        c.env.SESSIONS,
        c.req.param("taskId"),
        body.status,
      );
      if (!task) return c.json({ error: "Task not found" }, 404);
      return c.json({ success: true, task });
    } catch (error) {
      // Surface state machine violations as 409 Conflict
      const msg =
        error instanceof Error ? error.message : "Failed to move task";
      const status = msg.includes("Invalid task transition") ? 409 : 500;
      return c.json({ error: msg }, status);
    }
  });

  /**
   * Approve an awaiting-approval task.
   * - If it has schedule.runAt → move to "queued" (cron picks it up at the right time)
   * - If it has schedule.cron → move to "in-progress" as recurring
   * - Otherwise → publish immediately
   */
  app.post("/api/dashboard/tasks/:taskId/approve", async (c) => {
    if (!c.env.SESSIONS)
      return c.json({ error: "SESSIONS not configured" }, 400);

    try {
      const { getTask, updateTask, recordTaskRun, addTaskLog } =
        await import("../utils/kanban-storage");
      const taskId = c.req.param("taskId");
      const task = await getTask(c.env.SESSIONS, taskId);
      if (!task) return c.json({ error: "Task not found" }, 404);
      if (task.status !== "awaiting-approval") {
        return c.json({ error: "Task is not awaiting approval" }, 400);
      }

      const content = task.approval?.editedContent || task.approval?.content;
      const targetChatId = task.approval?.targetChatId;
      const targetChatTitle =
        task.approval?.targetChatTitle || `Chat ${targetChatId}`;

      if (!content || !targetChatId) {
        return c.json({ error: "Task missing content or target chat" }, 400);
      }

      // Update approval decision
      const approvedApproval = {
        ...task.approval!,
        requestedAt: task.approval!.requestedAt || new Date().toISOString(),
        respondedAt: new Date().toISOString(),
        decision: "approved" as const,
      };

      if (task.schedule?.runAt) {
        // Scheduled post → move to queued, cron processor will publish at runAt
        await updateTask(c.env.SESSIONS, taskId, {
          status: "queued",
          approval: approvedApproval,
        });
        await addTaskLog(
          c.env.SESSIONS,
          taskId,
          `Approved — scheduled for ${new Date(task.schedule.runAt).toLocaleString()}`,
          "approval",
        );
        return c.json({
          success: true,
          message: `Approved! Will publish at ${new Date(task.schedule.runAt).toLocaleString()}`,
        });
      }

      if (task.schedule?.cron) {
        // Recurring post → move to in-progress, cron processor handles it
        await updateTask(c.env.SESSIONS, taskId, {
          status: "in-progress",
          kind: "recurring",
          approval: approvedApproval,
        });
        await addTaskLog(
          c.env.SESSIONS,
          taskId,
          `Approved — recurring with cron: ${task.schedule.cron}`,
          "approval",
        );
        return c.json({
          success: true,
          message: `Approved! Recurring posts enabled (${task.schedule.cron})`,
        });
      }

      // No schedule → publish immediately
      if (!c.env.TELEGRAM_BOT_TOKEN) {
        return c.json({ error: "Bot not configured" }, 400);
      }

      // Normalize formatting (blank lines between title/body/CTA)
      const normalizedContent = normalizePostFormat(content);

      const tgRes = await telegramApiFetch(
        `https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: targetChatId,
            text: normalizedContent,
          }),
        },
      );
      const tgData = (await tgRes.json()) as {
        ok: boolean;
        description?: string;
      };

      if (tgData.ok) {
        await updateTask(c.env.SESSIONS, taskId, {
          status: "done",
          approval: approvedApproval,
        });
        await recordTaskRun(c.env.SESSIONS, taskId);
        await addTaskLog(
          c.env.SESSIONS,
          taskId,
          `Approved & published to ${targetChatTitle}`,
          "post",
        );
        return c.json({
          success: true,
          message: `Published to ${targetChatTitle}!`,
        });
      } else {
        const errDesc = tgData.description || "unknown";
        await addTaskLog(
          c.env.SESSIONS,
          taskId,
          `Publish failed: ${errDesc}`,
          "error",
        );

        // Auto-cleanup stale chat entries
        const isChatGone =
          errDesc.includes("chat not found") ||
          errDesc.includes("bot was kicked") ||
          errDesc.includes("bot is not a member");
        if (isChatGone && c.env.SESSIONS && targetChatId) {
          await removeStaleBotChat(c.env.SESSIONS, Number(targetChatId));
          console.warn(
            `[Approve] Removed stale chat "${targetChatTitle}" (${targetChatId}): ${errDesc}`,
          );
        }

        return c.json(
          {
            success: false,
            error: isChatGone
              ? `${errDesc}. Chat removed — re-add the bot as admin.`
              : tgData.description || "Telegram API error",
          },
          400,
        );
      }
    } catch (error) {
      console.error("[Approve] Error:", error);
      return c.json({ error: "Failed to approve task" }, 500);
    }
  });

  /**
   * Reject an awaiting-approval task → moves to "failed"
   */
  app.post("/api/dashboard/tasks/:taskId/reject", async (c) => {
    if (!c.env.SESSIONS)
      return c.json({ error: "SESSIONS not configured" }, 400);

    try {
      const { rejectTask } = await import("../utils/kanban-storage");
      const task = await rejectTask(c.env.SESSIONS, c.req.param("taskId"));
      if (!task) return c.json({ error: "Task not found" }, 404);
      return c.json({ success: true });
    } catch (error) {
      return c.json({ error: "Failed to reject task" }, 500);
    }
  });

  /**
   * Delete a task
   */
  app.delete("/api/dashboard/tasks/:taskId", async (c) => {
    if (!c.env.SESSIONS)
      return c.json({ error: "SESSIONS not configured" }, 400);

    try {
      const { deleteTask } = await import("../utils/kanban-storage");
      const deleted = await deleteTask(c.env.SESSIONS, c.req.param("taskId"));
      if (!deleted) return c.json({ error: "Task not found" }, 404);
      return c.json({ success: true });
    } catch (error) {
      return c.json({ error: "Failed to delete task" }, 500);
    }
  });

  // ============================================================================
  // SETUP WIZARD API (Roles + Auto-Task Creation)
  // ============================================================================

  /**
   * Get current setup (roles configuration)
   */
  app.get("/api/dashboard/setup", async (c) => {
    if (!c.env.SESSIONS)
      return c.json({ error: "SESSIONS not configured" }, 400);

    try {
      const raw = await c.env.SESSIONS.get("setup:roles");
      const roles = raw ? (JSON.parse(raw) as string[]) : [];
      return c.json({ roles, setupComplete: roles.length > 0 });
    } catch (error) {
      return c.json({ error: "Failed to load setup" }, 500);
    }
  });

  /**
   * Save setup (selected roles). Optionally auto-creates persistent tasks.
   */
  app.post("/api/dashboard/setup", async (c) => {
    if (!c.env.SESSIONS)
      return c.json({ error: "SESSIONS not configured" }, 400);

    try {
      const { createTask } = await import("../utils/kanban-storage");
      const { getKanbanBoard } = await import("../utils/kanban-storage");
      const body = (await c.req.json()) as {
        roles: string[];
        chatId?: number;
        chatTitle?: string;
      };

      if (!body.roles || !Array.isArray(body.roles)) {
        return c.json({ error: "roles array is required" }, 400);
      }

      // Save roles
      await c.env.SESSIONS.put("setup:roles", JSON.stringify(body.roles));

      // Auto-create persistent tasks for enabled roles (if they don't exist yet)
      const board = await getKanbanBoard(c.env.SESSIONS);
      const existingTitles = new Set([
        ...board.inProgress.map((t) => t.role),
        ...board.queued.map((t) => t.role),
      ]);

      const createdTasks: string[] = [];

      if (
        body.roles.includes("moderator") &&
        !existingTitles.has("moderator")
      ) {
        await createTask(c.env.SESSIONS, {
          kind: "persistent",
          status: "in-progress",
          source: "bot-auto",
          title: "Group Moderation",
          description:
            "Actively moderating group chats. Detecting spam, scam, hate speech, and flood.",
          role: "moderator",
          chatId: body.chatId,
          chatTitle: body.chatTitle,
        });
        createdTasks.push("moderator");
      }

      if (body.roles.includes("content") && !existingTitles.has("content")) {
        await createTask(c.env.SESSIONS, {
          kind: "persistent",
          status: "in-progress",
          source: "bot-auto",
          title: "Content Management",
          description:
            "Managing content creation and publishing to channels and groups.",
          role: "content",
          chatId: body.chatId,
          chatTitle: body.chatTitle,
        });
        createdTasks.push("content");
      }

      if (body.roles.includes("support") && !existingTitles.has("support")) {
        await createTask(c.env.SESSIONS, {
          kind: "persistent",
          status: "in-progress",
          source: "bot-auto",
          title: "Community Support",
          description:
            "Answering questions, responding to mentions, and helping users proactively.",
          role: "support",
          chatId: body.chatId,
          chatTitle: body.chatTitle,
        });
        createdTasks.push("support");
      }

      return c.json({
        success: true,
        roles: body.roles,
        createdTasks,
      });
    } catch (error) {
      console.error("[Setup] Error saving:", error);
      return c.json({ error: "Failed to save setup" }, 500);
    }
  });

  // ============================================================================
  // MODERATION LOGS API
  // ============================================================================

  /**
   * Get moderation logs for a specific chat
   */
  app.get("/api/dashboard/settings/:chatId/moderation-logs", async (c) => {
    const chatId = c.req.param("chatId");
    if (!chatId || !c.env.SESSIONS) {
      return c.json(
        { error: "Missing chatId or SESSIONS not configured" },
        400,
      );
    }

    try {
      const logsRaw = await c.env.SESSIONS.get(`mod_logs:${chatId}`);
      const logs = logsRaw ? JSON.parse(logsRaw) : [];

      return c.json({
        chatId,
        logs: logs.slice(0, 100), // Last 100 entries
        total: logs.length,
      });
    } catch (error) {
      console.error("[ModerationLogs] Error:", error);
      return c.json({ error: "Failed to load moderation logs" }, 500);
    }
  });

  /**
   * Clear moderation logs for a specific chat
   */
  app.delete("/api/dashboard/settings/:chatId/moderation-logs", async (c) => {
    const chatId = c.req.param("chatId");
    if (!chatId || !c.env.SESSIONS) {
      return c.json(
        { error: "Missing chatId or SESSIONS not configured" },
        400,
      );
    }

    try {
      await c.env.SESSIONS.delete(`mod_logs:${chatId}`);
      return c.json({ success: true });
    } catch (error) {
      return c.json({ error: "Failed to clear logs" }, 500);
    }
  });
}

// ============================================================================
// PIN LOGIN PAGE HTML
// ============================================================================

/**
 * Generate a self-contained HTML page for PIN-based dashboard login.
 * When `pin` is provided (from the URL ?pin=XXXXXX), it auto-submits.
 * Otherwise shows a manual PIN entry form.
 *
 * After successful auth the PIN is saved to localStorage and the page
 * redirects to `dashboardPath` (defaults to "/").
 */
function generatePinLoginPage(pin: string, dashboardPath: string): string {
  // Sanitise redirect target to prevent open redirect / XSS
  const safePath = /^\/[a-zA-Z0-9/_-]*$/.test(dashboardPath)
    ? dashboardPath
    : "/";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Dashboard Login</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
  background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%);
  color:#e2e8f0;min-height:100vh;min-height:100dvh;
  display:flex;align-items:center;justify-content:center;padding:16px;
}
.card{
  background:rgba(30,41,59,.85);backdrop-filter:blur(16px);
  border:1px solid rgba(148,163,184,.1);border-radius:20px;
  padding:40px 28px;max-width:380px;width:100%;text-align:center;
}
.icon{font-size:56px;margin-bottom:20px}
h1{font-size:22px;font-weight:700;margin-bottom:8px;color:#f1f5f9}
.sub{color:#94a3b8;font-size:14px;margin-bottom:28px;line-height:1.5}
.spinner{
  width:36px;height:36px;border:3px solid rgba(99,102,241,.2);
  border-top-color:#818cf8;border-radius:50%;
  animation:sp .7s linear infinite;margin:16px auto;
}
@keyframes sp{to{transform:rotate(360deg)}}
.err{color:#f87171;font-size:14px;margin-top:12px}
.ok{color:#34d399}
.btn{
  display:inline-block;
  background:linear-gradient(135deg,#6366f1,#8b5cf6);
  color:#fff;border:none;border-radius:12px;
  padding:14px 32px;font-size:16px;font-weight:600;cursor:pointer;
  margin-top:20px;text-decoration:none;transition:opacity .2s;
  -webkit-tap-highlight-color:transparent;
}
.btn:active{opacity:.8}
.pin-input{
  width:100%;padding:14px;font-size:28px;text-align:center;
  letter-spacing:12px;font-weight:700;
  background:rgba(15,23,42,.6);border:2px solid rgba(99,102,241,.3);
  border-radius:12px;color:#f1f5f9;outline:none;
  transition:border-color .2s;-webkit-appearance:none;
}
.pin-input:focus{border-color:#818cf8}
.pin-input::placeholder{color:#475569;letter-spacing:4px;font-size:18px}
.s{display:none}.s.on{display:block}
</style>
</head>
<body>
<div class="card">
  <div id="s-load" class="s">
    <div class="icon">\u{1F510}</div>
    <h1>Logging in\u2026</h1>
    <div class="spinner"></div>
    <p class="sub">Verifying your PIN</p>
  </div>
  <div id="s-form" class="s">
    <div class="icon">\u{1F510}</div>
    <h1>Dashboard Login</h1>
    <p class="sub">Enter your 6-digit PIN</p>
    <input id="inp" class="pin-input" type="tel" maxlength="6"
           inputmode="numeric" pattern="[0-9]*" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022" autofocus>
    <br>
    <button class="btn" onclick="go()">Open Dashboard</button>
    <div id="fe" class="err"></div>
  </div>
  <div id="s-ok" class="s">
    <div class="icon">\u2705</div>
    <h1 class="ok">Authenticated!</h1>
    <p class="sub">Opening dashboard\u2026</p>
  </div>
  <div id="s-err" class="s">
    <div class="icon">\u26A0\uFE0F</div>
    <h1>Login Failed</h1>
    <p id="em" class="err"></p>
    <button class="btn" onclick="show('s-form')">Try Again</button>
  </div>
</div>
<script>
var P=${JSON.stringify(pin)};
var D=${JSON.stringify(safePath)};
function show(id){
  var els=document.querySelectorAll('.s');
  for(var i=0;i<els.length;i++) els[i].className=els[i].id===id?'s on':'s';
}
function go(){
  var v=document.getElementById('inp').value.replace(/\\D/g,'');
  if(v.length!==6){document.getElementById('fe').textContent='Enter a 6-digit PIN';return}
  auth(v);
}
function auth(pin){
  show('s-load');
  fetch('/api/auth/login',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({pin:pin})
  })
  .then(function(r){return r.json()})
  .then(function(d){
    if(d.success){
      try{localStorage.setItem('dashboard_pin',pin)}catch(e){}
      show('s-ok');
      setTimeout(function(){location.href=D},600);
    }else{
      document.getElementById('em').textContent=d.error||'Invalid PIN';
      show('s-err');
    }
  })
  .catch(function(){
    document.getElementById('em').textContent='Connection error';
    show('s-err');
  });
}
if(P&&/^\\d{6}$/.test(P)){auth(P)}
else{
  show('s-form');
  var inp=document.getElementById('inp');
  inp.addEventListener('input',function(){
    var v=this.value.replace(/\\D/g,'');this.value=v;
    if(v.length===6)go();
  });
}
</script>
</body>
</html>`;
}
