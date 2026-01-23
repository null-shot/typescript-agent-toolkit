/**
 * Message History Management
 * 
 * Stores conversation history in KV for context
 * Each session maintains its own message history
 * 
 * Best Practices:
 * - Store history per session
 * - Limit history size to avoid KV limits
 * - JSON serialization for messages
 */

// Maximum messages to keep in history
// Can be increased, but consider KV limits:
// - KV value size limit: 25 MB
// - Each message ~100-500 bytes (depends on content)
// - 1000 messages ≈ ~500 KB (safe)
// - 10000 messages ≈ ~5 MB (still safe)
// - 50000 messages ≈ ~25 MB (near limit)
const MAX_HISTORY_LENGTH = 1000; // Increased from 50 to 1000 for better context

export interface StoredMessage {
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: number;
	agentId?: string;      // ID агента который отправил (для assistant)
	agentName?: string;    // Имя агента (для отображения)
}

/**
 * Get message history for a session
 * 
 * @param kv - KV namespace
 * @param sessionId - Session ID
 * @returns Array of messages
 */
export async function getMessageHistory(
	kv: KVNamespace,
	sessionId: string
): Promise<StoredMessage[]> {
	try {
		const historyJson = await kv.get(`history:${sessionId}`);
		if (!historyJson) {
			return [];
		}
		return JSON.parse(historyJson) as StoredMessage[];
	} catch (error) {
		console.error("Error getting message history:", error);
		return [];
	}
}

/**
 * Add message to history
 * 
 * @param kv - KV namespace
 * @param sessionId - Session ID
 * @param role - Message role
 * @param content - Message content
 * @param agentId - Optional agent ID (for assistant messages)
 * @param agentName - Optional agent name (for display)
 */
export async function addToHistory(
	kv: KVNamespace,
	sessionId: string,
	role: "user" | "assistant" | "system",
	content: string,
	agentId?: string,
	agentName?: string
): Promise<void> {
	try {
		const history = await getMessageHistory(kv, sessionId);
		
		// Add new message
		const message: StoredMessage = {
			role,
			content,
			timestamp: Date.now(),
		};
		
		// Add agent info for assistant messages
		if (role === "assistant" && agentId) {
			message.agentId = agentId;
			message.agentName = agentName;
		}
		
		history.push(message);

		// Limit history size
		if (history.length > MAX_HISTORY_LENGTH) {
			history.shift(); // Remove oldest message
		}

		// Store back to KV
		await kv.put(`history:${sessionId}`, JSON.stringify(history), {
			expirationTtl: 60 * 60 * 24 * 30, // 30 days
		});
	} catch (error) {
		console.error("Error adding to history:", error);
	}
}

/**
 * Clear message history for a session
 * 
 * @param kv - KV namespace
 * @param sessionId - Session ID
 */
export async function clearHistory(
	kv: KVNamespace,
	sessionId: string
): Promise<void> {
	await kv.delete(`history:${sessionId}`);
}

/**
 * Convert stored messages to ModelMessage format
 * Marks messages from different agents so current agent understands context
 * 
 * @param history - Stored message history
 * @param currentAgentId - Current agent ID (to distinguish own vs other agents' messages)
 * @returns ModelMessage array
 */
export function historyToModelMessages(history: StoredMessage[], currentAgentId?: string) {
	return history.map((msg) => {
		// For assistant messages from different agents, add prefix
		if (msg.role === "assistant" && msg.agentName && msg.agentId !== currentAgentId) {
			return {
				role: msg.role,
				content: `[${msg.agentName}]: ${msg.content}`,
			};
		}
		return {
			role: msg.role,
			content: msg.content,
		};
	});
}

/**
 * Get system prompt that tells agent who it is
 * 
 * @param agentName - Current agent name
 * @param _history - Conversation history (unused, kept for API compatibility)
 * @returns System prompt string
 */
export function getAgentSystemPrompt(agentName: string, _history: StoredMessage[]): string {
	return `You are ${agentName}.`;
}
