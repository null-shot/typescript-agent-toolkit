/**
 * Shared prompt constants for AI content generation.
 *
 * Used by task-handler (chat-driven), cron-processor (scheduled),
 * and (with minor variations) the dashboard "create post" API.
 *
 * MULTIFORMAT_POST_PROMPT instructs the AI to return a JSON ContentBlock,
 * enabling automatic selection of text, photo, poll, etc.
 */

// ---------------------------------------------------------------------------
// Shared writing-style guide injected into every post prompt.
// Keeps tone consistent across all formats and avoids the generic AI voice.
// ---------------------------------------------------------------------------
const WRITING_STYLE = `
STRICT FORMAT — three blocks separated by blank lines:

Short Title Here

Body: 2-5 sentences with real facts, numbers, or insight.

One sharp closing sentence — a question, bold take, or prediction.

RULES:
- Title: 3-10 words, plain text (NO bold, NO asterisks, NO formatting, NO markdown), surprising or specific
- Body: Short sentences. Real data. No filler. Max 1 short paragraph
- Closer: 1 sentence. Specific to the topic. NOT "What do you think?"
- Total length: 200-400 characters. SHORT. If over 400 chars — you failed
- One emoji MAX, only if it adds meaning
- No hashtags. No "Stay tuned". No "Let us know"
- ABSOLUTELY NO FORMATTING — no **bold**, no *italic*, no _underline_, no \`code\`, no ### headings. Plain text ONLY. Telegram will show raw asterisks and underscores as ugly characters.
- Match topic language (English topic → English, Russian → Russian)

BANNED PHRASES — never use these:
"changing the game", "innovative approach", "revolutionize", "far-reaching implications",
"brighter than ever", "push the boundaries", "groundbreaking", "cutting-edge",
"game-changer", "In today's fast-paced world", "landscape", "at the forefront",
"it's worth noting", "comprehensive", "leverage", "delve", "tapestry",
"Unveiling", "The Future of", "Look no further", "taking the world by storm",
"The Ultimate", "Are you tired of", "revolutionizing", "The Enigmatic World of",
"introducing", "game for creatives", "changing the game for", "dream of creating",
"creative freedom", "Discover how", "Here's why", "Everything you need to know"

BANNED TITLE PATTERNS — never start a title with:
"Unveiling X: The Y of Z", "Introducing X: The Ultimate Z", "The Enigmatic World of X",
"Discover X:", "Meet X:", "Why X is the Future", "X: A Game-Changer"
Titles must be specific and surprising, NOT press-release announcements.

Write like a sharp friend texting you a cool fact — conversational, specific, opinionated. NOT like a press release, NOT like a marketing page, NOT like a product announcement.
`;

// ---------------------------------------------------------------------------
// Few-shot examples — shows the model the quality bar we expect.
// ---------------------------------------------------------------------------
const TEXT_EXAMPLES = `
GOOD examples (copy this structure exactly):

Copilot writes 46% of all new code on GitHub

Not assists — writes. Half of every new commit is machine-generated, growing 10% per quarter.

Will "developer" in 2027 mean the same thing it did in 2023?

SQLite handles 2 trillion queries a day

More than Postgres, MySQL, and MongoDB combined. Every phone, browser, smart TV runs it. Originally designed for guided missiles.

Sometimes the best architecture is the boring one.
`;

/** Base post-generation prompt (chat-driven task handling) */
export const POST_PROMPT = `You write short, sharp posts for a Telegram channel.
${WRITING_STYLE}
${TEXT_EXAMPLES}
Output ONLY the post text — no preamble, no "Here's your post:", no explanation.
200-400 characters MAX. Shorter is better. If you write more than 400 chars you failed.
ABSOLUTELY NO MARKDOWN OR FORMATTING — no **bold**, no *italic*, no _underline_. Plain text only.
If a Knowledge Base is provided, use its specific facts and details in the post.
LINKS: If the topic contains URLs (http:// or https://), you MUST include them in the post so they remain clickable. Do not omit or paraphrase links — the actual URL must appear in EVERY post.

Topic: `;

/** Dashboard "create post" variant — longer format, Telegram markup hints */
export const DASHBOARD_POST_PROMPT = `You write posts for a Telegram channel. This one will be reviewed before publishing, so you can go a bit longer.
${WRITING_STYLE}
Output ONLY the post text — no preamble, no meta-commentary.
ABSOLUTELY NO FORMATTING — no **bold**, no *italic*, no _underline_, no \`code\`, no ### headings. Plain text ONLY.
1-4 paragraphs.
If a Knowledge Base is provided, use its specific facts and details in the post. Do NOT invent generic praise.
LINKS: If the topic contains URLs (http:// or https://), you MUST include them in the post text so they remain clickable. Weave them in naturally, but do not paraphrase, omit, or replace links — the actual URL must appear in your output.

Topic: `;

/** Extended variant for recurring/scheduled posts — adds uniqueness rule */
export const RECURRING_POST_PROMPT = `You write an ongoing series of posts for a Telegram channel. These posts form a NARRATIVE — each one builds on the last, like episodes in a series. The reader should feel progression, not random disconnected facts.
${WRITING_STYLE}
${TEXT_EXAMPLES}
NARRATIVE THREAD:
- Each post is an EPISODE in a series. The previously published posts (if listed below) are earlier episodes.
- Build on what came before: deepen a point, challenge it, show its consequences, or reveal a new facet.
- Use transitions that connect to previous content: "After looking at X, here's what happens when..." / "Remember when we said Y? Turns out..."
- Think of the series as a story arc: introduction → deeper exploration → surprising angles → practical implications → future outlook.
- The reader should want to follow the series because each post advances the conversation.

CRITICAL UNIQUENESS RULES:
- You MUST NOT repeat the same title, angle, statistic, question, or structure as any previous post.
- But "unique" does NOT mean "disconnected" — each post should feel like a natural next chapter.
- If previous posts were broad, go specific. If they were specific, connect to a bigger picture.

KNOWLEDGE BASE USAGE:
- If a Knowledge Base is provided, use its specific facts, features, and details.
- Every post should contain at least one concrete detail from the Knowledge Base (not invented).
- Do NOT write generic praise — use real information.

LINKS: If the topic contains URLs (http:// or https://), you MUST include them in the post text so they remain clickable. Do not omit or paraphrase links — the actual URL must appear in EVERY post.

Output ONLY the post text. 200-400 characters MAX. Shorter is better.

Topic: `;

/**
 * Image post prompt — always generates a photo post with AI-generated image.
 * Every post gets an accompanying image by default (can be toggled off).
 *
 * Returns JSON: {"type":"photo","imagePrompt":"...","caption":"..."}
 */
export const IMAGE_POST_PROMPT = `You create Telegram posts with accompanying AI-generated images.
${WRITING_STYLE}
Output EXACTLY ONE valid JSON object. Nothing else — no alternatives, no second option, no explanation, no markdown fences. The output must start with { and end with }.

Format:
{"type":"photo","imagePrompt":"...","caption":"..."}

Caption rules:
- 200-400 chars MAX. Short and sharp
- Same 3-part format: Title\\n\\nBody text\\n\\nCloser (use \\n\\n for blank lines in JSON)
- The caption should work on its own without the image

imagePrompt rules (ALWAYS in English regardless of caption language):
- Extract 3-5 concrete objects or keywords from the topic and caption — include them in the scene
- Describe specific visual elements related to the caption content, NOT abstract concepts
- Specify art style (e.g. "flat vector", "3D render", "editorial photo", "minimal line art")
- Include mood/lighting ("warm sunset tones", "high-contrast noir", "soft pastel")
- Include composition ("centered", "wide angle", "close-up", "bird's eye view")
- NO text in the image — AI image generators can't render text well
- BAD: "illustration about technology" (too vague, no keywords)
- GOOD: "flat vector illustration, bird's eye view of a developer's desk with three monitors showing code, coffee cup, warm lamp light, teal and amber palette, clean minimal style"
- GOOD: "3D render of a robot arm assembling microchips on a circuit board, neon blue glow, dark lab background, close-up"

KNOWLEDGE BASE USAGE:
- If a Knowledge Base is provided, reference specific facts and details from it.
- Every post should contain at least one concrete detail from the Knowledge Base.
- Do NOT write generic praise — use real information.

LINKS: If the topic contains URLs (http:// or https://), you MUST include them in the caption so they remain clickable. Do not omit or paraphrase links — the actual URL must appear in EVERY post, no exceptions.

Topic: `;

/**
 * Poll post prompt — generates a Telegram poll.
 * Triggered by format hints: "+poll", "+пол", "добавь пол", etc.
 *
 * Returns JSON: {"type":"poll","question":"...","options":["...","...","..."]}
 */
export const POLL_POST_PROMPT = `You create engaging Telegram polls that spark discussion.
${WRITING_STYLE}
Output EXACTLY ONE valid JSON object. Nothing else — no alternatives, no "or", no second option, no explanation, no markdown fences, no text before or after. ONE line of JSON, period.

Format:
{"type":"poll","question":"...","options":["...","...","..."]}

CRITICAL:
- Return ONLY ONE JSON object. If you output two JSONs or any text around the JSON, it will BREAK.
- The output must start with { and end with } — nothing else in your response.

EXAMPLES IN TOPIC:
- If the topic contains example polls, they are TEMPLATES showing the desired theme and style.
- NEVER copy or repeat those examples. Invent a COMPLETELY NEW question on a related but different angle.
- Use the examples only to understand the audience, tone, and subject area.

UNIQUENESS (for recurring polls):
- Each poll MUST have a completely different question and different options from all previous polls.
- If previous polls asked about preferences, ask about predictions or experiences instead.
- If previous polls were about tools/tech, ask about processes, people, or culture.
- Vary the poll style: sometimes "which is better", sometimes "what's your biggest challenge", sometimes "what would you choose", sometimes "what surprised you most".

Question rules:
- 1-100 chars, specific and thought-provoking
- NOT generic yes/no questions
- Frame as a real choice people care about
- Match the language of the topic

Options rules:
- 2-4 options ONLY
- Each option: 1-100 chars, distinct viewpoint
- No "Other" or "All of the above" — make every option a real stance
- Options should be roughly equal in appeal (no obvious "correct answer")

BAD: "Do you like AI?" → ["Yes", "No", "Maybe"]
GOOD: "Which AI risk worries you most?" → ["Job displacement", "Deepfakes in elections", "Autonomous weapons", "Loss of privacy"]

Topic: `;

/**
 * Voice post prompt — generates text optimized for TTS reading.
 * Triggered by format hints: "+audio", "+аудио", "+голос", etc.
 *
 * Returns JSON: {"type":"voice","text":"...","caption":"..."}
 */
export const VOICE_POST_PROMPT = `You create Telegram voice messages that form an ongoing narrative series. Each new message continues and develops the topic — building on what was said before, going deeper, or exploring a new facet.
${WRITING_STYLE}
Output EXACTLY ONE valid JSON object. Nothing else — no alternatives, no second option, no explanation, no markdown fences. The output must start with { and end with }.

Format:
{"type":"voice","text":"...","caption":"..."}

NARRATIVE CONTINUITY:
- If previous voice messages are listed below, treat them as earlier episodes in a series
- Reference or build on previous points: "We talked about X, now let's look at why that matters for Y"
- Each message should advance the conversation — never repeat what was already said
- Introduce new facts, deeper analysis, practical implications, or surprising connections
- The listener should feel like following a coherent evolving discussion

text rules (the spoken part):
- 200-500 chars MAX. This will be converted to speech
- Write naturally as if speaking — use short sentences, conversational tone
- NO special characters, NO URLs, NO emojis — they sound weird in TTS
- NO formatting (no bold, no italic) — plain spoken words only
- Pause-friendly: use periods and commas where natural pauses should be
- Match the language of the topic

caption rules (the text version shown alongside):
- Same 3-part format: Title\\n\\nBody\\n\\nCloser
- 200-400 chars MAX, can use emojis
- Should complement the audio, not repeat it word-for-word
- NO markdown, NO **bold**, NO *italic* — plain text only

KNOWLEDGE BASE USAGE:
- If a Knowledge Base is provided, reference specific facts and details from it.
- Do NOT invent generic claims — ground the narrative in real information.

Topic: `;

/**
 * Multiformat post prompt — the AI chooses the best content format.
 * Used when image generation is disabled (IMAGE_WITH_POSTS=false).
 *
 * Supported formats:
 * - "text"  → plain text message
 * - "photo" → image with caption (provides imagePrompt for generation)
 * - "poll"  → interactive poll
 */
export const MULTIFORMAT_POST_PROMPT = `You create an ongoing narrative series for a Telegram channel using different formats. Each post is an EPISODE that continues the story — pick the format that best advances the narrative this time.
${WRITING_STYLE}
Output EXACTLY ONE valid JSON object. Nothing else — no alternatives, no second option, no explanation, no markdown fences. The output must start with { and end with }.

Available formats:

Text post (best for insights, opinions, news):
{"type":"text","text":"Post text here"}

Image post (best for visual topics, entertainment, tutorials):
{"type":"photo","imagePrompt":"detailed scene description in English","caption":"Caption text here"}

Poll (best for debates, preferences, community engagement):
{"type":"poll","question":"Clear, specific question","options":["Option 1","Option 2","Option 3"]}

Voice message (best for storytelling, deep-dives, personal commentary):
{"type":"voice","text":"Spoken text here","caption":"Short written summary"}

Format-specific rules:
- Text: 200-400 chars MAX. Use \\n\\n in JSON for blank lines. Format: "Title\\n\\nBody text\\n\\nCloser". NO markdown, NO **bold**, NO *italic*.
- Photo caption: 200-400 chars, same format with \\n\\n. imagePrompt: concrete scene, art style, mood. NO text in image. NO markdown in caption.
- Poll: 2-4 options with real different viewpoints (not "Yes"/"No"/"Maybe").
- Voice text: 200-500 chars MAX, conversational tone, NO URLs/emojis/formatting. caption: 200-400 chars, complements audio.

NARRATIVE THREAD:
- All posts form ONE coherent series — each post builds on the previous ones.
- Think of formats as different storytelling modes for the same evolving narrative.
- Text: introduce new facts or angles that advance the story
- Voice: deepen the narrative with commentary, like a podcast episode
- Photo: visualize or illustrate a concept from the ongoing discussion
- Poll: engage the audience on a question that emerged from the narrative
- The reader should feel progression across posts, not random disconnected content.

FORMAT ROTATION for recurring series — cycle through all formats:
- If recent posts were text/photo → try voice or poll
- If recent posts were voice → try text or photo
- If recent posts were poll → try voice or text
- Aim for variety: don't use the same format two times in a row

KNOWLEDGE BASE USAGE:
- If a Knowledge Base is provided, use its specific facts, features, and details.
- Every post should contain at least one concrete detail from the Knowledge Base.
- Do NOT write generic praise — use real information.

LINKS: If the topic contains URLs (http:// or https://), include them in the text/caption so they remain clickable. Do not omit or paraphrase links — the actual URL must appear. (NOT in voice text — voice can't read URLs)

Topic: `;

// ─── Format Hints ─────────────────────────────────────────────────

/** Detected format from user message */
export type PostFormat = "auto" | "photo" | "poll" | "voice" | "text";

/**
 * Parse format hints from a topic string.
 *
 * Supports patterns like:
 *   "+poll", "+пол", "добавь пол", "с полом", "with poll"
 *   "+audio", "+аудио", "+голос", "добавь аудио", "with voice"
 *   "+text", "+текст", "без фото", "only text", "текстом"
 *
 * Returns the clean topic (hint stripped) and the detected format.
 */
export function parseFormatHints(topic: string): {
  cleanTopic: string;
  format: PostFormat;
} {
  let format: PostFormat = "auto";
  let clean = topic;

  // ── Poll hints ──
  const pollPatterns = [
    /\+\s*(?:poll|пол[лл]?)\b/i,
    /(?:добавь|сделай|с)\s+(?:пол[лл]?(?:ом|у)?|poll)\b/i,
    /(?:with|include)\s+(?:a\s+)?poll\b/i,
    /\bформат\s*[:=]?\s*(?:пол[лл]?|poll)\b/i,
  ];
  for (const pat of pollPatterns) {
    if (pat.test(clean)) {
      format = "poll";
      clean = clean.replace(pat, "").trim();
      break;
    }
  }

  // ── Voice / Audio hints ──
  if (format === "auto") {
    const voicePatterns = [
      /\+\s*(?:audio|аудио|голос|voice)\b/i,
      /(?:добавь|сделай|с)\s+(?:аудио|голос(?:ом)?|audio|voice)\b/i,
      /(?:with|include)\s+(?:audio|voice)\b/i,
      /\bформат\s*[:=]?\s*(?:аудио|голос|audio|voice)\b/i,
      /\bозвуч[ьи]/i,
    ];
    for (const pat of voicePatterns) {
      if (pat.test(clean)) {
        format = "voice";
        clean = clean.replace(pat, "").trim();
        break;
      }
    }
  }

  // ── Text-only hints ──
  if (format === "auto") {
    const textPatterns = [
      /\+\s*(?:text|текст)\b/i,
      /(?:без\s+(?:фото|картинк[иу]|изображени[яй]))\b/i,
      /(?:only|just)\s+text\b/i,
      /\bтолько\s+текст(?:ом)?\b/i,
      /\bформат\s*[:=]?\s*(?:текст|text)\b/i,
    ];
    for (const pat of textPatterns) {
      if (pat.test(clean)) {
        format = "text";
        clean = clean.replace(pat, "").trim();
        break;
      }
    }
  }

  // Clean up leftover punctuation / whitespace
  clean = clean
    .replace(/\s{2,}/g, " ")
    .replace(/^[,;.\s]+|[,;.\s]+$/g, "")
    .trim();

  return { cleanTopic: clean || topic.trim(), format };
}

/**
 * Get the appropriate prompt for a given post format (sync, defaults only).
 */
export function getPromptForFormat(
  format: PostFormat,
  hasAI: boolean,
  imagesEnabled: boolean,
): string {
  switch (format) {
    case "poll":
      return POLL_POST_PROMPT;
    case "voice":
      return VOICE_POST_PROMPT;
    case "text":
      return POST_PROMPT;
    case "photo":
      return IMAGE_POST_PROMPT;
    case "auto":
    default:
      if (!hasAI) return POST_PROMPT;
      return imagesEnabled ? IMAGE_POST_PROMPT : MULTIFORMAT_POST_PROMPT;
  }
}

// ─── KV-backed custom prompts ────────────────────────────────────

/** KV key prefix for custom post prompts */
const PROMPT_KV_PREFIX = "setting:prompt:";

/** Format keys that can be customized */
export const CUSTOMIZABLE_FORMATS = [
  "text",
  "photo",
  "poll",
  "voice",
] as const;
export type CustomizableFormat = (typeof CUSTOMIZABLE_FORMATS)[number];

/** Default prompts map (for UI display and fallback) */
export const DEFAULT_PROMPTS: Record<CustomizableFormat, string> = {
  text: POST_PROMPT,
  photo: IMAGE_POST_PROMPT,
  poll: POLL_POST_PROMPT,
  voice: VOICE_POST_PROMPT,
};

/**
 * Load a custom prompt from KV, falling back to the built-in default.
 */
export async function getCustomPrompt(
  kv: KVNamespace,
  format: CustomizableFormat,
): Promise<string> {
  const custom = await kv.get(`${PROMPT_KV_PREFIX}${format}`);
  return custom || DEFAULT_PROMPTS[format];
}

/**
 * Save a custom prompt to KV. Pass empty string to reset to default.
 */
export async function setCustomPrompt(
  kv: KVNamespace,
  format: CustomizableFormat,
  prompt: string,
): Promise<void> {
  const key = `${PROMPT_KV_PREFIX}${format}`;
  if (!prompt.trim()) {
    await kv.delete(key);
  } else {
    await kv.put(key, prompt.trim());
  }
}

/**
 * Load all custom prompts from KV.
 * Returns an object with format → prompt (or null if using default).
 */
export async function getAllCustomPrompts(
  kv: KVNamespace,
): Promise<Record<CustomizableFormat, string | null>> {
  const results = {} as Record<CustomizableFormat, string | null>;
  for (const fmt of CUSTOMIZABLE_FORMATS) {
    results[fmt] = await kv.get(`${PROMPT_KV_PREFIX}${fmt}`);
  }
  return results;
}

/**
 * Get the appropriate prompt for a given post format,
 * loading custom overrides from KV when available.
 */
export async function getPromptForFormatAsync(
  format: PostFormat,
  hasAI: boolean,
  imagesEnabled: boolean,
  kv?: KVNamespace,
): Promise<string> {
  if (!kv) return getPromptForFormat(format, hasAI, imagesEnabled);

  switch (format) {
    case "poll":
      return getCustomPrompt(kv, "poll");
    case "voice":
      return getCustomPrompt(kv, "voice");
    case "text":
      return getCustomPrompt(kv, "text");
    case "photo":
      return getCustomPrompt(kv, "photo");
    case "auto":
    default:
      if (!hasAI) return getCustomPrompt(kv, "text");
      return imagesEnabled
        ? getCustomPrompt(kv, "photo")
        : getPromptForFormat(format, hasAI, imagesEnabled);
  }
}
