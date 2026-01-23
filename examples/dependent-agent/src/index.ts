import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createXai } from "@ai-sdk/xai";
import { LanguageModel, Provider, stepCountIs } from "ai";

import {
  AiSdkAgent,
  type AIUISDKMessage,
  ToolboxService,
  type MCPConfig,
} from "@nullshot/agent";
import mcpConfig from "../mcp.json";

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: "*", // Allow any origin for development; restrict this in production
    allowMethods: ["POST", "GET", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    exposeHeaders: ["X-Session-Id"],
    maxAge: 86400, // 24 hours
  })
);

// Root endpoint - provide agent metadata
app.get("/", (c) => {
  return c.json({
    name: "Dependent Agent",
    version: "0.1.0",
    description: "Agent with dependent MCP services",
    endpoints: {
      "/": "Agent metadata (this endpoint)",
      "/agent/chat/:sessionId": "Chat endpoint for agent interactions",
    },
    features: ["Conversational AI", "MCP tool support", "Multiple AI provider support"],
  });
});

// Route all requests to the durable object instance based on session
app.all("/agent/chat/:sessionId?", async (c) => {
  const { AGENT } = c.env;
  var sessionIdStr = c.req.param("sessionId");

  if (!sessionIdStr || sessionIdStr == "") {
    sessionIdStr = AGENT.newUniqueId().toString();
  }

  const id = AGENT.idFromName(sessionIdStr);

  const forwardRequest = new Request(
    "https://internal.com/agent/chat/" + sessionIdStr,
    {
      method: c.req.method,
      body: c.req.raw.body,
    }
  );

  // Forward to Durable Object and get response
  return await AGENT.get(id).fetch(forwardRequest);
});

export class DependentAgent extends AiSdkAgent<Env> {
  constructor(state: DurableObjectState, env: Env) {
    let provider: Provider;
    let model: LanguageModel;

    switch (env.AI_PROVIDER) {
      case "anthropic":
        provider = createAnthropic({
          apiKey: env.AI_PROVIDER_API_KEY,
        });
        model = provider.languageModel(env.MODEL_ID || "claude-3-haiku-20240307");
        break;

      case "openai":
        provider = createOpenAI({
          apiKey: env.AI_PROVIDER_API_KEY,
        });
        model = provider.languageModel(env.MODEL_ID || "gpt-4o-mini");
        break;

      case "deepseek":
        provider = createDeepSeek({
          apiKey: env.AI_PROVIDER_API_KEY,
        });
        model = provider.languageModel(env.MODEL_ID || "deepseek-chat");
        break;

      case "grok":
        provider = createXai({
          apiKey: env.AI_PROVIDER_API_KEY,
        });
        model = provider.languageModel(env.MODEL_ID || "grok-beta");
        break;

      default:
        throw new Error(`Unsupported AI provider: ${env.AI_PROVIDER}. Supported: anthropic, openai, deepseek, grok`);
    }

    super(state, env, model, [new ToolboxService(env, mcpConfig)]);
  }

  async processMessage(
    sessionId: string,
    messages: AIUISDKMessage
  ): Promise<Response> {
    // Use the protected streamTextWithMessages method - model is handled automatically by the agent
    const result = await this.streamTextWithMessages(
      sessionId,
      messages.messages,
      {
        system:
          "You are a conversational expert, enjoying deep, intellectual conversations.",
        maxSteps: 10,
        stopWhen: stepCountIs(10),
        // Enable MCP tools from imported mcp.json
        experimental_toolCallStreaming: true,
        onError: (error: unknown) => {
          console.error("Error processing message", error);
        },
      },
    );

    // Use toTextStreamResponse() for compatibility with playground
    return result.toTextStreamResponse();
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
};
