/**
 * Agent Durable Object Classes
 *
 * Extracted from index.ts — contains SimplePromptAgent and DependentAgent.
 * Re-exported from index.ts so wrangler can discover them as DO bindings.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createXai } from "@ai-sdk/xai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createWorkersAI } from "workers-ai-provider";
import { LanguageModel, type Provider } from "ai";

import {
  AiSdkAgent,
  type AIUISDKMessage,
  ToolboxService,
  Service,
} from "@nullshot/agent";

/**
 * Retry helper for transient Workers AI errors.
 * Workers AI returns 3007 (timeout), 3040 (out of capacity), 429 (rate limit).
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  baseDelay = 800,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!/3007|3040|429|timeout|capacity/i.test(msg) || i === retries)
        throw e;
      console.warn(`[Agent] Retry ${i + 1}/${retries}: ${msg}`);
      await new Promise((r) => setTimeout(r, baseDelay * Math.pow(2, i)));
    }
  }
  throw lastError;
}

// ============================================================================
// SIMPLE PROMPT AGENT
// ============================================================================

/**
 * SimplePromptAgent - General purpose AI assistant with MCP tools
 * Based on examples/simple-prompt-agent
 * Supports multiple AI providers: OpenAI, Anthropic, DeepSeek, Google, xAI, Workers AI
 */
const DEFAULT_SYSTEM_PROMPT =
  "You are a friendly, helpful AI assistant. Have natural conversations with users. Answer questions, help with tasks, and be conversational.";

export class SimplePromptAgent extends AiSdkAgent<any> {
  constructor(state: DurableObjectState, env: Env) {
    let provider: Provider;
    let model: LanguageModel;

    // Select AI provider based on env variable
    // Default: Workers AI (free, no API key needed)
    const aiProvider = (env.AI_PROVIDER || "workers-ai").toLowerCase();

    switch (aiProvider) {
      case "anthropic":
        if (!env.ANTHROPIC_API_KEY) break; // fall through to default
        provider = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
        model = provider.languageModel(
          env.MODEL_ID || "claude-3-haiku-20240307",
        );
        break;

      case "openai":
        if (!env.OPEN_AI_API_KEY) break;
        provider = createOpenAI({ apiKey: env.OPEN_AI_API_KEY });
        model = provider.languageModel(env.MODEL_ID || "gpt-4o-mini");
        break;

      case "deepseek":
        if (!env.DEEPSEEK_API_KEY) break;
        provider = createDeepSeek({ apiKey: env.DEEPSEEK_API_KEY });
        model = provider.languageModel(env.MODEL_ID || "deepseek-chat");
        break;

      case "grok":
      case "xai":
        if (!env.GROK_API_KEY) break;
        provider = createXai({ apiKey: env.GROK_API_KEY });
        model = provider.languageModel(env.MODEL_ID || "grok-beta");
        break;

      case "google":
      case "gemini":
        if (!env.GOOGLE_API_KEY) break;
        provider = createGoogleGenerativeAI({ apiKey: env.GOOGLE_API_KEY });
        model = provider.languageModel(env.MODEL_ID || "gemini-1.5-flash");
        break;

      default:
        break;
    }

    // Fallback to Workers AI if no provider was configured or API key is missing
    if (!model!) {
      console.log(
        `[SimplePromptAgent] Using Workers AI (provider "${aiProvider}" not configured or missing API key)`,
      );
      const workersAi = createWorkersAI({ binding: env.AI! });
      model = workersAi(
        (env.MODEL_ID || "@cf/meta/llama-3.1-8b-instruct-fast") as any,
      );
      provider = workersAi as unknown as Provider;
    }

    // SimplePromptAgent: NO MCP tools, just a simple conversational agent
    super(state, env, model, []);
  }

  async processMessage(
    sessionId: string,
    messages: AIUISDKMessage,
  ): Promise<Response> {
    console.log(
      `[SimplePromptAgent] Processing message for session: ${sessionId}`,
    );
    console.log(
      `[SimplePromptAgent] AI Provider: ${this.env.AI_PROVIDER || "workers-ai"}`,
    );

    // Mock mode: return deterministic response without calling AI
    if ((this.env as any).USE_MOCK_AI === "true") {
      console.log("🎭 Using mock AI mode");
      const last = messages.messages[messages.messages.length - 1];
      const userText =
        typeof last?.content === "string" ? last.content : "Hello";
      const reply = `Mock response: I received your message "${userText}". This is a mock response for local testing without API keys.`;
      return new Response(`0:"${reply}"`, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Session-Id": sessionId,
        },
      });
    }

    // Use custom system prompt from request body if provided, otherwise default
    const customPrompt = (messages as any).systemPrompt;
    const systemPrompt =
      typeof customPrompt === "string" && customPrompt.trim()
        ? customPrompt.trim()
        : DEFAULT_SYSTEM_PROMPT;

    if (customPrompt) {
      console.log(
        `[SimplePromptAgent] Using custom system prompt (${systemPrompt.length} chars)`,
      );
    }

    try {
      const result = await withRetry(() =>
        this.streamTextWithMessages(sessionId, messages.messages, {
          system: systemPrompt,
          onError: (error: unknown) => {
            console.error("[SimplePromptAgent] Error:", error);
          },
        }),
      );

      return result.toTextStreamResponse();
    } catch (error) {
      console.error("[SimplePromptAgent] Error processing message:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return new Response(
        `0:"Sorry, I encountered an error: ${errorMessage}"`,
        {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "X-Session-Id": sessionId,
          },
        },
      );
    }
  }
}

// ============================================================================
// DEPENDENT AGENT
// ============================================================================

/**
 * DependentAgent - Conversational expert for deep, intellectual conversations
 * Based on examples/dependent-agent
 * Uses AI_PROVIDER_API_KEY (single key for all providers)
 */
export class DependentAgent extends AiSdkAgent<any> {
  constructor(state: DurableObjectState, env: Env) {
    let provider: Provider;
    let model: LanguageModel;

    // Select AI provider, falling back to Workers AI if no API key is available
    const aiProvider = (env.AI_PROVIDER || "workers-ai").toLowerCase();

    switch (aiProvider) {
      case "anthropic": {
        const key = env.AI_PROVIDER_API_KEY || env.ANTHROPIC_API_KEY;
        if (!key) break;
        provider = createAnthropic({ apiKey: key });
        model = provider.languageModel(
          env.MODEL_ID || "claude-3-haiku-20240307",
        );
        break;
      }

      case "openai": {
        const key = env.AI_PROVIDER_API_KEY || env.OPEN_AI_API_KEY;
        if (!key) break;
        provider = createOpenAI({ apiKey: key });
        model = provider.languageModel(env.MODEL_ID || "gpt-4o-mini");
        break;
      }

      case "deepseek": {
        const key = env.AI_PROVIDER_API_KEY || env.DEEPSEEK_API_KEY;
        if (!key) break;
        provider = createDeepSeek({ apiKey: key });
        model = provider.languageModel(env.MODEL_ID || "deepseek-chat");
        break;
      }

      case "grok":
      case "xai": {
        const key = env.AI_PROVIDER_API_KEY || env.GROK_API_KEY;
        if (!key) break;
        provider = createXai({ apiKey: key });
        model = provider.languageModel(env.MODEL_ID || "grok-beta");
        break;
      }

      case "google":
      case "gemini": {
        const key = env.AI_PROVIDER_API_KEY || env.GOOGLE_API_KEY;
        if (!key) break;
        provider = createGoogleGenerativeAI({ apiKey: key });
        model = provider.languageModel(env.MODEL_ID || "gemini-1.5-flash");
        break;
      }

      default:
        break;
    }

    // Fallback to Workers AI if no provider was configured or API key is missing
    if (!model!) {
      console.log(
        `[DependentAgent] Using Workers AI (provider "${aiProvider}" not configured or missing API key)`,
      );
      const workersAi = createWorkersAI({ binding: env.AI! });
      model = workersAi(
        (env.MODEL_ID || "@cf/meta/llama-3.1-8b-instruct-fast") as any,
      );
      provider = workersAi as unknown as Provider;
    }

    // Initialize with ToolboxService - will auto-discover co-located MCP servers!
    const services: Service[] = [new ToolboxService(env as any)];
    super(state, env, model, services);
  }

  async processMessage(
    sessionId: string,
    messages: AIUISDKMessage,
  ): Promise<Response> {
    console.log(
      `[DependentAgent] session=${sessionId}, messages=${messages.messages.length}`,
    );

    try {
      const result = await withRetry(() =>
        this.streamTextWithMessages(sessionId, messages.messages, {
          system: `You are a helpful AI assistant with access to many tools.
Always use the appropriate tool when the user's request matches one of your available tools.
After using a tool, describe the result clearly to the user.
For image generation, include the image URL as markdown: ![image](/media/image/ID)
For voice/audio, include a link to the audio file.
Do NOT output JSON for tool calls — use the tools directly.`,
          maxSteps: 2,
        }),
      );

      // Collect full text (awaits all steps including tool calls)
      const fullText = await result.text;
      const steps = await result.steps;

      let responseText = fullText;

      // If model called tools but didn't generate follow-up text, build response from tool results
      if (!responseText && steps.length > 0) {
        const parts: string[] = [];
        for (const step of steps) {
          if (step.text) parts.push(step.text);
          if (step.toolResults) {
            for (const tr of step.toolResults as any[]) {
              const raw = typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result);
              try {
                const parsed = JSON.parse(raw);
                const text = Array.isArray(parsed)
                  ? parsed.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n")
                  : parsed.content
                    ? parsed.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n")
                    : raw;
                parts.push(text);
              } catch {
                parts.push(raw);
              }
            }
          }
        }
        responseText = parts.join("\n").trim();
      }

      return new Response(responseText || "No response generated.", {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Session-Id": sessionId,
        },
      });
    } catch (error) {
      console.error("[DependentAgent] Error:", error);
      return new Response(
        `Sorry, I encountered an error: ${error instanceof Error ? error.message : "Unknown error"}`,
        {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "X-Session-Id": sessionId,
          },
        },
      );
    }
  }
}
