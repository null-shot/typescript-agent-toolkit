/**
 * Common helper functions
 *
 * Shared utilities used across all handlers. Import from here instead of
 * duplicating helpers in individual files.
 */

import { Context } from "grammy";
import {
  getBotChannels,
  getBotGroups,
  type BotChat,
} from "./bot-chats-storage";

// ─── Telegram API ───────────────────────────────────────────────

/**
 * Fetch wrapper for the Telegram Bot API with automatic 429 retry.
 *
 * Telegram returns HTTP 429 with a Retry-After header when rate-limited.
 * This helper waits and retries once (safe for dashboard / non-critical calls).
 */
export async function telegramApiFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(url, init);
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("Retry-After") || "1");
    const waitMs = Math.min(retryAfter * 1000, 10_000); // cap at 10s
    await new Promise((r) => setTimeout(r, waitMs));
    return fetch(url, init);
  }
  return response;
}

// ─── Text Formatting ────────────────────────────────────────────

/**
 * Escape HTML special characters for Telegram HTML parse mode
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Escape special characters for Telegram Markdown
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/[_*`\[\]]/g, "\\$&");
}

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}

// ─── Error Formatting ───────────────────────────────────────────

/**
 * Extract a human-readable error message from an unknown error value.
 * Use this instead of repeating `error instanceof Error ? error.message : String(error)`.
 */
export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─── ID / Timestamp ─────────────────────────────────────────────

/**
 * Generate a unique ID with prefix
 */
export function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Format a timestamp for display
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Telegram Helpers ───────────────────────────────────────────

/**
 * Verify that a user is an admin or creator of a chat
 */
export async function verifyAdmin(
  ctx: Context,
  chatId: number,
  userId: number,
): Promise<boolean> {
  try {
    const member = await ctx.api.getChatMember(chatId, userId);
    return member.status === "administrator" || member.status === "creator";
  } catch {
    return false;
  }
}

/**
 * Build a link to a published Telegram message.
 *
 * - Public channels/groups with a @username → https://t.me/{username}/{messageId}
 * - Private chats → https://t.me/c/{channelId}/{messageId}
 *   (Telegram uses the chat ID without the -100 prefix for private links)
 */
export function buildPostLink(
  chatId: number,
  messageId: number,
  username?: string,
): string {
  if (username) {
    return `https://t.me/${username}/${messageId}`;
  }
  const rawId = Math.abs(chatId);
  const privateId = String(rawId).startsWith("100")
    ? String(rawId).slice(3)
    : String(rawId);
  return `https://t.me/c/${privateId}/${messageId}`;
}

/**
 * Resolve a target chat (channel or group) by type prefix and identifier.
 *
 * Supports two formats:
 * - Stable chatId: `ch:-1001234567890` / `gr:-1001234567890` (preferred)
 * - Legacy index:  `ch:0` / `gr:1` (backward compat for old inline keyboards)
 *
 * Returns null if the target type is invalid or the target is not found.
 */
export async function resolveTarget(
  kv: KVNamespace,
  targetType: string,
  targetIdOrIdx: number,
): Promise<BotChat | null> {
  const targets =
    targetType === "ch"
      ? await getBotChannels(kv)
      : targetType === "gr"
        ? await getBotGroups(kv)
        : null;

  if (!targets) return null;

  // Negative numbers are Telegram chat IDs (stable); positive are legacy indices
  if (targetIdOrIdx < 0) {
    return targets.find((t) => t.chatId === targetIdOrIdx) || null;
  }

  // Legacy index-based fallback
  if (targetIdOrIdx >= targets.length) return null;
  return targets[targetIdOrIdx];
}

// ─── Message Splitting ──────────────────────────────────────────

/** Telegram message length limit */
const TG_MSG_LIMIT = 4096;

/**
 * Split a long text into Telegram-compatible chunks (max 4096 chars each).
 * Tries to break on paragraph boundaries (\n\n), then line breaks (\n),
 * falling back to hard cut only as a last resort.
 */
export function splitTelegramMessage(text: string): string[] {
  if (text.length <= TG_MSG_LIMIT) return [text];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > TG_MSG_LIMIT) {
    const chunk = remaining.slice(0, TG_MSG_LIMIT);

    // Try to find the last paragraph break within the chunk
    let splitAt = chunk.lastIndexOf("\n\n");
    if (splitAt <= 0) {
      // Fall back to last line break
      splitAt = chunk.lastIndexOf("\n");
    }
    if (splitAt <= 0) {
      // Fall back to last space
      splitAt = chunk.lastIndexOf(" ");
    }
    if (splitAt <= 0) {
      // Hard cut (no good break point found)
      splitAt = TG_MSG_LIMIT;
    }

    parts.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    parts.push(remaining);
  }

  return parts;
}

// ─── AI SDK Stream Parsing ──────────────────────────────────────

/** Unescape AI SDK escaped text content */
function unescapeAiSdk(raw: string): string {
  return raw
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

/**
 * Parse AI SDK streaming text from a complete response body.
 * Handles format: `0:"text content"` (one or more lines).
 * Non-streaming control lines (d:, e:, digit-prefix without text) are skipped.
 * Plain text lines are concatenated as-is.
 */
export function parseAiSdkStreamText(rawText: string): string {
  const lines = rawText.split("\n").filter((line) => line.trim());
  let fullText = "";

  for (const line of lines) {
    const match = line.match(/^\d+:"(.*)"$/s);
    if (match) {
      fullText += unescapeAiSdk(match[1]);
    } else if (
      !line.match(/^\d+:/) &&
      !line.startsWith("d:") &&
      !line.startsWith("e:")
    ) {
      fullText += line;
    }
  }

  return fullText.trim();
}

/**
 * Send a (possibly long) message to a Telegram chat, splitting into parts if needed.
 * First part is sent/edited via `firstPartSender`, remaining parts via `ctx.reply`.
 */
export async function sendLongMessage(
  ctx: Context,
  text: string,
  firstPartSender: (part: string) => Promise<void>,
): Promise<void> {
  const parts = splitTelegramMessage(text);
  await firstPartSender(parts[0]);
  for (let i = 1; i < parts.length; i++) {
    await ctx.reply(parts[i]);
  }
}
