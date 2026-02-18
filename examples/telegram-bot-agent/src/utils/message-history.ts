/**
 * Message History Management
 * Stores conversation history in KV for context
 */

import { loggers } from "./logger";
import {
	loadBotProfile,
	getKnowledgeBasePrompt,
} from "./knowledge-base";

const log = loggers.message;

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
  agentId?: string; // ID of the agent that sent the message (for assistant)
  agentName?: string; // Agent name (for display)
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
  sessionId: string,
): Promise<StoredMessage[]> {
  try {
    const historyJson = await kv.get(`history:${sessionId}`);
    if (!historyJson) {
      return [];
    }
    return JSON.parse(historyJson) as StoredMessage[];
  } catch (error) {
    log.error("Error getting message history", error);
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
  agentName?: string,
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
    log.error("Error adding to history", error);
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
  sessionId: string,
): Promise<void> {
  await kv.delete(`history:${sessionId}`);
}

/** Default number of recent messages sent to the AI model */
const DEFAULT_CONTEXT_MESSAGES = 50;

/**
 * Convert stored messages to ModelMessage format
 * Marks messages from different agents so current agent understands context.
 *
 * Only the most recent `maxMessages` are returned to stay within model
 * context limits and control costs. The full history is still stored in KV
 * for /clear and session recovery.
 *
 * @param history - Stored message history
 * @param currentAgentId - Current agent ID (to distinguish own vs other agents' messages)
 * @param maxMessages - Max recent messages to include (default: 50)
 * @returns ModelMessage array
 */
export function historyToModelMessages(
  history: StoredMessage[],
  currentAgentId?: string,
  maxMessages: number = DEFAULT_CONTEXT_MESSAGES,
) {
  // Take only the most recent messages to keep context within model limits
  const recent = history.slice(-maxMessages);

  return recent.map((msg) => {
    // For assistant messages from different agents, add prefix
    if (
      msg.role === "assistant" &&
      msg.agentName &&
      msg.agentId !== currentAgentId
    ) {
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

const PERSONALITY_PROMPTS: Record<string, string> = {
	sarcastic: "Be 100% sarcastic and witty. Use dry humor and playful irony.",
	professional: "Be professional, formal, and business-appropriate.",
	friendly: "Be warm, friendly, and approachable. Use casual language.",
	helpful: "Be maximally helpful and thorough. Prioritize solving the user's problem.",
	neutral: "Be neutral and balanced. Adapt tone to the user.",
};

/**
 * Get system prompt that tells the agent who it is and how to behave.
 * Synchronous version — does not include Knowledge Base or personality.
 * Use getAgentSystemPromptAsync for full context.
 *
 * @param agentName - Current agent name
 * @param _history - Conversation history (unused, kept for API compatibility)
 * @returns System prompt string
 */
export function getAgentSystemPrompt(
  agentName: string,
  _history: StoredMessage[],
): string {
  return [
    `You are ${agentName}, an AI assistant operating inside a Telegram bot.`,
    `You communicate with users via Telegram direct messages.`,
    ``,
    `Guidelines:`,
    `- Be concise — Telegram messages should be short and readable.`,
    `- Match the user's language (if they write in Russian, reply in Russian).`,
    `- Use Telegram-friendly formatting: *bold*, _italic_, \`code\`.`,
    `- If you don't know something, say so honestly rather than making things up.`,
    `- Be helpful, friendly, and professional.`,
  ].join("\n");
}

/**
 * Async system prompt with Knowledge Base and personality from bot profile.
 * Used for DM flow to inject dashboard-configured context.
 *
 * @param kv - KV namespace (SESSIONS)
 * @param agentName - Current agent name
 * @param _history - Conversation history (unused, kept for API compatibility)
 * @returns System prompt string with KB and personality
 */
export async function getAgentSystemPromptAsync(
  kv: KVNamespace,
  agentName: string,
  _history: StoredMessage[],
): Promise<string> {
  const base = getAgentSystemPrompt(agentName, _history);
  let extra = "";

  try {
    const profile = await loadBotProfile(kv);
    if (profile?.personality) {
      const personalityPrompt =
        PERSONALITY_PROMPTS[profile.personality.toLowerCase()] ||
        profile.personality;
      extra += `\n\nPersonality: ${personalityPrompt}`;
    }
    const kbPrompt = await getKnowledgeBasePrompt(kv);
    if (kbPrompt) {
      extra += kbPrompt;
      extra += "\n\nUse the Knowledge Base above to answer questions accurately. Do NOT make up information.";
    }
  } catch (err) {
    log.warn("Failed to load profile/KB for system prompt", err);
  }

  return base + extra;
}
