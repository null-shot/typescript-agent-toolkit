/**
 * Worker Configuration Types
 * Generated types for Cloudflare Worker bindings
 */

interface Env {
  // Index signature for compatibility with Record<string, unknown>
  [key: string]: unknown;

  // Durable Object bindings — Agents
  SIMPLE_PROMPT_AGENT: DurableObjectNamespace;
  DEPENDENT_AGENT: DurableObjectNamespace;
  AGENT: DurableObjectNamespace; // Required by AgentEnv (aliases SIMPLE_PROMPT_AGENT)

  // Durable Object bindings — MCP Servers
  TODO_MCP: DurableObjectNamespace;
  EXPENSE_MCP: DurableObjectNamespace;
  ENV_VARIABLE_MCP: DurableObjectNamespace;
  SECRET_MCP: DurableObjectNamespace;
  IMAGE_MCP: DurableObjectNamespace;
  VOICE_MCP: DurableObjectNamespace;

  // Environment variables
  AI_PROVIDER: string;
  ENVIRONMENT?: string;
  DEFAULT_NAME?: string;
  SECRET_NUMBER?: string;
  USE_MOCK_AI?: string;

  // API Keys (set via wrangler secret put)
  OPEN_AI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  AI_PROVIDER_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  GROK_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  MODEL_ID?: string;

  // Cloudflare credentials (for Workers AI)
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_KEY?: string;

  // Workers AI binding — on-device inference (embeddings, LLM, image gen)
  AI?: Ai;

  // Vectorize index for semantic chat memory
  CHAT_MEMORY?: VectorizeIndex;

  // Telegram Bot Agent bindings
  TELEGRAM_BOT_TOKEN?: string;
  AGENT_URL?: string;
  AGENTS?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  LOG_CHAT_ID?: string;
  OWNER_ID?: string;
  LOG_LEVEL?: string;
  SESSIONS: KVNamespace;
}
