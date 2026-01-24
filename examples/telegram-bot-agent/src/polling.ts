/**
 * Polling mode for Telegram bot (like Python solutions)
 * 
 * This runs as a separate process for local development
 * No webhook needed - just poll Telegram API for updates
 */

import { Bot } from "grammy";
import { handleMessage } from "./handlers/message-handler";
import { getOrCreateSession } from "./utils/session";

interface Env {
	TELEGRAM_BOT_TOKEN: string;
	AGENT_URL: string;
	SESSIONS: KVNamespace;
}

/**
 * Start bot in polling mode
 * This continuously polls Telegram API for new messages
 */
export async function startPolling(env: Env): Promise<void> {
	const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

	// Setup handlers
	setupBotHandlers(bot, env);

	// Start polling
	console.log("🤖 Starting Telegram bot in polling mode...");
	console.log("📡 Polling for updates...");

	await bot.start({
		drop_pending_updates: true, // Ignore old updates on startup
		allowed_updates: ["message"], // Only listen to messages
	});

	console.log("✅ Bot is running! Press Ctrl+C to stop.");
}

/**
 * Setup bot handlers (same as webhook version)
 */
function setupBotHandlers(bot: Bot, env: Env): void {
	// Start command
	bot.command("start", async (ctx) => {
		const chatId = ctx.chat.id;
		const userName = ctx.from?.first_name || "User";

		await getOrCreateSession(env.SESSIONS, chatId.toString());

		await ctx.reply(
			`👋 Hello ${userName}!\n\n` +
				`I'm your AI assistant. Send me a message and I'll help you.\n\n` +
				`Commands:\n` +
				`/start - Start conversation\n` +
				`/help - Show help\n` +
				`/status - Check connection status\n` +
				`/clear - Clear conversation history`
		);
	});

	// Help command
	bot.command("help", async (ctx) => {
		await ctx.reply(
			`📚 Available commands:\n\n` +
				`/start - Start a new conversation\n` +
				`/help - Show this help message\n` +
				`/status - Check agent connection status\n` +
				`/clear - Clear conversation history\n\n` +
				`Just send me a message to chat with the AI agent!`
		);
	});

	// Status command
	bot.command("status", async (ctx) => {
		try {
			const response = await fetch(`${env.AGENT_URL}/`, {
				method: "GET",
				signal: AbortSignal.timeout(5000),
			});

			if (response.ok) {
				await ctx.reply("✅ Agent is online and ready!");
			} else {
				await ctx.reply("⚠️ Agent responded but may have issues.");
			}
		} catch (error) {
			await ctx.reply(
				"❌ Agent is offline or unreachable. Please try again later."
			);
		}
	});

	// Clear history command
	bot.command("clear", async (ctx) => {
		const chatId = ctx.chat.id;
		const sessionId = await getOrCreateSession(env.SESSIONS, chatId.toString());
		
		const { clearHistory } = await import("./utils/message-history");
		await clearHistory(env.SESSIONS, sessionId);
		
		await ctx.reply("🗑️ Conversation history cleared!");
	});

	// Handle text messages
	bot.on("message:text", async (ctx) => {
		const chatId = ctx.chat.id;
		const messageText = ctx.message.text;

		console.log(`📨 Received message from ${chatId}: ${messageText}`);

		await ctx.api.sendChatAction(chatId, "typing");

		try {
			console.log(`🔄 Forwarding message to agent at ${env.AGENT_URL}...`);
			await handleMessage(ctx, env, messageText);
			console.log(`✅ Message processed successfully`);
		} catch (error) {
			console.error("❌ Error handling message:", error);
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
