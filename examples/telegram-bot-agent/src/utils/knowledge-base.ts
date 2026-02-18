/**
 * Knowledge Base Loader
 *
 * Shared utility to load the bot's Knowledge Base from KV (bot_profile_settings)
 * and format it as a prompt section.
 *
 * Used by:
 * - proactive-responder.ts (group responses)
 * - task-handler.ts (post generation via /post)
 * - cron-processor.ts (recurring post generation)
 */

export interface KnowledgeBase {
	websiteUrl?: string;
	docsUrl?: string;
	additionalLinks?: string;
	instructions?: string;
}

export interface BotProfileSettings {
	welcomeMessage?: string;
	logChatId?: string;
	defaultAgent?: string;
	maxHistoryMessages?: number;
	knowledgeBase?: KnowledgeBase;
	personality?: string;
	updatedAt?: number;
}

/**
 * Load bot profile settings from KV.
 * Returns null if not configured or on error.
 */
export async function loadBotProfile(
	kv: KVNamespace,
): Promise<BotProfileSettings | null> {
	try {
		const raw = await kv.get("bot_profile_settings");
		if (!raw) return null;
		return JSON.parse(raw) as BotProfileSettings;
	} catch {
		return null;
	}
}

/**
 * Format the Knowledge Base as a prompt section.
 *
 * Returns an empty string if no KB is configured, so it's always safe
 * to concatenate: `basePrompt + getKnowledgeBasePrompt(kb)`
 */
export function formatKnowledgeBase(kb?: KnowledgeBase | null): string {
	if (!kb) return "";

	const parts: string[] = [];

	if (kb.instructions) {
		parts.push(`=== Knowledge Base ===\n${kb.instructions}`);
	}

	const urls: string[] = [];
	if (kb.websiteUrl) urls.push(`Website: ${kb.websiteUrl}`);
	if (kb.docsUrl) urls.push(`Docs: ${kb.docsUrl}`);
	if (kb.additionalLinks) urls.push(`Links: ${kb.additionalLinks}`);
	if (urls.length > 0) {
		parts.push(`References:\n${urls.join("\n")}`);
	}

	if (parts.length === 0) return "";
	return "\n\n" + parts.join("\n\n");
}

/**
 * Load KB from KV and return the formatted prompt section.
 * Convenience wrapper that combines loadBotProfile + formatKnowledgeBase.
 *
 * Always returns a string (empty if no KB configured). Never throws.
 */
export async function getKnowledgeBasePrompt(
	kv: KVNamespace,
): Promise<string> {
	try {
		const profile = await loadBotProfile(kv);
		return formatKnowledgeBase(profile?.knowledgeBase);
	} catch {
		return "";
	}
}
