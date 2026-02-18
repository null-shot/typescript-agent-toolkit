/**
 * Published Post History
 *
 * Stores summaries of published posts per recurring task so the AI
 * can see what was already sent and generate genuinely unique content.
 *
 * KV key: recurring:history:{taskId}
 * Value:  JSON array of PublishedPostEntry (newest first, capped at MAX_HISTORY)
 */

const HISTORY_KEY = (taskId: string) => `recurring:history:${taskId}`;
const MAX_HISTORY = 15;
const MAX_SUMMARY_LENGTH = 300;

export interface PublishedPostEntry {
	/** ISO timestamp of when the post was published */
	publishedAt: string;
	/** Content type: text, photo, poll, voice */
	contentType: string;
	/** Short summary of published content (truncated) */
	summary: string;
}

/**
 * Extract a short summary from published content for history tracking.
 * Strips JSON structure and keeps only the human-readable text.
 *
 * For voice posts, stores the full spoken text so the AI can continue
 * the narrative thread in the next voice message.
 */
export function extractSummary(
	contentType: string,
	rawContent: string,
): string {
	let summary = "";

	try {
		if (rawContent.trim().startsWith("{")) {
			const parsed = JSON.parse(rawContent);

			switch (contentType) {
				case "poll":
					summary = `[POLL] ${parsed.question || ""} — Options: ${(parsed.options || []).join(" / ")}`;
					break;
				case "voice": {
					const spokenText = parsed.text || "";
					const caption = parsed.caption || "";
					summary = `[VOICE] Spoken: ${spokenText}${caption ? ` | Caption: ${caption}` : ""}`;
					break;
				}
				case "photo":
					summary = `[PHOTO] ${parsed.caption || ""}`;
					break;
				default:
					summary = parsed.text || parsed.caption || rawContent;
			}
		} else {
			summary = rawContent;
		}
	} catch {
		summary = rawContent;
	}

	summary = summary.replace(/\s+/g, " ").trim();
	if (summary.length > MAX_SUMMARY_LENGTH) {
		summary = summary.slice(0, MAX_SUMMARY_LENGTH) + "…";
	}

	return summary;
}

/**
 * Add a published post to the task's history.
 */
export async function addPublishedPost(
	kv: KVNamespace,
	taskId: string,
	contentType: string,
	rawContent: string,
): Promise<void> {
	const history = await getPublishedHistory(kv, taskId);

	const entry: PublishedPostEntry = {
		publishedAt: new Date().toISOString(),
		contentType,
		summary: extractSummary(contentType, rawContent),
	};

	history.unshift(entry);

	if (history.length > MAX_HISTORY) {
		history.length = MAX_HISTORY;
	}

	await kv.put(HISTORY_KEY(taskId), JSON.stringify(history));
}

/**
 * Get published post history for a task (newest first).
 */
export async function getPublishedHistory(
	kv: KVNamespace,
	taskId: string,
): Promise<PublishedPostEntry[]> {
	const raw = await kv.get(HISTORY_KEY(taskId));
	if (!raw) return [];

	try {
		return JSON.parse(raw) as PublishedPostEntry[];
	} catch {
		return [];
	}
}

/**
 * Format published history into a prompt section for the AI.
 * Returns empty string if no history exists.
 *
 * For voice content, uses "continue the narrative" style.
 * For polls, uses "different question and options" style.
 * For text/photo, uses "unique angle" style.
 */
export function formatHistoryForPrompt(
	history: PublishedPostEntry[],
	contentType?: string,
): string {
	if (history.length === 0) return "";

	const entries = history
		.slice(0, 10)
		.map((h, i) => `  ${i + 1}. ${h.summary}`)
		.join("\n");

	if (contentType === "voice") {
		return `

PREVIOUSLY PUBLISHED VOICE MESSAGES (most recent first):
${entries}

CONTINUATION RULES:
- You are building an ongoing narrative thread — each voice message should develop the topic further
- Reference or build on ideas from previous messages: "Last time we talked about X, now let's look at Y"
- Introduce new facts, angles, or deeper insights that naturally follow from what was said before
- The listener should feel like they're following a coherent series, not hearing disconnected fragments
- Do NOT repeat the same points — move the conversation forward
- If you've covered the basics, go deeper into specifics, counterarguments, or practical implications
- Vary the tone: sometimes informative, sometimes reflective, sometimes provocative`;
	}

	if (contentType === "poll") {
		return `

PREVIOUSLY PUBLISHED POLLS (DO NOT REPEAT):
${entries}

POLL UNIQUENESS RULES:
- Your poll MUST have a completely different question from ALL previous polls
- Use different option styles: if previous polls asked "which is better", ask "what's your biggest challenge" or "what surprised you most"
- Cover a different angle of the topic each time
- Never reuse the same options or close paraphrases`;
	}

	return `

PREVIOUSLY PUBLISHED POSTS (DO NOT REPEAT OR CLOSELY PARAPHRASE ANY OF THESE):
${entries}

UNIQUENESS RULES:
- Your post MUST be substantially different from ALL of the above
- Do NOT reuse the same title, angle, statistic, or closing question
- Find a completely new angle: a contrarian take, a niche detail, a recent development, a surprising connection, a different subtopic
- If the previous posts used a general overview, go deep into a specific aspect
- If they went deep, zoom out to a broader perspective or compare with something unexpected
- Different opening, different facts, different conclusion — every part must be fresh`;
}
