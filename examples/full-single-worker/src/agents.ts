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
import { generateText, LanguageModel, type Provider, stepCountIs } from "ai";

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

const DEFAULT_SYSTEM_PROMPT =
  "You are a friendly, helpful AI assistant. Have natural conversations with users. Answer questions, help with tasks, and be conversational.";

export class SimplePromptAgent extends AiSdkAgent<any> {
  constructor(state: DurableObjectState, env: Env) {
    let provider: Provider;
    let model: LanguageModel;

    const aiProvider = (env.AI_PROVIDER || "workers-ai").toLowerCase();

    switch (aiProvider) {
      case "anthropic":
        if (!env.ANTHROPIC_API_KEY) break;
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

    if (!model!) {
      console.log(
        `[SimplePromptAgent] Using Workers AI (provider "${aiProvider}" not configured or missing API key)`,
      );
      const workersAi = createWorkersAI({ binding: env.AI! });
      model = workersAi(
        (env.MODEL_ID || "@cf/meta/llama-3.3-70b-instruct-fp8-fast") as any,
      );
      provider = workersAi as unknown as Provider;
    }

    super(state, env, model, []);
  }

  async processMessage(
    sessionId: string,
    messages: AIUISDKMessage,
  ): Promise<Response> {
    console.log(
      `[SimplePromptAgent] Processing message for session: ${sessionId}`,
    );

    if ((this.env as any).USE_MOCK_AI === "true") {
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

    const customPrompt = (messages as any).systemPrompt;
    const systemPrompt =
      typeof customPrompt === "string" && customPrompt.trim()
        ? customPrompt.trim()
        : DEFAULT_SYSTEM_PROMPT;

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

export class DependentAgent extends AiSdkAgent<any> {
  constructor(state: DurableObjectState, env: Env) {
    let provider: Provider;
    let model: LanguageModel;

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

    if (!model!) {
      console.log(
        `[DependentAgent] Using Workers AI (provider "${aiProvider}" not configured or missing API key)`,
      );
      const workersAi = createWorkersAI({ binding: env.AI! });
      model = workersAi(
        (env.MODEL_ID || "@cf/meta/llama-3.3-70b-instruct-fp8-fast") as any,
      );
      provider = workersAi as unknown as Provider;
    }

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
      let tools: any = undefined;
      for (const mw of (this as any).middleware || []) {
        if (mw.transformStreamTextTools) {
          tools = mw.transformStreamTextTools(tools);
        }
      }

      const toolCount = tools ? Object.keys(tools).length : 0;
      console.log(
        `[DependentAgent] Using generateText with ${toolCount} tools`,
      );

      const result = await withRetry(() =>
        generateText({
          model: (this as any).model,
          messages: messages.messages as any,
          tools,
          system: `You are a helpful AI assistant with access to tools.
When the user asks you to generate an image, use the generate_image tool.
When the user asks to generate voice/audio or speak something, use the text_to_speech tool.
For all other requests, reply with plain text.
Do NOT output JSON for tool calls — use the tools directly.`,
          stopWhen: stepCountIs(1),
        }),
      );

      let responseText = result.text || "";
      let imageMarkdown = "";
      let explicitAudioUrl = "";

      for (const step of result.steps) {
        if (step.toolResults?.length) {
          for (const tr of step.toolResults) {
            const trAny = tr as any;
            const toolName = trAny.toolName;
            const raw =
              typeof (trAny.result ?? trAny.output) === "string"
                ? (trAny.result ?? trAny.output)
                : JSON.stringify(trAny.result ?? trAny.output);

            let text = raw;
            try {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) {
                text = parsed
                  .filter((p: any) => p.type === "text")
                  .map((p: any) => p.text)
                  .join("\n");
              } else if (parsed.content) {
                text = parsed.content
                  .filter((p: any) => p.type === "text")
                  .map((p: any) => p.text)
                  .join("\n");
              }
            } catch {
              /* not JSON */
            }

            if (toolName === "generate_image") {
              const urlMatch = text.match(/URL:\s*(\/media\/image\/[^\s]+)/);
              if (urlMatch) {
                imageMarkdown += `\n\n![image](${urlMatch[1]})`;
              }
            } else if (toolName === "text_to_speech") {
              const urlMatch = text.match(/\/media\/audio\/[a-f0-9-]+/);
              if (urlMatch) {
                explicitAudioUrl = urlMatch[0];
              }
            } else {
              responseText += "\n" + text;
            }
          }
        }
      }

      const trimmed = responseText.trim();
      if (trimmed) {
        responseText = trimmed + imageMarkdown;
      } else if (imageMarkdown) {
        responseText = imageMarkdown.trim();
      } else if (explicitAudioUrl) {
        responseText = "Audio generated.";
      } else {
        responseText = "No response generated.";
      }

      const headers: Record<string, string> = {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Session-Id": sessionId,
      };
      if (explicitAudioUrl) {
        headers["X-Audio-Url"] = explicitAudioUrl;
      }

      return new Response(responseText, { status: 200, headers });
    } catch (error) {
      console.error("[DependentAgent] Error processing message:", error);
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
