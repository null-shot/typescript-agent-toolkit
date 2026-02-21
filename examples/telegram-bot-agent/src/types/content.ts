/**
 * Content Block Types
 *
 * Defines the different formats of content the agent can produce.
 * The Content Publisher maps each type to the corresponding Telegram Bot API method.
 */

/** Plain text message */
export interface TextContent {
  type: "text";
  text: string;
  parseMode?: "HTML" | "Markdown";
}

/** Photo with optional caption (for memes, infographics, etc.) */
export interface PhotoContent {
  type: "photo";
  /** URL or base64 of the image */
  url?: string;
  /** Workers AI prompt to generate the image (if url is not provided) */
  imagePrompt?: string;
  /** Pre-generated image as base64 (avoids re-generation at publish time) */
  imageBase64?: string;
  caption?: string;
  parseMode?: "HTML" | "Markdown";
}

/** Telegram poll */
export interface PollContent {
  type: "poll";
  question: string;
  options: string[];
  isAnonymous?: boolean;
  allowsMultipleAnswers?: boolean;
}

/** GIF animation */
export interface AnimationContent {
  type: "animation";
  url: string;
  caption?: string;
}

/** Album of photos/videos */
export interface MediaGroupContent {
  type: "media_group";
  media: Array<{
    type: "photo" | "video";
    url: string;
    caption?: string;
  }>;
}

/** Document / file */
export interface DocumentContent {
  type: "document";
  url: string;
  filename?: string;
  caption?: string;
}

/** Voice message — TTS from text */
export interface VoiceContent {
  type: "voice";
  /** Text to synthesize into speech */
  text: string;
  /** Optional caption shown alongside the voice message */
  caption?: string;
  /** Language hint for TTS (e.g. "en", "es"). Auto-detected if omitted. */
  lang?: string;
}

/** Union type — all possible content formats */
export type ContentBlock =
  | TextContent
  | PhotoContent
  | PollContent
  | AnimationContent
  | MediaGroupContent
  | DocumentContent
  | VoiceContent;

/** Generous limits — prompt asks for 200-400, but we allow headroom. */
export const MAX_POST_LENGTH = 800;
export const MAX_CAPTION_LENGTH = 600;

/**
 * Truncate text to a maximum length, cutting at the nearest sentence boundary.
 * Falls back to word boundary if no sentence boundary is found in the
 * second half of the allowed range.
 */
export function truncateToLimit(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const cutoff = text.slice(0, maxLength);
  // Try to cut at a sentence boundary (period / question / exclamation)
  const lastSentence = Math.max(
    cutoff.lastIndexOf(". "),
    cutoff.lastIndexOf("? "),
    cutoff.lastIndexOf("! "),
    cutoff.lastIndexOf(".\n"),
    cutoff.lastIndexOf("?\n"),
    cutoff.lastIndexOf("!\n"),
  );

  if (lastSentence > maxLength * 0.4) {
    return text.slice(0, lastSentence + 1).trim();
  }

  // Fallback: cut at the last space
  const lastSpace = cutoff.lastIndexOf(" ");
  if (lastSpace > maxLength * 0.4) {
    return text.slice(0, lastSpace).trim() + "…";
  }

  return cutoff.trim() + "…";
}

/**
 * Normalize post text to ensure correct formatting:
 * 1. Strip any *bold* asterisks from the title (plain text titles only)
 * 2. Title on its own line with blank line after
 * 3. Body text
 * 4. Blank line before CTA/closer
 * 5. CTA/closer on its own line
 *
 * This compensates for AI models that ignore formatting instructions.
 */
export function normalizePostFormat(text: string): string {
  if (!text || text.trim().length === 0) return text;

  let result = text.trim();

  // Strip all Markdown-style formatting that Telegram shows as raw characters.
  // Order matters: double markers first, then single.
  result = result.replace(/\*\*([^*]+)\*\*/g, "$1");   // **bold**
  result = result.replace(/__([^_]+)__/g, "$1");        // __bold__
  result = result.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "$1"); // *italic*
  result = result.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1");   // _italic_
  result = result.replace(/`([^`]+)`/g, "$1");          // `code`
  result = result.replace(/^#{1,3}\s+/gm, "");          // ### headings

  // Step 1: Find the title — first line of the text (short line, < 80 chars)
  const firstNewline = result.indexOf("\n");
  if (firstNewline === -1) return result; // single line, nothing to normalize

  const title = result.slice(0, firstNewline).trim();
  let afterTitle = result.slice(firstNewline);

  // Only treat the first line as a title if it's short enough (< 80 chars)
  if (title.length > 80) return result;

  // Step 2: Ensure exactly one blank line after title
  // Remove any whitespace-only lines or single newlines right after title
  afterTitle = afterTitle.replace(/^[\t ]*\n?[\t ]*\n?/, "");

  // Step 3: Split remaining text into lines and find CTA
  const bodyAndCta = afterTitle.trim();
  if (!bodyAndCta) return title;

  // Split into paragraphs (by double newline)
  const paragraphs = bodyAndCta
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) return title;

  if (paragraphs.length === 1) {
    // Single paragraph — try to split last sentence as CTA
    const sentences = splitLastSentence(paragraphs[0]);
    if (sentences) {
      return `${title}\n\n${sentences.body}\n\n${sentences.cta}`;
    }
    return `${title}\n\n${paragraphs[0]}`;
  }

  // Multiple paragraphs — last one is the CTA
  const ctaParagraph = paragraphs[paragraphs.length - 1];
  const bodyParagraphs = paragraphs.slice(0, -1);

  return `${title}\n\n${bodyParagraphs.join("\n\n")}\n\n${ctaParagraph}`;
}

/**
 * Try to split the last sentence from a text block as a CTA.
 * Returns null if the text is too short to split meaningfully.
 */
function splitLastSentence(text: string): { body: string; cta: string } | null {
  // Only split if text is substantial enough (> 100 chars)
  if (text.length < 100) return null;

  // Find the last sentence boundary (? or . followed by space + capital, or end)
  // Look for the last question or statement that could be a CTA
  const lastQuestionIdx = text.lastIndexOf("?");
  if (lastQuestionIdx > 0 && lastQuestionIdx < text.length - 1) {
    // There's text after the question mark — the question isn't the last sentence
    // Find the start of the question sentence
    const beforeQuestion = text.slice(0, lastQuestionIdx + 1);
    const afterQuestion = text.slice(lastQuestionIdx + 1).trim();

    // Find where the question sentence starts
    const qSentenceStart = beforeQuestion.lastIndexOf(". ");
    const qNewlineStart = beforeQuestion.lastIndexOf("\n");
    const start = Math.max(qSentenceStart, qNewlineStart);

    if (start > 0) {
      return {
        body: text.slice(0, start + 1).trim(),
        cta: text.slice(start + 1).trim(),
      };
    }
  } else if (lastQuestionIdx > 50) {
    // Question is at the end — find where the question sentence starts
    const beforeQ = text.slice(0, lastQuestionIdx);
    const sentenceStart = Math.max(
      beforeQ.lastIndexOf(". "),
      beforeQ.lastIndexOf("\n"),
    );

    if (sentenceStart > 0) {
      return {
        body: text.slice(0, sentenceStart + 1).trim(),
        cta: text.slice(sentenceStart + 1).trim(),
      };
    }
  }

  // Fallback: split at the last period followed by a space before the last ~100 chars
  const cutoff = Math.max(text.length - 150, text.length / 2);
  const lastPeriod = text.lastIndexOf(". ", text.length - 20);
  if (lastPeriod > cutoff) {
    return {
      body: text.slice(0, lastPeriod + 1).trim(),
      cta: text.slice(lastPeriod + 2).trim(),
    };
  }

  return null;
}

/**
 * Known ContentBlock field names used by tryRepairContentJson
 * to fix malformed AI output where closing quotes are dropped.
 */
const CONTENT_JSON_KEYS =
  "type|text|parseMode|url|imagePrompt|imageBase64|caption|lang" +
  "|question|options|isAnonymous|allowsMultipleAnswers|media|filename";

/**
 * Attempt to repair common AI-generated JSON mistakes.
 *
 * Most frequent issue: the model drops the closing `"` before a comma,
 * merging the value with the next key name.
 *   broken:  "imagePrompt":"...style,caption":"..."
 *   fixed:   "imagePrompt":"...style","caption":"..."
 */
function tryRepairContentJson(raw: string): string | null {
  const repaired = raw.replace(
    new RegExp(`,\\s*(${CONTENT_JSON_KEYS})"\\s*:`, "g"),
    '","$1":',
  );

  if (repaired === raw) return null; // nothing changed

  try {
    JSON.parse(repaired); // validate
    return repaired;
  } catch {
    return null;
  }
}

/**
 * Fix literal newlines/tabs inside JSON string values.
 * AI models often generate pretty-printed captions with real line breaks
 * instead of \n escape sequences, which makes JSON.parse fail.
 */
function tryFixLiteralNewlines(raw: string): string | null {
  let result = "";
  let inString = false;
  let escape = false;
  let changed = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (escape) {
      result += ch;
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      result += ch;
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (inString && ch === "\n") {
      result += "\\n";
      changed = true;
      continue;
    }
    if (inString && ch === "\r") {
      changed = true;
      continue;
    }
    if (inString && ch === "\t") {
      result += "\\t";
      changed = true;
      continue;
    }
    result += ch;
  }

  if (!changed) return null;

  try {
    JSON.parse(result);
    return result;
  } catch {
    return null;
  }
}

/**
 * Try to parse a JSON string as a ContentBlock, applying defaults,
 * normalization, and length limits.  Returns null on failure.
 */
function tryParseAsContentBlock(jsonStr: string): ContentBlock | null {
  // Attempt direct parse, then newline fix, then quote repair
  for (const candidate of [
    jsonStr,
    tryFixLiteralNewlines(jsonStr),
    tryRepairContentJson(jsonStr),
  ]) {
    if (!candidate) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }

    if (!parsed.type || typeof parsed.type !== "string") continue;

    // No special parse_mode — plain text titles, no Markdown formatting
    // Remove parseMode if AI sets it, to avoid Telegram parse errors
    if (parsed.type === "text" || parsed.type === "photo") {
      delete parsed.parseMode;
    }

    // Normalize + enforce length for text posts
    if (parsed.type === "text" && typeof parsed.text === "string") {
      parsed.text = normalizePostFormat(parsed.text);
      if ((parsed.text as string).length > MAX_POST_LENGTH) {
        parsed.text = truncateToLimit(parsed.text as string, MAX_POST_LENGTH);
      }
    }

    // Normalize + enforce length for photo captions
    if (parsed.type === "photo" && typeof parsed.caption === "string") {
      parsed.caption = normalizePostFormat(parsed.caption);
      if ((parsed.caption as string).length > MAX_CAPTION_LENGTH) {
        parsed.caption = truncateToLimit(
          parsed.caption as string,
          MAX_CAPTION_LENGTH,
        );
      }
    }

    // Normalize + enforce length for voice content
    if (parsed.type === "voice") {
      if (typeof parsed.caption === "string") {
        parsed.caption = normalizePostFormat(parsed.caption);
        if ((parsed.caption as string).length > MAX_CAPTION_LENGTH) {
          parsed.caption = truncateToLimit(
            parsed.caption as string,
            MAX_CAPTION_LENGTH,
          );
        }
      }
      // TTS text limit (MeloTTS handles max ~1000 chars)
      if (
        typeof parsed.text === "string" &&
        (parsed.text as string).length > 1000
      ) {
        parsed.text = truncateToLimit(parsed.text as string, 1000);
      }
    }

    return parsed as unknown as ContentBlock;
  }

  return null;
}

/**
 * Extract the first balanced JSON object from a string.
 * Tracks brace depth and string escaping to find the matching `}`.
 * Returns null if no valid JSON object boundaries are found.
 */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

/**
 * Parse an AI-generated JSON response into a ContentBlock.
 * Falls back to a simple TextContent if parsing fails.
 *
 * Always sets parseMode to "Markdown" for text/photo content
 * so that Telegram renders *bold*, _italic_, etc.
 *
 * Applies normalizePostFormat to ensure proper structure with blank lines.
 *
 * If JSON.parse fails, attempts to repair common AI mistakes
 * (e.g. dropped closing quotes) before giving up.
 *
 * When the AI returns multiple JSON objects (e.g. "Alternative poll: {...}"),
 * the greedy regex would capture everything and fail. We fall back to
 * extracting the first balanced JSON object.
 */
export function parseContentBlock(raw: string): ContentBlock {
  // Try greedy match first (works for single JSON)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    const block = tryParseAsContentBlock(jsonMatch[0]);
    if (block) return block;
  }

  // Greedy match failed (e.g. multiple JSON objects with text between them).
  // Extract the first balanced JSON object instead.
  const firstJson = extractFirstJsonObject(raw);
  if (firstJson && firstJson !== jsonMatch?.[0]) {
    const block = tryParseAsContentBlock(firstJson);
    if (block) return block;
  }

  // Default: treat as plain text (no Markdown) + enforce length
  let text = normalizePostFormat(raw);
  if (text.length > MAX_POST_LENGTH) {
    text = truncateToLimit(text, MAX_POST_LENGTH);
  }
  return {
    type: "text",
    text,
  };
}
