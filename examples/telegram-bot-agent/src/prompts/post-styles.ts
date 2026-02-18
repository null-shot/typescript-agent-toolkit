/**
 * Post generation prompts and styles
 */

export type PostStyle = "news" | "promo" | "casual" | "announcement" | "educational"

export interface PostGenerationRequest {
	topic: string
	style: PostStyle
	language: "en" | "ru"
	maxLength?: number
	channelContext?: string
	includeEmoji?: boolean
	includeHashtags?: boolean
}

export const POST_STYLE_DESCRIPTIONS: Record<PostStyle, string> = {
	news: "📰 News - Formal, informative, objective tone",
	promo: "🎯 Promo - Marketing, persuasive, call-to-action",
	casual: "💬 Casual - Friendly, conversational, engaging",
	announcement: "📢 Announcement - Official, important, clear",
	educational: "📚 Educational - Informative, structured, helpful",
}

export const POST_STYLE_EMOJIS: Record<PostStyle, string> = {
	news: "📰",
	promo: "🎯",
	casual: "💬",
	announcement: "📢",
	educational: "📚",
}

/**
 * Generate system prompt for post generation
 */
export function getPostGenerationPrompt(request: PostGenerationRequest): string {
	const {
		topic,
		style,
		language,
		maxLength = 1000,
		channelContext,
		includeEmoji = true,
		includeHashtags = true,
	} = request

	const styleInstructions = getStyleInstructions(style)
	const langName = language === "ru" ? "Russian" : "English"

	let prompt = `You are a social media content creator. Generate a post for a Telegram channel.

**Topic:** ${topic}

**Style:** ${style}
${styleInstructions}

**Requirements:**
- Language: ${langName}
- Maximum length: ${maxLength} characters
- ${includeEmoji ? "Include relevant emojis to make the post engaging" : "Do not use emojis"}
- ${includeHashtags ? "Add 2-3 relevant hashtags at the end" : "Do not include hashtags"}
`

	if (channelContext) {
		prompt += `\n**Channel context:** ${channelContext}\n`
	}

	prompt += `
**Output format:**
Return ONLY the post text, ready to be published. No explanations, no "Here's the post:" prefix.
`

	return prompt
}

/**
 * Get style-specific instructions
 */
function getStyleInstructions(style: PostStyle): string {
	switch (style) {
		case "news":
			return `Write in a formal, journalistic tone. Start with the key information (who, what, when, where). Be objective and factual. Use clear, concise language.`

		case "promo":
			return `Write persuasive marketing copy. Highlight benefits and value. Include a clear call-to-action. Create urgency or excitement. Use power words.`

		case "casual":
			return `Write in a friendly, conversational tone. Be relatable and engaging. Use informal language where appropriate. Connect with the audience personally.`

		case "announcement":
			return `Write in an official, clear tone. State the main point immediately. Provide essential details. Be direct and unambiguous.`

		case "educational":
			return `Write informative content that teaches something. Structure the information clearly. Use examples if helpful. Make complex topics accessible.`

		default:
			return `Write engaging content appropriate for social media.`
	}
}

/**
 * Generate a quick prompt for simple generation
 */
export function getQuickGenerationPrompt(
	topic: string,
	language: "en" | "ru" = "en"
): string {
	const langName = language === "ru" ? "Russian" : "English"

	return `Generate a short, engaging Telegram post about: ${topic}

Requirements:
- Language: ${langName}
- Length: 100-300 characters
- Include 1-2 emojis
- Make it catchy and shareable
- Add 1-2 relevant hashtags

Return ONLY the post text, ready to publish.`
}

/**
 * Detect language from text
 */
export function detectLanguage(text: string): "en" | "ru" {
	// Simple detection based on Cyrillic characters
	const cyrillicPattern = /[\u0400-\u04FF]/
	return cyrillicPattern.test(text) ? "ru" : "en"
}
