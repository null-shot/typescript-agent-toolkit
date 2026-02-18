/**
 * Single Worker Example
 *
 * This example demonstrates the single-worker architecture:
 * - One worker handles everything
 * - Playground UI + Agent + MCP Servers + Telegram Bot (all in one!)
 * - 0 subrequests between components (all internal DO calls)
 * - Tabbed UI: Web Agents + Telegram Agents
 *
 * Based on simple-prompt-agent but with embedded UI, MCP, and Telegram Bot.
 *
 * Code is split into focused modules:
 * - agents.ts         — Agent Durable Object classes
 * - mcp-servers.ts    — MCP Server Durable Object classes
 * - dashboard-routes.ts — Auth + Telegram Agents dashboard API routes
 * - telegram-routes.ts  — Telegram webhook/test/health routes + bot singleton
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

// Import from @nullshot/agent
import {
  setupPlaygroundRoutes,
  generatePlaygroundHTML,
  routeToAgent,
  routeToAgentEndpoint,
  routeToMcp,
  type PlaygroundAgent,
  type PlaygroundTab,
} from "@nullshot/agent";

// Route modules
import { setupDashboardRoutes, DASHBOARD_PIN_KEY } from "./dashboard-routes";
import { setupTelegramRoutes } from "./telegram-routes";
import { createDoAgentFetcher } from "../../telegram-bot-agent/src/utils/do-agent-fetcher";

// Re-export Durable Object classes (wrangler needs them in the entry point)
export { SimplePromptAgent, DependentAgent } from "./agents";
export {
  TodoMcpServer,
  ExpenseMcpServer,
  EnvVariableMcpServer,
  SecretMcpServer,
  ImageMcpServer,
  VoiceMcpServer,
} from "./mcp-servers";

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Define the agents available in this worker
 * Multiple agents can be configured and switched in Playground UI
 */
const baseAgents: PlaygroundAgent[] = [
  {
    id: "simple-prompt",
    name: "Simple Prompt Agent",
    description: "A helpful AI assistant with MCP tools for task management",
    path: "/agent/simple-prompt",
  },
  {
    id: "dependent",
    name: "Dependent Agent",
    description:
      "An expert conversational agent for deep, intellectual conversations",
    path: "/agent/dependent",
    systemPrompt: false,
  },
];

/**
 * Dashboard tab for Telegram Agents
 */
const dashboardTab: PlaygroundTab = {
  id: "dashboard",
  label: "Telegram Agents",
  icon: "",
  apiPath: "/api/dashboard",
  type: "dashboard",
};

/**
 * Build playground config with agents and tabs
 * Dashboard tab only shown when TELEGRAM_BOT_TOKEN is set
 */
function getPlaygroundConfig(env: Env) {
  const tabs: PlaygroundTab[] = [];
  if (env.TELEGRAM_BOT_TOKEN) {
    tabs.push(dashboardTab);
  }
  return {
    agents: baseAgents,
    tabs,
  };
}

// ============================================================================
// HONO APP SETUP
// ============================================================================

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "X-Telegram-Bot-Api-Secret-Token",
      "X-Dashboard-Pin",
    ],
    exposeHeaders: ["X-Session-Id", "X-Audio-Url"],
  }),
);

// Root metadata endpoint — adapts based on configured modules
app.get("/api/info", (c) => {
  const telegramConfigured = !!c.env.TELEGRAM_BOT_TOKEN;

  const endpoints: Record<string, string> = {
    "/": telegramConfigured
      ? "Playground UI (Web Agents + Telegram Agents)"
      : "Playground UI (Web Agents)",
    "/health": "Health check",
    "/api/agents": "List of agents",
    "/api/tools": "List of available MCP tools",
    "/agent/simple-prompt/chat/:sessionId?": "Simple Prompt Agent chat",
    "/agent/dependent/chat/:sessionId?": "Dependent Agent chat",
    "/agent/chat/:sessionId?": "Default agent (simple-prompt)",
    "/mcp/todo/*": "Todo MCP Server",
    "/mcp/expense/*": "Expense Tracking MCP Server",
    "/mcp/env-variable/*": "Env Variable MCP Server",
    "/mcp/secret/*": "Secret Guessing MCP Server",
  };

  // Only expose Telegram/Dashboard endpoints when configured
  if (telegramConfigured) {
    endpoints["/api/dashboard"] = "Telegram Agents dashboard data";
    endpoints["/telegram/webhook"] = "Telegram Bot webhook";
    endpoints["/telegram/health"] = "Telegram Bot health check";
  }

  return c.json({
    name: "Single Worker Example",
    version: "0.3.0",
    description: "Single-worker with Playground + Agents + MCP + Telegram Bot",
    telegramSetup: !telegramConfigured
      ? "Run: cd examples/single-worker && pnpm exec wrangler secret put TELEGRAM_BOT_TOKEN"
      : undefined,
    agents: getPlaygroundConfig(c.env).agents.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
    })),
    endpoints,
    environment: c.env.ENVIRONMENT || "development",
    aiProvider: c.env.AI_PROVIDER || "anthropic",
    telegramConfigured,
  });
});

// List available agents
app.get("/api/agents", (c) => {
  const { agents } = getPlaygroundConfig(c.env);
  return c.json({
    agents,
    total: agents.length,
  });
});

// List available MCP tools
app.get("/api/tools", (c) => {
  return c.json({
    mcpServers: ["TODO_MCP", "EXPENSE_MCP", "ENV_VARIABLE_MCP", "SECRET_MCP", "IMAGE_MCP", "VOICE_MCP"],
    tools: [
      // Todo MCP
      {
        name: "create_todo",
        description: "Create a new todo item",
        source: "TODO_MCP",
      },
      {
        name: "list_todos",
        description: "List all todo items",
        source: "TODO_MCP",
      },
      {
        name: "complete_todo",
        description: "Mark a todo as completed",
        source: "TODO_MCP",
      },
      {
        name: "delete_todo",
        description: "Delete a todo item",
        source: "TODO_MCP",
      },
      // Expense MCP
      {
        name: "submit_expense",
        description: "Submit a new expense",
        source: "EXPENSE_MCP",
      },
      {
        name: "approve_expense",
        description: "Approve an expense",
        source: "EXPENSE_MCP",
      },
      {
        name: "reject_expense",
        description: "Reject an expense",
        source: "EXPENSE_MCP",
      },
      {
        name: "list_expenses",
        description: "List all expenses",
        source: "EXPENSE_MCP",
      },
      // Env Variable MCP
      {
        name: "greeting",
        description: "Send a greeting",
        source: "ENV_VARIABLE_MCP",
      },
      // Secret MCP
      {
        name: "guess_number",
        description: "Guess the secret number",
        source: "SECRET_MCP",
      },
      {
        name: "generate_image",
        description: "Generate an image from a text description",
        source: "IMAGE_MCP",
      },
      {
        name: "text_to_speech",
        description: "Convert text to speech audio",
        source: "VOICE_MCP",
      },
    ],
    total: 12,
  });
});

// ============================================================================
// REGISTER ROUTE MODULES
// ============================================================================

// Dashboard routes (auth + all /api/dashboard/* endpoints)
// NOTE: must be registered BEFORE telegram routes to ensure auth middleware
// is applied before any dashboard request.
setupDashboardRoutes(app, (env) => getPlaygroundConfig(env).agents, {
  // Single-worker: route AI generation to the agent DO directly
  getAgentService: (env) => {
    const ns = env.SIMPLE_PROMPT_AGENT as DurableObjectNamespace | undefined;
    if (!ns) return undefined;
    return createDoAgentFetcher(ns);
  },
});

// Telegram routes (test, health, webhook)
setupTelegramRoutes(app);

// KV debug — helps diagnose SESSIONS binding issues
app.get("/api/debug/kv", async (c) => {
  if (!c.env.SESSIONS) {
    return c.json({ ok: false, error: "SESSIONS binding not configured" });
  }
  try {
    await c.env.SESSIONS.get("_health_check");
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg });
  }
});

// ============================================================================
// HEALTH CHECK — validates all dependencies
// ============================================================================

app.get("/health", async (c) => {
  const checks: Record<string, { status: string; detail?: string }> = {};

  // KV Store
  try {
    if (c.env.SESSIONS) {
      await c.env.SESSIONS.get("_health_check");
      checks.kv = { status: "ok" };
    } else {
      checks.kv = {
        status: "error",
        detail: "SESSIONS binding not configured",
      };
    }
  } catch (e) {
    checks.kv = {
      status: "error",
      detail: e instanceof Error ? e.message : "Unknown error",
    };
  }

  // AI Provider
  const provider = (c.env.AI_PROVIDER || "workers-ai").toLowerCase();
  if (provider === "workers-ai") {
    checks.ai = {
      status: c.env.AI ? "ok" : "error",
      detail: c.env.AI
        ? "Provider: Workers AI (Llama, free tier)"
        : "Provider: Workers AI — AI binding missing!",
    };
  } else {
    const keyMap: Record<string, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPEN_AI_API_KEY",
      deepseek: "DEEPSEEK_API_KEY",
      google: "GOOGLE_API_KEY",
      grok: "GROK_API_KEY",
    };
    const requiredKey = keyMap[provider];
    if (requiredKey && (c.env as Record<string, unknown>)[requiredKey]) {
      checks.ai = { status: "ok", detail: `Provider: ${provider}` };
    } else if (requiredKey) {
      checks.ai = {
        status: "error",
        detail: `${requiredKey} not set for provider "${provider}"`,
      };
    } else {
      checks.ai = {
        status: "warning",
        detail: `Unknown provider: ${provider}`,
      };
    }
  }

  // Telegram Bot
  if (c.env.TELEGRAM_BOT_TOKEN) {
    const pinExists = await c.env.SESSIONS?.get(DASHBOARD_PIN_KEY);
    checks.telegram = {
      status: "ok",
      detail: pinExists
        ? "Configured, PIN set"
        : "Token set, PIN not yet generated (send /start)",
    };
  } else {
    checks.telegram = {
      status: "skipped",
      detail: "TELEGRAM_BOT_TOKEN not set (optional)",
    };
  }

  // Workers AI
  checks.workersAi = {
    status: c.env.AI ? "ok" : "skipped",
    detail: c.env.AI
      ? "AI binding active (embeddings, LLM, image gen)"
      : "AI binding not configured (optional)",
  };

  // Vectorize (Chat Memory)
  checks.vectorize = {
    status: c.env.CHAT_MEMORY ? "ok" : "skipped",
    detail: c.env.CHAT_MEMORY
      ? "chat-memory index active"
      : "CHAT_MEMORY not configured (optional)",
  };

  // Durable Objects
  checks.durableObjects = {
    status: c.env.SIMPLE_PROMPT_AGENT ? "ok" : "error",
    detail: "Agent bindings",
  };

  const allOk = Object.values(checks).every(
    (c) => c.status === "ok" || c.status === "skipped",
  );

  return c.json(
    {
      status: allOk ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      checks,
    },
    allOk ? 200 : 503,
  );
});

// ============================================================================
// PLAYGROUND UI
// ============================================================================

// Playground UI — dynamic: shows Telegram Bot agent & Dashboard tab only when TELEGRAM_BOT_TOKEN is set
app.get("/", (c) => {
  const { agents, tabs } = getPlaygroundConfig(c.env);
  return c.html(
    generatePlaygroundHTML({
      agents,
      tabs,
      title: "Single Worker Playground",
      primaryColor: "#00d4aa",
      secondaryColor: "#14b8a6",
    }),
  );
});
app.get("/playground", (c) => {
  const { agents, tabs } = getPlaygroundConfig(c.env);
  return c.html(
    generatePlaygroundHTML({
      agents,
      tabs,
      title: "Single Worker Playground",
      primaryColor: "#00d4aa",
      secondaryColor: "#14b8a6",
    }),
  );
});

// ============================================================================
// AGENT ROUTING
// ============================================================================

// MCP info endpoints — playground fetches {agentPath}/mcp to show MCP chips
app.get("/agent/simple-prompt/mcp", (c) =>
  routeToAgentEndpoint(c, c.env.SIMPLE_PROMPT_AGENT, "/mcp"),
);
app.get("/agent/dependent/mcp", (c) =>
  routeToAgentEndpoint(c, c.env.DEPENDENT_AGENT, "/mcp"),
);

// Simple Prompt Agent
app.all("/agent/simple-prompt/chat/:sessionId?", async (c) => {
  return routeToAgent(c, c.env.SIMPLE_PROMPT_AGENT, "sessionId");
});

// Dependent Agent
app.all("/agent/dependent/chat/:sessionId?", async (c) => {
  return routeToAgent(c, c.env.DEPENDENT_AGENT, "sessionId");
});

// Backward compatibility - route to default agent (Simple Prompt)
app.all("/agent/chat/:sessionId?", async (c) => {
  return routeToAgent(c, c.env.SIMPLE_PROMPT_AGENT, "sessionId");
});

// ============================================================================
// MCP SERVER ROUTING (optional external access)
// ============================================================================

app.all("/mcp/todo/*", async (c) => {
  return routeToMcp(c, c.env.TODO_MCP);
});

app.all("/mcp/expense/*", async (c) => {
  return routeToMcp(c, c.env.EXPENSE_MCP);
});

app.all("/mcp/env-variable/*", async (c) => {
  return routeToMcp(c, c.env.ENV_VARIABLE_MCP);
});

app.all("/mcp/secret/*", async (c) => {
  return routeToMcp(c, c.env.SECRET_MCP);
});

app.all("/mcp/image/*", async (c) => {
  return routeToMcp(c, c.env.IMAGE_MCP);
});

app.all("/mcp/voice/*", async (c) => {
  return routeToMcp(c, c.env.VOICE_MCP);
});

// ============================================================================
// TEXT-TO-SPEECH API (used by frontend auto-voice)
// ============================================================================

app.post("/api/tts", async (c) => {
  const doId = c.env.VOICE_MCP.idFromName("mcp-singleton");
  const stub = c.env.VOICE_MCP.get(doId);
  return stub.fetch(
    new Request("https://internal.do/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await c.req.text(),
    }),
  );
});

// ============================================================================
// MEDIA SERVING (images, audio generated by MCP servers)
// ============================================================================

app.get("/media/image/:id", async (c) => {
  const mediaId = c.req.param("id");
  const doId = c.env.IMAGE_MCP.idFromName("mcp-singleton");
  const stub = c.env.IMAGE_MCP.get(doId);
  return stub.fetch(new Request(`https://internal.do/media/${mediaId}`));
});

app.get("/media/audio/:id", async (c) => {
  const mediaId = c.req.param("id");
  const doId = c.env.VOICE_MCP.idFromName("mcp-singleton");
  const stub = c.env.VOICE_MCP.get(doId);
  return stub.fetch(new Request(`https://internal.do/media/${mediaId}`));
});

// ============================================================================
// WORKER EXPORT
// ============================================================================

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  // Cron trigger for Kanban scheduled/recurring tasks (runs every minute)
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (!env.TELEGRAM_BOT_TOKEN || !env.SESSIONS) {
      return; // Telegram bot not configured, skip
    }

    try {
      const { hasAnyTasks, getKanbanBoard, cleanupOldTasks } =
        await import("../../telegram-bot-agent/src/utils/kanban-storage");
      const { processKanbanScheduledTasks, processKanbanRecurringTasks } =
        await import("../../telegram-bot-agent/src/utils/cron-processor");

      // Short-circuit if no tasks exist
      const hasTasks = await hasAnyTasks(env.SESSIONS);
      if (!hasTasks) return;

      // Route AI generation to the agent DO (avoids external AGENT_URL)
      const agentServiceAdapter = createDoAgentFetcher(env.SIMPLE_PROMPT_AGENT);

      const cronEnv = {
        TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN!,
        AGENT_URL: "",
        SESSIONS: env.SESSIONS,
        AGENT_SERVICE: agentServiceAdapter,
        AI: env.AI,
      };

      const board = await getKanbanBoard(env.SESSIONS);

      ctx.waitUntil(processKanbanScheduledTasks(cronEnv, board));
      ctx.waitUntil(processKanbanRecurringTasks(cronEnv, board));

      // Cleanup once per hour
      const now = new Date();
      if (now.getUTCMinutes() === 0) {
        ctx.waitUntil(
          cleanupOldTasks(env.SESSIONS, 30).then((removed: number) => {
            if (removed > 0) {
              console.log(`[Cron] Cleanup: removed ${removed} old tasks`);
            }
          }),
        );
      }
    } catch (error) {
      console.error("[Cron] Error processing kanban tasks:", error);
    }
  },
};
