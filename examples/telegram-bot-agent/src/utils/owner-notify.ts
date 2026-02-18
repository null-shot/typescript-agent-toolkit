/**
 * Owner Notification Utility
 *
 * Sends push notifications to the bot owner's DM when:
 * - A new escalation is created (user needs help, bot can't handle)
 * - A task is awaiting approval (e.g., generated post ready for review)
 *
 * Uses raw Telegram Bot API (not Grammy) so it can be called from
 * anywhere without needing the bot instance.
 */

import type { TelegramBotEnv } from "../types/env";
import type { KanbanTask } from "../types/kanban";
import { getOwnerId } from "./owner";
import { escapeHtml } from "./helpers";
import { getTelegramApi } from "./telegram-api";

/**
 * Notify the owner about a new escalation.
 */
export async function notifyOwnerEscalation(
  env: TelegramBotEnv,
  task: KanbanTask,
): Promise<boolean> {
  const ownerId = await getOwnerId(env);
  if (!ownerId) return false;

  const esc = task.escalation;
  if (!esc) return false;

  const userLabel = esc.username
    ? `@${esc.username}`
    : `User ${esc.userId || "unknown"}`;
  const chatLabel = esc.chatTitle || "DM";

  let text = `⚠️ <b>Escalation</b>\n\n`;
  text += `<b>From:</b> ${escapeHtml(userLabel)} in ${escapeHtml(chatLabel)}\n`;
  text += `<b>Reason:</b> ${escapeHtml(esc.reason)}\n`;

  if (esc.originalMessage) {
    const preview = esc.originalMessage.substring(0, 200);
    text += `\n<b>Message:</b>\n<i>${escapeHtml(preview)}${esc.originalMessage.length > 200 ? "..." : ""}</i>\n`;
  }

  // Inline keyboard for quick actions
  const keyboard = {
    inline_keyboard: [
      [
        { text: "✅ Resolve", callback_data: `kb:resolve:${task.id}` },
        { text: "🗑️ Dismiss", callback_data: `kb:dismiss:${task.id}` },
      ],
    ],
  };

  return await sendTelegramMessage(
    env.TELEGRAM_BOT_TOKEN,
    ownerId,
    text,
    keyboard,
  );
}

/**
 * Notify the owner about a task awaiting approval.
 */
export async function notifyOwnerApproval(
  env: TelegramBotEnv,
  task: KanbanTask,
): Promise<boolean> {
  const ownerId = await getOwnerId(env);
  if (!ownerId) return false;

  const approval = task.approval;
  if (!approval) return false;

  let text = `📋 <b>Task Awaiting Approval</b>\n\n`;
  text += `<b>${escapeHtml(task.title)}</b>\n\n`;

  if (approval.content) {
    const preview = approval.content.substring(0, 500);
    text += `${escapeHtml(preview)}${approval.content.length > 500 ? "..." : ""}\n\n`;
  }

  text += `Use /tasks to review and approve.`;

  return await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, ownerId, text);
}

/**
 * Notify the owner about a confidence-based soft escalation.
 */
export async function notifyOwnerUncertainResponse(
  env: TelegramBotEnv,
  task: KanbanTask,
  botResponse: string,
): Promise<boolean> {
  const ownerId = await getOwnerId(env);
  if (!ownerId) return false;

  const esc = task.escalation;
  if (!esc) return false;

  const userLabel = esc.username
    ? `@${esc.username}`
    : `User ${esc.userId || "unknown"}`;

  let text = `🤔 <b>Bot may need help</b>\n\n`;
  text += `<b>User:</b> ${escapeHtml(userLabel)}\n`;

  if (esc.originalMessage) {
    text += `<b>Question:</b>\n<i>${escapeHtml(esc.originalMessage.substring(0, 150))}</i>\n\n`;
  }

  text += `<b>Bot answered:</b>\n<i>${escapeHtml(botResponse.substring(0, 200))}${botResponse.length > 200 ? "..." : ""}</i>\n\n`;
  text += `The response may be uncertain. Review if needed.`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "✅ Looks OK", callback_data: `kb:resolve:${task.id}` },
        { text: "🗑️ Dismiss", callback_data: `kb:dismiss:${task.id}` },
      ],
    ],
  };

  return await sendTelegramMessage(
    env.TELEGRAM_BOT_TOKEN,
    ownerId,
    text,
    keyboard,
  );
}

// ─── Internal ──────────────────────────────────────────────────────

async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  text: string,
  replyMarkup?: object,
): Promise<boolean> {
  try {
    const api = getTelegramApi(botToken);
    await api.sendMessage(chatId, text, {
      parse_mode: "HTML",
      reply_markup: replyMarkup as any,
    });
    return true;
  } catch {
    return false;
  }
}
