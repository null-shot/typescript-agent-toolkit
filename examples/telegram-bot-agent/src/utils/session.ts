/**
 * Session Management
 * 
 * Maps Telegram chatId to agent sessionId and stores selected agent
 * Uses KV for persistent storage (stateless architecture)
 */

import { loggers } from "./logger"

const log = loggers.bot

export interface SessionData {
	sessionId: string
	selectedAgentId?: string
	selectedAgentUrl?: string
	createdAt: number
	updatedAt: number
}

/**
 * Get or create session data for a Telegram chat
 * 
 * @param kv - KV namespace for storage
 * @param chatId - Telegram chat ID
 * @returns Session data with sessionId and selected agent
 */
export async function getOrCreateSessionData(
	kv: KVNamespace,
	chatId: string
): Promise<SessionData> {
	const key = `session:${chatId}`
	const existing = await kv.get(key)

	if (existing) {
		try {
			return JSON.parse(existing) as SessionData
		} catch (error) {
			log.debug("Invalid session JSON, creating new", { chatId, error })
		}
	}

	// Create new session
	const sessionData: SessionData = {
		sessionId: crypto.randomUUID(),
		createdAt: Date.now(),
		updatedAt: Date.now(),
	}

	await kv.put(key, JSON.stringify(sessionData), {
		expirationTtl: 60 * 60 * 24 * 30, // 30 days
	})

	return sessionData
}

/**
 * Get or create a session ID for a Telegram chat
 * (Backward compatible wrapper)
 * 
 * @param kv - KV namespace for storage
 * @param chatId - Telegram chat ID
 * @returns Agent session ID
 */
export async function getOrCreateSession(
	kv: KVNamespace,
	chatId: string
): Promise<string> {
	const sessionData = await getOrCreateSessionData(kv, chatId)
	return sessionData.sessionId
}

/**
 * Update selected agent for a chat
 * Keeps same sessionId to preserve shared conversation history across agents
 * Each agent's messages are marked with agentId/agentName in history
 * 
 * @param kv - KV namespace for storage
 * @param chatId - Telegram chat ID
 * @param agentId - Selected agent ID
 * @param agentUrl - Selected agent URL
 */
export async function setSelectedAgent(
	kv: KVNamespace,
	chatId: string,
	agentId: string,
	agentUrl: string
): Promise<SessionData> {
	const key = `session:${chatId}`
	const existing = await getOrCreateSessionData(kv, chatId)

	// Keep same sessionId - history is shared across agents
	// Messages are marked with which agent sent them
	const sessionData: SessionData = {
		sessionId: existing.sessionId, // Keep same session!
		selectedAgentId: agentId,
		selectedAgentUrl: agentUrl,
		createdAt: existing.createdAt,
		updatedAt: Date.now(),
	}

	await kv.put(key, JSON.stringify(sessionData), {
		expirationTtl: 60 * 60 * 24 * 30, // 30 days
	})

	return sessionData
}

/**
 * Get selected agent URL for a chat
 * 
 * @param kv - KV namespace for storage
 * @param chatId - Telegram chat ID
 * @returns Selected agent URL or undefined
 */
export async function getSelectedAgentUrl(
	kv: KVNamespace,
	chatId: string
): Promise<string | undefined> {
	const sessionData = await getOrCreateSessionData(kv, chatId)
	return sessionData.selectedAgentUrl
}

/**
 * Get selected agent ID for a chat
 * 
 * @param kv - KV namespace for storage
 * @param chatId - Telegram chat ID
 * @returns Selected agent ID or undefined
 */
export async function getSelectedAgentId(
	kv: KVNamespace,
	chatId: string
): Promise<string | undefined> {
	const sessionData = await getOrCreateSessionData(kv, chatId)
	return sessionData.selectedAgentId
}

/**
 * Get session ID for a chat (without creating)
 * 
 * @param kv - KV namespace for storage
 * @param chatId - Telegram chat ID
 * @returns Agent session ID or null if not found
 */
export async function getSessionId(
	kv: KVNamespace,
	chatId: string
): Promise<string | null> {
	const existing = await kv.get(`session:${chatId}`)
	if (!existing) return null

	try {
		const data = JSON.parse(existing) as SessionData
		return data.sessionId
	} catch {
		// Legacy format - plain string (no error logging needed)
		return existing
	}
}

/**
 * Delete session for a chat
 * 
 * @param kv - KV namespace for storage
 * @param chatId - Telegram chat ID
 */
export async function deleteSession(
	kv: KVNamespace,
	chatId: string
): Promise<void> {
	await kv.delete(`session:${chatId}`)
}
