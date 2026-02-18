/**
 * Moderation Actions Handler
 * Executes moderation actions (delete, warn, mute, ban) and logs them
 */

import { Context, Api } from "grammy";
import { escapeHtml } from "../utils/helpers";
import type {
  ModerationSettings,
  ModerationResult,
  ModerationLog,
  ModerationAction,
} from "../types/moderation";
import { CATEGORY_INFO, ACTION_INFO } from "../types/moderation";
import {
  addModerationLog,
  addUserWarning,
  clearFloodCache,
} from "../utils/moderation-storage";
import { loggers } from "../utils/logger";

const logger = loggers.moderation;

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  SESSIONS: KVNamespace;
}

// Warning thresholds for escalation
const WARNING_THRESHOLDS = {
  MUTE_AFTER: 5, // Mute after 5 warnings (was 3 — too aggressive)
  BAN_AFTER: 8, // Ban after 8 warnings (was 5)
};

// Mute duration in seconds
const MUTE_DURATION = 15 * 60; // 15 minutes (was 1 hour — too harsh)

/**
 * Execute moderation action based on result
 */
export async function executeModeration(
  ctx: Context,
  env: Env,
  settings: ModerationSettings,
  result: ModerationResult,
  messageId: number,
  userId: number,
  username?: string,
  messageText?: string,
): Promise<boolean> {
  const chatId = settings.chatId;
  let actionTaken = result.action;

  try {
    // Execute the action
    switch (result.action) {
      case "delete":
        await deleteMessage(ctx, chatId, messageId);
        break;

      case "warn":
        const warning = await warnUser(
          ctx,
          env,
          chatId,
          userId,
          username,
          result.reason,
        );
        // Escalate if too many warnings
        if (warning.count >= WARNING_THRESHOLDS.BAN_AFTER) {
          await banUser(ctx, chatId, userId);
          actionTaken = "ban";
        } else if (warning.count >= WARNING_THRESHOLDS.MUTE_AFTER) {
          await muteUser(ctx, chatId, userId, MUTE_DURATION);
          actionTaken = "mute";
        }
        break;

      case "mute":
        await deleteMessage(ctx, chatId, messageId);
        await muteUser(ctx, chatId, userId, MUTE_DURATION);
        await clearFloodCache(env.SESSIONS, chatId, userId);
        break;

      case "ban":
        await deleteMessage(ctx, chatId, messageId);
        await banUser(ctx, chatId, userId);
        break;

      case "none":
        // No action needed
        return true;
    }

    // Log the action
    const log: ModerationLog = {
      id: generateLogId(),
      chatId,
      userId,
      username,
      messageId,
      messageText: messageText?.substring(0, 500) || "",
      result,
      actionTaken,
      timestamp: Date.now(),
    };
    await addModerationLog(env.SESSIONS, log);

    // Update Kanban task stats (if a moderation task exists)
    try {
      const { findActiveTask, incrementTaskStat, addTaskLog } =
        await import("../utils/kanban-storage");
      const modTask = await findActiveTask(env.SESSIONS, chatId, "moderator");
      if (modTask) {
        await incrementTaskStat(env.SESSIONS, modTask.id, "totalActions");
        if (result.category) {
          await incrementTaskStat(env.SESSIONS, modTask.id, result.category);
        }
        if (actionTaken && actionTaken !== "none") {
          await addTaskLog(
            env.SESSIONS,
            modTask.id,
            `${actionTaken}: ${result.category || "violation"} by @${username || userId}`,
            result.category,
          );
        }
      }
    } catch {
      // Non-critical — don't break moderation if kanban fails
    }

    // Notify admins if enabled
    if (settings.notifyAdmins && actionTaken !== "none") {
      await notifyAdmins(ctx, env, settings, log);
    }

    // Log to channel if configured
    if (settings.logChannelId) {
      await logToChannel(ctx, settings.logChannelId, log);
    }

    return true;
  } catch (error) {
    logger.error("Moderation action error", error);
    return false;
  }
}

/**
 * Delete a message
 */
async function deleteMessage(
  ctx: Context,
  chatId: number,
  messageId: number,
): Promise<boolean> {
  try {
    await ctx.api.deleteMessage(chatId, messageId);
    return true;
  } catch (error) {
    logger.error("Failed to delete message", error);
    return false;
  }
}

/**
 * Warn a user
 */
async function warnUser(
  ctx: Context,
  env: Env,
  chatId: number,
  userId: number,
  username: string | undefined,
  reason: string,
): Promise<{ count: number }> {
  const warning = await addUserWarning(env.SESSIONS, chatId, userId, reason);

  const userMention = username ? `@${username}` : `User ${userId}`;
  const remainingUntilMute = WARNING_THRESHOLDS.MUTE_AFTER - warning.count;
  const remainingUntilBan = WARNING_THRESHOLDS.BAN_AFTER - warning.count;

  let warningMsg = `⚠️ <b>Warning</b>\n\n`;
  warningMsg += `${userMention}, your message was flagged.\n`;
  warningMsg += `Reason: ${reason}\n\n`;
  warningMsg += `Warnings: ${warning.count}/${WARNING_THRESHOLDS.BAN_AFTER}`;

  if (remainingUntilMute > 0) {
    warningMsg += `\n${remainingUntilMute} more → mute`;
  } else if (remainingUntilBan > 0) {
    warningMsg += `\n${remainingUntilBan} more → ban`;
  }

  try {
    await ctx.api.sendMessage(chatId, warningMsg, { parse_mode: "HTML" });
  } catch (error) {
    logger.error("Failed to send warning", error);
  }

  return warning;
}

/**
 * Mute a user (restrict from sending messages)
 */
async function muteUser(
  ctx: Context,
  chatId: number,
  userId: number,
  durationSeconds: number,
): Promise<boolean> {
  try {
    const untilDate = Math.floor(Date.now() / 1000) + durationSeconds;

    await ctx.api.restrictChatMember(
      chatId,
      userId,
      {
        can_send_messages: false,
        can_send_audios: false,
        can_send_documents: false,
        can_send_photos: false,
        can_send_videos: false,
        can_send_video_notes: false,
        can_send_voice_notes: false,
        can_send_polls: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
      },
      { until_date: untilDate },
    );

    // Notify user
    const minutes = Math.floor(durationSeconds / 60);
    await ctx.api.sendMessage(
      chatId,
      `🔇 User ${userId} has been muted for ${minutes} minutes due to repeated violations.`,
    );

    return true;
  } catch (error) {
    logger.error("Failed to mute user", error);
    return false;
  }
}

/**
 * Ban a user from the chat
 */
async function banUser(
  ctx: Context,
  chatId: number,
  userId: number,
): Promise<boolean> {
  try {
    await ctx.api.banChatMember(chatId, userId);

    await ctx.api.sendMessage(
      chatId,
      `🚫 User ${userId} has been banned due to repeated violations.`,
    );

    return true;
  } catch (error) {
    logger.error("Failed to ban user", error);
    return false;
  }
}

/**
 * Notify group admins about moderation action
 */
async function notifyAdmins(
  ctx: Context,
  env: Env,
  settings: ModerationSettings,
  log: ModerationLog,
): Promise<void> {
  // For now, we just log to console
  // In production, could DM admins or post to admin channel
  logger.info("Action taken", {
    chat: settings.chatTitle,
    action: log.actionTaken,
    userId: log.userId,
    reason: log.result.reason,
  });
}

/**
 * Log moderation action to a channel
 */
async function logToChannel(
  ctx: Context,
  channelId: number,
  log: ModerationLog,
): Promise<void> {
  try {
    const categoryInfo = CATEGORY_INFO[log.result.category];
    const actionInfo = ACTION_INFO[log.actionTaken];

    let message = `🛡️ <b>Moderation Log</b>\n\n`;
    message += `${categoryInfo.emoji} Category: ${categoryInfo.label}\n`;
    message += `${actionInfo.emoji} Action: ${actionInfo.label}\n`;
    message += `👤 User: ${log.username ? `@${log.username}` : log.userId}\n`;
    message += `📝 Reason: ${log.result.reason}\n`;
    message += `🎯 Confidence: ${Math.round(log.result.confidence * 100)}%\n\n`;

    if (log.messageText) {
      message += `<b>Message:</b>\n<code>${escapeHtml(log.messageText.substring(0, 200))}</code>`;
      if (log.messageText.length > 200) message += "...";
    }

    await ctx.api.sendMessage(channelId, message, { parse_mode: "HTML" });
  } catch (error) {
    logger.error("Failed to log to channel", error);
  }
}

/**
 * Generate unique log ID
 */
function generateLogId(): string {
  return `log_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
}

/**
 * Unban a user (for admin command)
 */
export async function unbanUser(
  api: Api,
  chatId: number,
  userId: number,
): Promise<boolean> {
  try {
    await api.unbanChatMember(chatId, userId, { only_if_banned: true });
    return true;
  } catch (error) {
    logger.error("Failed to unban user", error);
    return false;
  }
}

/**
 * Unmute a user (for admin command)
 */
export async function unmuteUser(
  api: Api,
  chatId: number,
  userId: number,
): Promise<boolean> {
  try {
    await api.restrictChatMember(chatId, userId, {
      can_send_messages: true,
      can_send_audios: true,
      can_send_documents: true,
      can_send_photos: true,
      can_send_videos: true,
      can_send_video_notes: true,
      can_send_voice_notes: true,
      can_send_polls: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true,
    });
    return true;
  } catch (error) {
    logger.error("Failed to unmute user", error);
    return false;
  }
}

/**
 * Clear warnings for a user (for admin command)
 */
export async function clearWarnings(
  env: Env,
  chatId: number,
  userId: number,
): Promise<void> {
  const { clearUserWarnings } = await import("../utils/moderation-storage");
  await clearUserWarnings(env.SESSIONS, chatId, userId);
}
