/**
 * Telegram Logger
 *
 * Sends structured bot activity logs directly to a Telegram chat.
 * Provides real-time visibility into bot decisions, actions, and thoughts.
 *
 * Usage:
 *   const tgLog = new TelegramLog(botToken, chatId)
 *   tgLog.header("Message from @user (DM)")
 *   tgLog.step("Received text: 'hello' (5 chars)")
 *   tgLog.decision("Private chat → agent pipeline")
 *   tgLog.info("Agent: Simple Prompt Agent")
 *   tgLog.ok("Reply sent")
 *   await tgLog.flush()
 */

import { escapeHtml } from "./helpers";
import { getTelegramApi } from "./telegram-api";
import type { Api } from "grammy";

const TG_LIMIT = 4090;

/**
 * TelegramLog — buffers structured log entries and sends them
 * as a formatted Telegram message when flushed.
 */
export class TelegramLog {
  private api: Api;
  private chatId: string;
  private entries: string[] = [];
  private headerText: string = "";

  constructor(botToken: string, chatId: string) {
    this.api = getTelegramApi(botToken);
    this.chatId = chatId;
  }

  /** Set the header for this log batch (shown in bold at the top) */
  header(text: string): this {
    this.headerText = text;
    return this;
  }

  /** Log a processing step / action the bot is taking */
  step(msg: string): void {
    this.entries.push(`⚡ ${escapeHtml(msg)}`);
  }

  /** Log a decision / reasoning step */
  decision(msg: string): void {
    this.entries.push(`🧠 ${escapeHtml(msg)}`);
  }

  /** Log an internal thought or observation */
  thought(msg: string): void {
    this.entries.push(`💭 ${escapeHtml(msg)}`);
  }

  /** Log an informational detail */
  info(msg: string): void {
    this.entries.push(`ℹ️ ${escapeHtml(msg)}`);
  }

  /** Log a successful result */
  ok(msg: string): void {
    this.entries.push(`✅ ${escapeHtml(msg)}`);
  }

  /** Log a warning */
  warn(msg: string): void {
    this.entries.push(`⚠️ ${escapeHtml(msg)}`);
  }

  /** Log an error */
  error(msg: string): void {
    this.entries.push(`❌ ${escapeHtml(msg)}`);
  }

  /** Check if there are buffered entries */
  hasEntries(): boolean {
    return this.entries.length > 0;
  }

  /** Flush all buffered entries as a single formatted Telegram message */
  async flush(): Promise<void> {
    if (this.entries.length === 0) return;

    const time = new Date().toISOString().slice(11, 19);
    let text = "";

    if (this.headerText) {
      text += `<b>📋 ${escapeHtml(this.headerText)}</b>\n`;
      text += `🕐 <code>${time}</code>\n\n`;
    }

    text += this.entries.join("\n");

    // Split if exceeding Telegram limit
    const chunks = splitText(text, TG_LIMIT);
    for (const chunk of chunks) {
      await this.send(chunk);
    }

    // Reset buffer
    this.entries = [];
    this.headerText = "";
  }

  /** Send a single message immediately (for critical one-off logs) */
  async sendNow(msg: string): Promise<void> {
    const time = new Date().toISOString().slice(11, 19);
    const text = `🕐 <code>${time}</code>\n${escapeHtml(msg)}`;
    await this.send(text);
  }

  private async send(text: string): Promise<void> {
    try {
      await this.api.sendMessage(this.chatId, text, {
        parse_mode: "HTML",
        disable_notification: true,
      });
    } catch (err) {
      // Silently fail — log sending must never break the bot
      console.error("TelegramLog send failed:", err);
    }
  }
}

// ─── KV helpers for dynamic log chat ───────────────────────────────

const LOG_CHAT_KEY = "telegram_log_chat_id";

/** Save the log chat ID to KV (set by /loghere command) */
export async function setLogChatId(
  kv: KVNamespace,
  chatId: string,
): Promise<void> {
  await kv.put(LOG_CHAT_KEY, chatId);
}

/** Remove the log chat ID from KV (set by /logstop command) */
export async function removeLogChatId(kv: KVNamespace): Promise<void> {
  await kv.delete(LOG_CHAT_KEY);
}

/** Get the log chat ID: env var takes priority, then KV */
export async function getLogChatId(
  kv: KVNamespace,
  envLogChatId?: string,
): Promise<string | null> {
  if (envLogChatId) return envLogChatId;
  return await kv.get(LOG_CHAT_KEY);
}

// ─── Utilities ─────────────────────────────────────────────────────

/** Truncate text for log display */
export function truncLog(text: string, max = 80): string {
  if (text.length <= max) return text;
  return text.substring(0, max) + "...";
}

/** Split text into chunks respecting a character limit */
function splitText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      parts.push(remaining);
      break;
    }

    // Try to split at a newline for readability
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt < limit * 0.3) splitAt = limit;
    parts.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return parts;
}
