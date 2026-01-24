import { Bot, webhookCallback } from "grammy";
import { Hono } from "hono";
import { handleMessage } from "./handlers/message-handler";
import { getOrCreateSessionData } from "./utils/session";
import { setupAgentHandlers, getAvailableAgents, getCurrentAgentName, getCurrentAgentUrl } from "./handlers/agent-handler";

/**
 * Telegram Bot Agent - Connects Telegram users to AI agents
 * 
 * Best Practices 2025:
 * - Uses Grammy (modern, type-safe Telegram Bot library)
 * - Cloudflare Workers optimized
 * - Webhook-based (no polling)
 * - Stateless architecture with KV storage
 * - Error handling and rate limiting
 */

interface Env {
	TELEGRAM_BOT_TOKEN: string;
	AGENT_URL: string;
	AGENTS?: string;  // Format: "name1|url1,name2|url2"
	TELEGRAM_WEBHOOK_SECRET?: string;
	SESSIONS: KVNamespace;
	AGENT_SERVICE?: Fetcher;  // Service binding to agent (preferred over HTTP)
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// Initialize Grammy bot with Cloudflare adapter
		const bot = new Bot(env.TELEGRAM_BOT_TOKEN, {
			client: {
				apiRoot: "https://api.telegram.org",
			},
		});

		// Create Hono app for routing
		const app = new Hono<{ Bindings: Env }>();

		// Health check endpoint
		app.get("/health", (c) => {
			return c.json({ status: "ok", service: "telegram-bot-agent" });
		});

		// Webhook endpoint for Telegram
		app.post("/webhook", async (c) => {
			try {
				// Optional: Validate webhook secret for security
				if (env.TELEGRAM_WEBHOOK_SECRET) {
					const secret = c.req.header("X-Telegram-Bot-Api-Secret-Token");
					if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
						return c.json({ error: "Unauthorized" }, 401);
					}
				}

				// Handle webhook with Grammy
				// Grammy's webhookCallback works with Cloudflare Workers out of the box
				const handler = webhookCallback(bot, "std/http", {
					secretToken: env.TELEGRAM_WEBHOOK_SECRET,
				});

				return await handler(request);
			} catch (error) {
				console.error("Webhook error:", error);
				return c.json({ error: "Internal server error" }, 500);
			}
		});

		// Setup bot handlers
		setupBotHandlers(bot, env);

		// Handle all other routes
		return app.fetch(request, env, ctx);
	},
};

/**
 * Setup Grammy bot handlers with best practices
 */
function setupBotHandlers(bot: Bot, env: Env): void {
	// Setup agent selection handlers first
	setupAgentHandlers(bot, env);

	// Get available agents for display
	const agents = getAvailableAgents(env);
	const agentCount = agents.length;

	// Start command handler
	bot.command("start", async (ctx) => {
		const chatId = ctx.chat?.id;
		if (!chatId) return;
		const userName = ctx.from?.first_name || "User";

		// Get or create session for this chat
		await getOrCreateSessionData(env.SESSIONS, chatId.toString());

		// Get current agent name
		const currentAgentName = await getCurrentAgentName(env, chatId.toString());

		await ctx.reply(
			`👋 Hello ${userName}!\n\n` +
				`I'm connected to <b>${currentAgentName}</b>.\n` +
				(agentCount > 1 ? `📋 ${agentCount} agents available - use /agent to switch\n\n` : "\n") +
				`Commands:\n` +
				`/start - Start conversation\n` +
				`/help - Show help\n` +
				`/agent - Select AI agent\n` +
				`/status - Check connection status\n` +
				`/clear - Clear conversation history`,
			{ parse_mode: "HTML" }
		);
	});

	// Help command
	bot.command("help", async (ctx) => {
		const chatId = ctx.chat?.id;
		if (!chatId) return;
		const currentAgentName = await getCurrentAgentName(env, chatId.toString());

		await ctx.reply(
			`📚 <b>Available commands:</b>\n\n` +
				`/start - Start a new conversation\n` +
				`/help - Show this help message\n` +
				`/agent - Select AI agent (${agentCount} available)\n` +
				`/status - Check agent connection status\n` +
				`/clear - Clear conversation history\n\n` +
				`📍 Current agent: <b>${currentAgentName}</b>\n\n` +
				`Just send me a message to chat!`,
			{ parse_mode: "HTML" }
		);
	});

	// Status command
	bot.command("status", async (ctx) => {
		const chatId = ctx.chat?.id;
		if (!chatId) return;
		
		const currentAgentName = await getCurrentAgentName(env, chatId.toString());

		// getCurrentAgentUrl is imported at top of file
		const agentUrl = await getCurrentAgentUrl(env, chatId.toString());

		try {
			// Test agent connection
			const response = await fetch(`${agentUrl}/`, {
				method: "GET",
				signal: AbortSignal.timeout(5000),
			});

			if (response.ok) {
				await ctx.reply(
					`✅ <b>${currentAgentName}</b> is online and ready!`,
					{ parse_mode: "HTML" }
				);
			} else {
				await ctx.reply(
					`⚠️ <b>${currentAgentName}</b> responded but may have issues.`,
					{ parse_mode: "HTML" }
				);
			}
		} catch (error) {
			await ctx.reply(
				`❌ <b>${currentAgentName}</b> is offline or unreachable.\n\nUse /agent to select a different agent.`,
				{ parse_mode: "HTML" }
			);
		}
	});

	// Clear history command
	bot.command("clear", async (ctx) => {
		const chatId = ctx.chat?.id;
		if (!chatId) return;
		const sessionData = await getOrCreateSessionData(env.SESSIONS, chatId.toString());
		
		// Import here to avoid circular dependency
		const { clearHistory } = await import("./utils/message-history");
		await clearHistory(env.SESSIONS, sessionData.sessionId);

		const currentAgentName = await getCurrentAgentName(env, chatId.toString());
		
		await ctx.reply(
			`🗑️ Conversation history cleared!\n\n📍 Current agent: <b>${currentAgentName}</b>`,
			{ parse_mode: "HTML" }
		);
	});

	// Handle all text messages
	bot.on("message:text", async (ctx) => {
		const chatId = ctx.chat?.id;
		if (!chatId) return;
		const messageText = ctx.message.text;

		// Show typing indicator
		await ctx.api.sendChatAction(chatId, "typing");

		try {
			// Handle message forwarding to agent
			await handleMessage(ctx, env, messageText);
		} catch (error) {
			console.error("Error handling message:", error);
			await ctx.reply(
				"❌ Sorry, I encountered an error processing your message. Please try again."
			);
		}
	});

	// Handle errors
	bot.catch((err) => {
		console.error("Bot error:", err);
	});
}
