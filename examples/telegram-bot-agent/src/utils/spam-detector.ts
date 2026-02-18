/**
 * Spam Detection Utilities
 * Combines heuristic rules and AI-based detection
 */

import type {
  ModerationSettings,
  ModerationResult,
  ContentCategory,
  ModerationAction,
} from "../types/moderation";
import { checkFlood } from "./moderation-storage";
import { parseAiSdkStreamText } from "./helpers";
import { loggers } from "./logger";

const log = loggers.moderation;

interface Env {
  AGENT_URL?: string;
  SESSIONS: KVNamespace;
  AI?: Ai;
}

// ============ Heuristic Patterns ============

// Spam indicators
const SPAM_PATTERNS = [
  /\b(buy|sell|discount|promo|offer|deal|free|win|winner|prize|lottery|casino|bet|crypto|bitcoin|ethereum|nft)\b/i,
  /\b(click here|subscribe|follow|join|telegram|channel|group)\b.*\b(link|url|http)/i,
  /\b(earn|make money|income|profit|investment|invest)\b/i,
  /\b(limited time|act now|hurry|urgent|last chance)\b/i,
  /💰|💵|💸|🎰|🎲|💎|🚀.*moon/i,
  /\b(dm|message|contact)\s*(me|us)\b/i,
];

// Scam indicators
const SCAM_PATTERNS = [
  /\b(send|transfer|deposit)\s*\d+\s*(btc|eth|usdt|usd|\$)/i,
  /\b(wallet|address|private key|seed phrase)\b/i,
  /\b(verify|verification|confirm)\s*(account|identity|wallet)\b/i,
  /\b(airdrop|giveaway)\b.*\b(send|deposit|transfer)\b/i,
  /\b(double|triple|10x|100x)\s*(your|money|investment)\b/i,
  /\b(guaranteed|100%|risk.?free)\s*(return|profit|income)\b/i,
  /\b(admin|support|official)\b.*\b(never|won't|will not)\s*(dm|message|contact)/i,
];

// Hate speech indicators
const HATE_PATTERNS = [
  // Keeping minimal - AI should handle nuanced cases
  /\b(kill|death to|destroy)\s*(all|every)\b/i,
  /\b(hate|despise)\s*(all|every)\s*(jews|muslims|christians|blacks|whites|asians|gays|women|men)\b/i,
];

// Link patterns
const LINK_PATTERNS = [
  /https?:\/\/[^\s]+/i,
  /\bt\.me\/[^\s]+/i,
  /\bwa\.me\/[^\s]+/i,
  /@\w+\s*(channel|group|chat)/i,
];

// Suspicious domains
const SUSPICIOUS_DOMAINS = [
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "adf.ly",
  "bc.vc",
  "j.mp",
];

// ============ Heuristic Detection ============

/**
 * Run heuristic spam detection
 */
export function detectWithHeuristics(
  text: string,
  settings: ModerationSettings,
): ModerationResult | null {
  const normalizedText = text.toLowerCase();

  // Check flood first (handled separately via checkFlood)

  // Check scam patterns FIRST (higher severity than spam)
  if (settings.detectScam) {
    for (const pattern of SCAM_PATTERNS) {
      if (pattern.test(text)) {
        return {
          category: "scam",
          confidence: 0.9,
          action: settings.scamAction,
          reason: "Matched scam pattern",
          details: `Pattern: ${pattern.source.substring(0, 50)}...`,
        };
      }
    }
  }

  // Check hate speech patterns (higher severity than spam)
  if (settings.detectHate) {
    for (const pattern of HATE_PATTERNS) {
      if (pattern.test(text)) {
        return {
          category: "hate",
          confidence: 0.85,
          action: settings.hateAction,
          reason: "Matched hate speech pattern",
        };
      }
    }
  }

  // Check spam patterns
  if (settings.detectSpam) {
    for (const pattern of SPAM_PATTERNS) {
      if (pattern.test(text)) {
        return {
          category: "spam",
          confidence: 0.8,
          action: settings.spamAction,
          reason: "Matched spam pattern",
          details: `Pattern: ${pattern.source.substring(0, 50)}...`,
        };
      }
    }
  }

  // Check links
  if (settings.detectLinks) {
    for (const pattern of LINK_PATTERNS) {
      if (pattern.test(text)) {
        // Check if domain is whitelisted
        const urlMatch = text.match(/https?:\/\/([^\/\s]+)/i);
        if (urlMatch) {
          const domain = urlMatch[1].toLowerCase();
          if (settings.whitelistedDomains.some((d) => domain.includes(d))) {
            continue; // Whitelisted domain
          }

          // Check for suspicious shortened URLs
          if (SUSPICIOUS_DOMAINS.some((d) => domain.includes(d))) {
            return {
              category: "spam",
              confidence: 0.75,
              action: settings.spamAction,
              reason: "Suspicious shortened URL",
              details: `Domain: ${domain}`,
            };
          }
        }

        return {
          category: "links",
          confidence: 0.7,
          action: settings.linksAction,
          reason: "Contains external link",
        };
      }
    }
  }

  return null;
}

/**
 * Check for flood (too many messages)
 */
export async function detectFlood(
  kv: KVNamespace,
  chatId: number,
  userId: number,
  settings: ModerationSettings,
): Promise<ModerationResult | null> {
  if (!settings.detectFlood) return null;

  const isFlooding = await checkFlood(
    kv,
    chatId,
    userId,
    settings.floodThreshold,
  );

  if (isFlooding) {
    return {
      category: "flood",
      confidence: 1.0,
      action: settings.floodAction,
      reason: `Exceeded ${settings.floodThreshold} messages per minute`,
    };
  }

  return null;
}

// ============ AI Detection ============

/**
 * AI-based content moderation prompt
 */
function getModerationPrompt(
  text: string,
  settings: ModerationSettings,
): string {
  const categories: string[] = [];
  if (settings.detectSpam) categories.push("spam (promotional, advertising)");
  if (settings.detectScam) categories.push("scam (fraud, phishing)");
  if (settings.detectHate) categories.push("hate (discrimination, threats)");
  if (settings.detectAdult) categories.push("adult (NSFW content)");

  return `You are a content moderator. Analyze the following message and determine if it violates any rules.

Categories to check: ${categories.join(", ")}

Message:
"""
${text}
"""

Respond in JSON format:
{
  "category": "spam" | "scam" | "hate" | "adult" | "clean",
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}

If the message is normal/clean, use category "clean" with high confidence.
Be conservative - only flag content you're confident about.
Consider context - legitimate discussions about crypto, marketing, etc. are fine.`;
}

/**
 * Run AI-based detection.
 * Fallback chain: Workers AI (env.AI) → Agent URL (env.AGENT_URL) → null
 */
export async function detectWithAI(
  text: string,
  settings: ModerationSettings,
  env: Env,
): Promise<ModerationResult | null> {
  // Skip very short messages
  if (text.length < 20) return null;

  // Skip if no AI capability at all
  if (!env.AI && !env.AGENT_URL) return null;

  try {
    const prompt = getModerationPrompt(text, settings);
    let fullText: string | null = null;

    // Try Workers AI first (cheaper, faster, no external dependency)
    if (env.AI) {
      try {
        const result = (await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct-fp8" as keyof AiModels,
          {
            messages: [{ role: "user", content: prompt }],
            max_tokens: 150,
          } as any,
        )) as { response?: string };
        fullText = result.response ?? null;
      } catch (aiError) {
        log.error(
          "Workers AI moderation failed, trying agent fallback",
          aiError,
        );
      }
    }

    // Fallback to Agent URL if Workers AI failed or unavailable
    if (!fullText && env.AGENT_URL) {
      const sessionId = `mod_${Date.now()}`;
      const response = await fetch(`${env.AGENT_URL}/agent/chat/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: sessionId,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const rawText = await response.text();
        fullText = parseAiSdkStreamText(rawText);
      }
    }

    if (!fullText) return null;

    // Parse JSON response
    const jsonMatch = fullText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const result = JSON.parse(jsonMatch[0]) as {
      category: ContentCategory;
      confidence: number;
      reason: string;
    };

    // Skip if clean or below threshold
    if (result.category === "clean") return null;
    if (result.confidence < settings.aiConfidenceThreshold) return null;

    // Map category to action
    const actionMap: Record<ContentCategory, ModerationAction> = {
      spam: settings.spamAction,
      scam: settings.scamAction,
      hate: settings.hateAction,
      adult: settings.adultAction,
      flood: settings.floodAction,
      links: settings.linksAction,
      clean: "none",
    };

    return {
      category: result.category,
      confidence: result.confidence,
      action: actionMap[result.category] || "none",
      reason: result.reason,
      details: env.AI ? "Workers AI detection" : "Agent AI detection",
    };
  } catch (error) {
    log.error("AI moderation error", error);
    return null;
  }
}

// ============ Combined Detection ============

/**
 * Run full moderation check (heuristics + AI)
 */
export async function moderateMessage(
  text: string,
  chatId: number,
  userId: number,
  settings: ModerationSettings,
  env: Env,
): Promise<ModerationResult | null> {
  // Skip if moderation disabled
  if (!settings.enabled) return null;

  // Skip whitelisted users
  if (settings.whitelistedUsers.includes(userId)) return null;

  // 1. Check flood first (KV-based)
  const floodResult = await detectFlood(env.SESSIONS, chatId, userId, settings);
  if (floodResult && floodResult.action !== "none") {
    return floodResult;
  }

  // 2. Run heuristic detection (fast, pattern matching)
  const heuristicResult = detectWithHeuristics(text, settings);
  if (heuristicResult && heuristicResult.action !== "none") {
    // High confidence heuristic match - no need for AI
    if (heuristicResult.confidence >= 0.85) {
      return heuristicResult;
    }
  }

  // 3. Run AI detection for uncertain cases or additional check
  // Only if we have medium confidence from heuristics or no heuristic match
  if (!heuristicResult || heuristicResult.confidence < 0.85) {
    const aiResult = await detectWithAI(text, settings, env);
    if (aiResult && aiResult.action !== "none") {
      return aiResult;
    }
  }

  // Return heuristic result if we have one (even low confidence)
  if (heuristicResult && heuristicResult.action !== "none") {
    return heuristicResult;
  }

  return null;
}

/**
 * Quick check without AI (for high-volume scenarios)
 */
export async function quickModerateMessage(
  text: string,
  chatId: number,
  userId: number,
  settings: ModerationSettings,
  env: Env,
): Promise<ModerationResult | null> {
  if (!settings.enabled) return null;
  if (settings.whitelistedUsers.includes(userId)) return null;

  const floodResult = await detectFlood(env.SESSIONS, chatId, userId, settings);
  if (floodResult) return floodResult;

  return detectWithHeuristics(text, settings);
}
