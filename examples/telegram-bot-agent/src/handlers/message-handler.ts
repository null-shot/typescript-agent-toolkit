import { Context } from "grammy";
import { getOrCreateSessionData } from "../utils/session";
import { streamAgentResponse } from "../utils/agent-client";
import { getMessageHistory, addToHistory, historyToModelMessages, getAgentSystemPrompt } from "../utils/message-history";
import { getCurrentAgentUrl, getCurrentAgentName, getCurrentAgentId } from "./agent-handler";

interface Env {
	TELEGRAM_BOT_TOKEN: string;
	AGENT_URL: string;
	AGENTS?: string;
	TELEGRAM_WEBHOOK_SECRET?: string;
	SESSIONS: KVNamespace;
	AGENT_SERVICE?: Fetcher;  // Service binding to agent (preferred over HTTP)
}

/**
 * Escape special characters for Telegram Markdown
 */
function escapeMarkdown(text: string): string {
	return text.replace(/[_*`\[\]]/g, "\\$&");
}

/**
 * Handle incoming Telegram messages and forward to agent
 * 
 * Best Practices:
 * - Async/await for clean error handling
 * - Streaming responses for better UX
 * - Session management per chat
 * - Error handling with user-friendly messages
 */
export async function handleMessage(
	ctx: Context,
	env: Env,
	messageText: string
): Promise<void> {
	const chatId = ctx.chat?.id;
	if (!chatId) {
		console.error("No chat ID in context");
		return;
	}

	try {
		console.log(`🔍 Getting session for chat ${chatId}...`);
		// Get or create session for this chat
		const sessionData = await getOrCreateSessionData(env.SESSIONS, chatId.toString());
		const sessionId = sessionData.sessionId;
		console.log(`✅ Session ID: ${sessionId}`);

		// Get selected agent info
		const agentUrl = await getCurrentAgentUrl(env, chatId.toString());
		const agentName = await getCurrentAgentName(env, chatId.toString());
		const agentId = await getCurrentAgentId(env, chatId.toString());
		console.log(`🤖 Using agent: ${agentName} (${agentUrl})`);

		// Get message history for context
		const history = await getMessageHistory(env.SESSIONS, sessionId);
		// Pass current agentId to mark messages from other agents
		const historyMessages = historyToModelMessages(history, agentId);

		// Generate system prompt that tells agent who it is and about conversation history
		const systemPrompt = getAgentSystemPrompt(agentName, history);
		console.log(`📝 System prompt: "${systemPrompt.substring(0, 100)}..."`);

		// Add user message to history (no agent info for user messages)
		await addToHistory(env.SESSIONS, sessionId, "user", messageText);

		// Stream response from agent
		let fullResponse = "";  // Accumulate ALL chunks here
		let messageSent = false;
		let messageId: number | undefined;
		let lastUpdateTime = Date.now();
		const UPDATE_INTERVAL = 500; // Update message every 500ms to avoid too frequent edits

		// Combine system prompt + history + new message
		const allMessages = [
			{ role: "system" as const, content: systemPrompt },
			...historyMessages,
			{ role: "user" as const, content: messageText }
		];

		console.log(`🔄 Starting to stream response...`);
		// Only use service binding if using default agent URL
		const useServiceBinding = !!env.AGENT_SERVICE && agentUrl === env.AGENT_URL;
		console.log(`🔗 Using service binding: ${useServiceBinding ? 'YES' : 'NO (using HTTP to ' + agentUrl + ')'}`);
		let chunkCount = 0;
		
		await streamAgentResponse(
			agentUrl,
			sessionId,
			allMessages,
			async (chunk: string) => {
				chunkCount++;
				console.log(`📨 Chunk #${chunkCount} received: "${chunk.substring(0, 50)}${chunk.length > 50 ? '...' : ''}"`);
				fullResponse += chunk;  // Always accumulate, never slice during streaming

				const now = Date.now();
				const shouldUpdate = now - lastUpdateTime >= UPDATE_INTERVAL;

				// Send first chunk as new message
				if (!messageSent && fullResponse.length > 50) {
					console.log(`📤 Sending first message (${fullResponse.length} chars)...`);
					const textToSend = fullResponse.length > 4096 ? fullResponse.slice(0, 4096) : fullResponse;
					const sent = await ctx.reply(textToSend);
					messageId = sent.message_id;
					messageSent = true;
					lastUpdateTime = now;
					console.log(`✅ First message sent! ID: ${messageId}`);
				}
				// Update message with accumulated text (throttled)
				else if (messageSent && messageId && shouldUpdate && fullResponse.length > 0) {
					try {
						const textToSend = fullResponse.length > 4096 ? fullResponse.slice(0, 4096) : fullResponse;
						console.log(`✏️ Editing message ${messageId} (${fullResponse.length} total chars, showing ${textToSend.length})...`);
						await ctx.api.editMessageText(chatId, messageId, textToSend);
						lastUpdateTime = now;
						console.log(`✅ Message updated!`);
					} catch (error) {
						console.error(`❌ Failed to edit message:`, error);
						// If edit fails, don't break - continue accumulating
					}
				}
			},
			useServiceBinding ? env.AGENT_SERVICE : undefined  // Only pass service binding if using default agent
		);
		
		console.log(`📊 Stream complete. Total chunks: ${chunkCount}, Full response length: ${fullResponse.length}`);

		// Save assistant response to history with agent info
		if (fullResponse.length > 0) {
			console.log(`💾 Saving response from ${agentName} to history (${fullResponse.length} chars)...`);
			await addToHistory(env.SESSIONS, sessionId, "assistant", fullResponse, agentId, agentName);
		}

		// Add agent signature to the response for Telegram
		// Escape agent name for Markdown to prevent formatting issues
		const escapedAgentName = escapeMarkdown(agentName);
		const agentSignature = `🤖 *${escapedAgentName}*\n\n`;
		const signedResponse = agentSignature + fullResponse;

		// Send final message with COMPLETE response and agent signature
		if (fullResponse.length > 0) {
			console.log(`📤 Sending final response from ${agentName} (${fullResponse.length} chars)...`);
			
			// Calculate max content length accounting for signature
			const maxContentLength = 4096 - agentSignature.length;
			
			if (messageSent && messageId) {
				try {
					// Send first part in the existing message
					const firstPart = signedResponse.slice(0, 4096);
					console.log(`✏️ Final edit of message ${messageId} with complete text (${firstPart.length} chars)...`);
					await ctx.api.editMessageText(chatId, messageId, firstPart, { parse_mode: "Markdown" });
					console.log(`✅ Final message updated with complete text!`);
					
					// Send remaining parts as new messages if needed
					if (signedResponse.length > 4096) {
						const remainingParts = Math.ceil((signedResponse.length - 4096) / 4096);
						console.log(`📤 Sending ${remainingParts} additional messages for remaining text...`);
						for (let i = 4096; i < signedResponse.length; i += 4096) {
							await ctx.reply(signedResponse.slice(i, i + 4096));
						}
					}
				} catch (error) {
					console.error(`❌ Failed to edit final message:`, error);
					// If edit fails (e.g. Markdown error), send as new message without formatting
					const firstPart = `🤖 ${agentName}\n\n` + fullResponse.slice(0, 4096 - agentName.length - 10);
					await ctx.reply(firstPart);
					if (fullResponse.length > maxContentLength) {
						for (let i = maxContentLength; i < fullResponse.length; i += 4096) {
							await ctx.reply(fullResponse.slice(i, i + 4096));
						}
					}
				}
			} else {
				console.log(`📤 Sending as new message (nothing sent yet)...`);
				// Send as new message if nothing was sent yet
				try {
					const firstPart = signedResponse.slice(0, 4096);
					await ctx.reply(firstPart, { parse_mode: "Markdown" });
					console.log(`✅ Message sent!`);
					if (signedResponse.length > 4096) {
						for (let i = 4096; i < signedResponse.length; i += 4096) {
							await ctx.reply(signedResponse.slice(i, i + 4096));
						}
					}
				} catch (error) {
					// Fallback without Markdown
					const firstPart = `🤖 ${agentName}\n\n` + fullResponse.slice(0, 4096 - agentName.length - 10);
					await ctx.reply(firstPart);
					if (fullResponse.length > maxContentLength) {
						for (let i = maxContentLength; i < fullResponse.length; i += 4096) {
							await ctx.reply(fullResponse.slice(i, i + 4096));
						}
					}
				}
			}
		} else {
			console.warn(`⚠️ No response content to send!`);
		}
	} catch (error) {
		console.error("Error in handleMessage:", error);
		if (error instanceof Error) {
			console.error("Error message:", error.message);
			console.error("Error stack:", error.stack);
			console.error("Error name:", error.name);
		}
		// Отправляем более информативное сообщение для отладки
		await ctx.reply(
			`❌ Ошибка: ${error instanceof Error ? error.message : 'Unknown error'}\n\nПопробуйте еще раз или используйте /status для проверки соединения.`
		);
		throw error;
	}
}
