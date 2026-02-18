/**
 * Shared environment interface for the Telegram Bot Agent.
 *
 * This is the superset of all fields required by every handler, utility,
 * and the main index.  Handlers that only need a subset will still
 * accept this type thanks to TypeScript structural typing.
 *
 * Exported so that external consumers (e.g. single-worker) can properly
 * type the environment object they construct for the bot.
 */
export interface TelegramBotEnv {
  /** Bot API token (secret) */
  TELEGRAM_BOT_TOKEN: string;

  /** Default agent endpoint URL */
  AGENT_URL: string;

  /** Comma-separated agents: "name1|url1|desc1,name2|url2|desc2" */
  AGENTS?: string;

  /** Optional secret for webhook validation */
  TELEGRAM_WEBHOOK_SECRET?: string;

  /** KV namespace for sessions, channels, moderation, scheduled posts */
  SESSIONS: KVNamespace;

  /** Service binding to agent worker (preferred over HTTP fetch) */
  AGENT_SERVICE?: Fetcher;

  /** Workers AI binding — on-device inference (embeddings, LLM, image gen) */
  AI?: Ai;

  /** Vectorize index for semantic chat memory (stores message embeddings) */
  CHAT_MEMORY?: VectorizeIndex;

  /** Telegram chat ID to send activity logs to */
  LOG_CHAT_ID?: string;

  /**
   * Bot owner's Telegram user ID (optional).
   * If set, this user is always the owner.
   * If not set, the first user to /start the bot in DM becomes the owner
   * (auto-claim, stored in KV as "owner:id").
   */
  OWNER_ID?: string;

  /** Minimum log level: "debug" | "info" | "warn" | "error" (default: "info") */
  LOG_LEVEL?: string;
}
