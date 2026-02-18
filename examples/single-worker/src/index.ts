/**
 * Single Worker Example
 *
 * A clean single-worker template: AI Agent + Playground UI + MCP Servers.
 * Use this as a starting point for building AI agents on Cloudflare Workers.
 *
 * - agents.ts         — Agent Durable Object classes
 * - mcp-servers.ts    — MCP Server Durable Object classes
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

// Import from @nullshot/agent
import {
  generatePlaygroundHTML,
  routeToAgent,
  routeToAgentEndpoint,
  routeToMcp,
  type PlaygroundAgent,
} from "@nullshot/agent";

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
const agents: PlaygroundAgent[] = [
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
    allowHeaders: ["Content-Type"],
    exposeHeaders: ["X-Session-Id", "X-Audio-Url"],
  }),
);

// Root metadata endpoint
app.get("/api/info", (c) => {
  return c.json({
    name: "Single Worker",
    version: "1.0.0",
    description: "AI Agent + Playground UI + MCP Servers in a single worker",
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
    })),
    environment: c.env.ENVIRONMENT || "development",
    aiProvider: c.env.AI_PROVIDER || "anthropic",
  });
});

// List available agents
app.get("/api/agents", (c) => {
  return c.json({
    agents,
    total: agents.length,
  });
});

// List available MCP tools
app.get("/api/tools", (c) => {
  return c.json({
    mcpServers: [
      "TODO_MCP",
      "EXPENSE_MCP",
      "ENV_VARIABLE_MCP",
      "SECRET_MCP",
      "IMAGE_MCP",
      "VOICE_MCP",
    ],
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
      // Image MCP
      {
        name: "generate_image",
        description: "Generate an image from a text description",
        source: "IMAGE_MCP",
      },
      // Voice MCP
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
// HEALTH CHECK
// ============================================================================

app.get("/health", async (c) => {
  const checks: Record<string, { status: string; detail?: string }> = {};

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
    // Only check keys if not using Workers AI
    const keyMap: Record<string, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPEN_AI_API_KEY",
      deepseek: "DEEPSEEK_API_KEY",
      google: "GOOGLE_API_KEY",
      grok: "GROK_API_KEY",
    };
    const requiredKey = keyMap[provider];
    // We cast to any to check the key on env
    const hasKey = requiredKey && (c.env as any)[requiredKey];

    if (hasKey) {
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
// PLAYGROUND UI
// ============================================================================

app.get("/", (c) => {
  return c.html(
    generatePlaygroundHTML({
      agents,
      tabs: [],
      title: "Single Worker",
      primaryColor: "#00d4aa",
      secondaryColor: "#14b8a6",
    }),
  );
});
app.get("/playground", (c) => {
  return c.html(
    generatePlaygroundHTML({
      agents,
      tabs: [],
      title: "Single Worker",
      primaryColor: "#00d4aa",
      secondaryColor: "#14b8a6",
    }),
  );
});

// ============================================================================
// AGENT ROUTING
// ============================================================================

// MCP info endpoints
app.get("/agent/simple-prompt/mcp", (c) =>
  routeToAgentEndpoint(c, c.env.SIMPLE_PROMPT_AGENT as any, "/mcp"),
);
app.get("/agent/dependent/mcp", (c) =>
  routeToAgentEndpoint(c, c.env.DEPENDENT_AGENT as any, "/mcp"),
);

// Simple Prompt Agent
app.all("/agent/simple-prompt/chat/:sessionId?", async (c) => {
  return routeToAgent(c, c.env.SIMPLE_PROMPT_AGENT as any, "sessionId");
});

// Dependent Agent
app.all("/agent/dependent/chat/:sessionId?", async (c) => {
  return routeToAgent(c, c.env.DEPENDENT_AGENT as any, "sessionId");
});

// Backward compatibility
app.all("/agent/chat/:sessionId?", async (c) => {
  return routeToAgent(c, c.env.SIMPLE_PROMPT_AGENT as any, "sessionId");
});

// ============================================================================
// MCP SERVER ROUTING (optional external access)
// ============================================================================

app.all("/mcp/todo/*", async (c) => {
  return routeToMcp(c, c.env.TODO_MCP as any);
});

app.all("/mcp/expense/*", async (c) => {
  return routeToMcp(c, c.env.EXPENSE_MCP as any);
});

app.all("/mcp/env-variable/*", async (c) => {
  return routeToMcp(c, c.env.ENV_VARIABLE_MCP as any);
});

app.all("/mcp/secret/*", async (c) => {
  return routeToMcp(c, c.env.SECRET_MCP as any);
});

app.all("/mcp/image/*", async (c) => {
  return routeToMcp(c, c.env.IMAGE_MCP as any);
});

app.all("/mcp/voice/*", async (c) => {
  return routeToMcp(c, c.env.VOICE_MCP as any);
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
};
