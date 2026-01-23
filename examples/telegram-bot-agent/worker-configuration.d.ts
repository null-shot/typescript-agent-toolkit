/// <reference types="@cloudflare/workers-types" />

interface Env {
	// Telegram Bot Token (set as secret)
	TELEGRAM_BOT_TOKEN: string;

	// Agent URL - where to forward messages
	AGENT_URL: string;

	// Optional: Webhook secret for security
	TELEGRAM_WEBHOOK_SECRET?: string;

	// KV namespace for session storage
	SESSIONS: KVNamespace;
}
