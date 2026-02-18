/**
 * Message Handler (Refactored)
 *
 * Two-level interaction model:
 *
 * **Owner (OWNER_ID)**: Full access — task detection, NLP commands,
 * agent pipeline with complete history, admin features.
 *
 * **Regular users**: Bot operates in the role assigned by the owner.
 * - In groups: Moderation + proactive responses (unchanged)
 * - In DMs: Interact with the bot's assigned role (support, assistant, etc.)
 *   No task creation, no admin commands. If the bot can't help → escalation.
 *
 * **Group chats**: Only moderation + proactive auto-reply are active for everyone.
 * Task detection in groups only triggers for the owner.
 */

import { Context } from "grammy";
import { getOrCreateSessionData } from "../utils/session";
import { streamAgentResponse } from "../utils/agent-client";
import {
  getMessageHistory,
  addToHistory,
  historyToModelMessages,
  getAgentSystemPromptAsync,
} from "../utils/message-history";
import { getCurrentAgentInfo } from "./agent-handler";
import { getModerationSettings } from "../utils/moderation-storage";
import { quickModerateMessage, moderateMessage } from "../utils/spam-detector";
import { executeModeration } from "./moderation-actions";
import {
  shouldRespondProactively,
  handleProactiveResponse,
} from "../utils/proactive-responder";
import { loggers } from "../utils/logger";
import { escapeMarkdown, sendLongMessage, formatError } from "../utils/helpers";
import { TelegramLog, truncLog } from "../utils/telegram-logger";
import { detectTask, handleOwnerTask } from "./task-handler";
import { isOwner } from "../utils/owner";
import { createEscalation } from "../utils/kanban-storage";
import {
  notifyOwnerEscalation,
  notifyOwnerUncertainResponse,
} from "../utils/owner-notify";
import { ensureChatRegistered } from "../utils/bot-chats-storage";
import { indexMessage } from "../utils/chat-memory";
import type { TelegramBotEnv } from "../types/env";

const log = loggers.message;

type Env = TelegramBotEnv;

// ─── Simple per-user rate limiter (in-memory, per isolate) ──────────
// Protects against DM spam that would accumulate AI costs.
// Resets naturally when the Worker isolate is evicted.
const DM_RATE_LIMIT = 10; // max messages per window
const DM_RATE_WINDOW_MS = 60_000; // 1 minute window

const rateLimitMap = new Map<number, { count: number; resetAt: number }>();

function checkRateLimit(userId: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + DM_RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= DM_RATE_LIMIT;
}

/**
 * Handle incoming Telegram messages and forward to agent.
 *
 * **Group chats**: Only moderation + proactive auto-reply are active.
 * Regular messages are NOT forwarded to the AI agent — the function
 * returns early after the moderation/proactive checks.
 * Task detection in groups only triggers for the OWNER.
 *
 * **Private chats (DMs)**:
 * - Owner: Task detection → full agent pipeline (session, history, streaming)
 * - Users: Agent pipeline with role-based prompt. No task creation.
 *   If the bot fails or can't help → escalation to owner via kanban.
 */
export async function handleMessage(
  ctx: Context,
  env: Env,
  messageText: string,
  tgLog?: TelegramLog,
): Promise<void> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  const messageId = ctx.message?.message_id;
  const username = ctx.from?.username;
  const firstName = ctx.from?.first_name;
  const chatType = ctx.chat?.type;

  if (!chatId) {
    log.error("No chat ID in context");
    tgLog?.error("No chat ID in context — dropping update");
    return;
  }

  const userIsOwner = await isOwner(env, userId);

  // ─── Log header ────────────────────────────────────────────────
  const userLabel = username ? `@${username}` : firstName || `user:${userId}`;
  const chatLabel = chatType === "private" ? "DM" : `${chatType}:${chatId}`;
  const ownerTag = userIsOwner ? " [OWNER]" : "";
  tgLog?.header(`Message from ${userLabel}${ownerTag} (${chatLabel})`);
  tgLog?.step(
    `Text: "${truncLog(messageText, 60)}" (${messageText.length} chars)`,
  );

  // ============ Auto-register group/channel ============
  if (
    chatType === "group" ||
    chatType === "supergroup" ||
    chatType === "channel"
  ) {
    try {
      const chat = ctx.chat;
      const chatTitle = chat && "title" in chat ? chat.title : `Chat ${chatId}`;
      const chatUsername =
        chat && "username" in chat ? chat.username : undefined;
      const type =
        chatType === "channel"
          ? "channel"
          : chatType === "supergroup"
            ? "supergroup"
            : "group";
      const wasNew = await ensureChatRegistered(
        env.SESSIONS,
        chatId,
        chatTitle,
        type,
        chatUsername,
        userId,
      );
      if (wasNew)
        tgLog?.info(`Auto-registered chat: "${chatTitle}" (${chatType})`);
    } catch {
      // Non-critical — don't block message processing
    }
  }

  // ============ Index message into chat memory ============
  if (
    (chatType === "group" || chatType === "supergroup") &&
    userId &&
    messageId &&
    messageText.length >= 10
  ) {
    // Awaited to ensure indexing completes before Worker terminates.
    // indexMessage handles its own errors — won't throw.
    await indexMessage(
      env,
      chatId,
      messageId,
      userId,
      firstName || username || `user_${userId}`,
      messageText,
      ctx.message?.reply_to_message?.message_id,
    );
  }

  // ============ Moderation Check (for groups) ============
  if (
    (chatType === "group" || chatType === "supergroup") &&
    userId &&
    messageId
  ) {
    tgLog?.decision(`Group message → moderation + proactive pipeline`);

    try {
      const settings = await getModerationSettings(env.SESSIONS, chatId);

      if (settings?.enabled) {
        tgLog?.thought(`Moderation enabled for this group`);

        let result = await quickModerateMessage(
          messageText,
          chatId,
          userId,
          settings,
          env,
        );

        if (result) {
          tgLog?.info(
            `Quick moderation: ${result.category} (${Math.round(result.confidence * 100)}%) → ${result.action}`,
          );
        } else {
          tgLog?.info(`Quick moderation: clean`);
        }

        if (!result && messageText.length > 30) {
          tgLog?.thought(`Message > 30 chars, running full moderation check`);
          result = await moderateMessage(
            messageText,
            chatId,
            userId,
            settings,
            env,
          );
          if (result) {
            tgLog?.info(
              `Full moderation: ${result.category} (${Math.round(result.confidence * 100)}%) → ${result.action}`,
            );
          } else {
            tgLog?.info(`Full moderation: clean`);
          }
        }

        if (result && result.action !== "none") {
          log.info("Moderation triggered", {
            category: result.category,
            confidence: result.confidence,
            action: result.action,
          });
          tgLog?.decision(
            `Moderation action: ${result.action} (${result.reason})`,
          );

          await executeModeration(
            ctx,
            env,
            settings,
            result,
            messageId,
            userId,
            username,
            messageText,
          );

          if (result.action === "delete" || result.action === "ban") {
            tgLog?.ok(`Action executed: ${result.action}. Stopping.`);
            return;
          }
          tgLog?.ok(`Action executed: ${result.action}. Continuing.`);
        } else {
          tgLog?.ok(`Moderation passed — no action needed`);
        }
      } else {
        tgLog?.thought(`Moderation disabled for this group`);
      }
    } catch (error) {
      log.error("Moderation error", error);
      tgLog?.error(`Moderation error: ${formatError(error)}`);
    }

    // ============ Task Detection in Groups (OWNER ONLY when mentioned) ============
    if (userIsOwner) {
      try {
        const botUser = ctx.me.username || "bot";
        const mentionPattern = new RegExp(`@${botUser}\\b`, "i");
        const isMentioned = mentionPattern.test(messageText);
        const isReplyToBot =
          ctx.message?.reply_to_message?.from?.id === ctx.me.id;

        if (isMentioned || isReplyToBot) {
          const cleanMessage = messageText.replace(mentionPattern, "").trim();
          const groupTask = detectTask(cleanMessage);

          if (groupTask.type !== "none") {
            tgLog?.decision(
              `Owner group task detected (${isMentioned ? "mention" : "reply"}): ${groupTask.type}`,
            );
            const handled = await handleOwnerTask(ctx, env, groupTask, tgLog);
            if (handled) return;
          }
        }
      } catch (error) {
        log.error("Group task detection error", error);
        tgLog?.error(`Group task detection error: ${formatError(error)}`);
      }
    }

    // ============ Proactive Mode Check (for groups) ============
    try {
      const botUsername = ctx.me.username || "bot";
      tgLog?.step(`Checking proactive mode (bot: @${botUsername})`);

      const proactiveCheck = await shouldRespondProactively(
        ctx,
        env,
        messageText,
        botUsername,
      );

      if (proactiveCheck.shouldRespond) {
        log.info("Proactive trigger", {
          reason: proactiveCheck.reason,
          trigger: proactiveCheck.trigger,
        });
        tgLog?.decision(
          `Proactive trigger: ${proactiveCheck.trigger} — ${proactiveCheck.reason}`,
        );

        const responded = await handleProactiveResponse(
          ctx,
          env,
          messageText,
          proactiveCheck,
        );
        if (responded) {
          tgLog?.ok(`Proactive response sent`);
          return;
        }
        tgLog?.warn(`Proactive response failed to send`);
      } else {
        tgLog?.thought(`Proactive: skip — ${proactiveCheck.reason}`);
      }
    } catch (error) {
      log.error("Proactive mode error", error);
      tgLog?.error(`Proactive error: ${formatError(error)}`);
    }

    // Intentional: group messages stop here. No agent forwarding in groups.
    tgLog?.info(`Group processing complete — no agent forwarding`);
    return;
  }

  // ============ DM Processing ============

  // ── Rate limiting (non-owner users only) ──
  if (!userIsOwner && userId && !checkRateLimit(userId)) {
    log.warn("Rate limited", { userId });
    tgLog?.warn(`Rate limited user ${userId}`);
    await ctx.reply(
      "⏳ Too many messages. Please wait a moment before sending more.",
    );
    return;
  }

  // ── Owner DM: task detection first ──
  if (userIsOwner) {
    tgLog?.decision(`Owner DM → task detection + full agent pipeline`);

    const task = detectTask(messageText);
    if (task.type !== "none") {
      tgLog?.decision(
        `Owner task detected: ${task.type}${task.topic ? ` — "${truncLog(task.topic, 40)}"` : ""}`,
      );
      const handled = await handleOwnerTask(ctx, env, task, tgLog);
      if (handled) return;
      tgLog?.thought(`Task handler returned false, proceeding with agent`);
    }
  } else {
    tgLog?.decision(`User DM → role-based agent pipeline (no task creation)`);
  }

  // ── Agent pipeline (both owner and users, but with different context) ──
  try {
    const {
      url: agentUrl,
      name: agentName,
      id: agentId,
      sessionId,
    } = await getCurrentAgentInfo(env, chatId.toString());
    log.debug("Session ready", { chatId, sessionId });
    log.debug("Using agent", { agentName, agentUrl });

    tgLog?.info(`Agent: ${agentName}`);
    tgLog?.info(`Session: ${sessionId}`);
    tgLog?.info(`Agent URL: ${agentUrl}`);

    const history = await getMessageHistory(env.SESSIONS, sessionId);
    const historyMessages = historyToModelMessages(history, agentId);
    const systemPrompt = await getAgentSystemPromptAsync(
      env.SESSIONS,
      agentName,
      history,
    );

    tgLog?.info(`History: ${historyMessages.length} messages loaded`);
    tgLog?.thought(`System prompt: "${truncLog(systemPrompt, 80)}"`);

    await addToHistory(env.SESSIONS, sessionId, "user", messageText);

    let fullResponse = "";
    let messageSent = false;
    let sentMessageId: number | undefined;
    let lastUpdateTime = Date.now();
    const UPDATE_INTERVAL = 500;

    const allMessages = [
      { role: "system" as const, content: systemPrompt },
      ...historyMessages,
      { role: "user" as const, content: messageText },
    ];

    const useServiceBinding = !!env.AGENT_SERVICE && agentUrl === env.AGENT_URL;
    log.debug("Starting stream", { useServiceBinding });

    tgLog?.step(
      `Sending to agent (${allMessages.length} messages, binding: ${useServiceBinding})`,
    );

    let chunkCount = 0;
    const streamStartTime = Date.now();

    await streamAgentResponse(
      agentUrl,
      sessionId,
      allMessages,
      async (chunk: string) => {
        chunkCount++;
        fullResponse += chunk;

        const now = Date.now();
        const shouldUpdate = now - lastUpdateTime >= UPDATE_INTERVAL;

        if (!messageSent && fullResponse.length > 50) {
          const textToSend =
            fullResponse.length > 4096
              ? fullResponse.slice(0, 4096)
              : fullResponse;
          const sent = await ctx.reply(textToSend);
          sentMessageId = sent.message_id;
          messageSent = true;
          lastUpdateTime = now;
        } else if (
          messageSent &&
          sentMessageId &&
          shouldUpdate &&
          fullResponse.length > 0
        ) {
          try {
            const textToSend =
              fullResponse.length > 4096
                ? fullResponse.slice(0, 4096)
                : fullResponse;
            await ctx.api.editMessageText(chatId, sentMessageId, textToSend);
            lastUpdateTime = now;
          } catch (error) {
            log.warn("Failed to edit message", { error });
          }
        }
      },
      useServiceBinding ? env.AGENT_SERVICE : undefined,
      tgLog,
    );

    const streamDuration = Date.now() - streamStartTime;
    log.debug("Stream complete", {
      chunks: chunkCount,
      length: fullResponse.length,
    });
    tgLog?.ok(
      `Agent responded (${streamDuration}ms, ${chunkCount} chunks, ${fullResponse.length} chars)`,
    );

    if (fullResponse.length > 0) {
      await addToHistory(
        env.SESSIONS,
        sessionId,
        "assistant",
        fullResponse,
        agentId,
        agentName,
      );
    }

    const escapedAgentName = escapeMarkdown(agentName);
    const signedResponse = `🤖 *${escapedAgentName}*\n\n` + fullResponse;
    const plainSignedResponse = `🤖 ${agentName}\n\n` + fullResponse;

    if (fullResponse.length > 0) {
      if (messageSent && sentMessageId) {
        try {
          await sendLongMessage(ctx, signedResponse, async (part) => {
            await ctx.api.editMessageText(chatId, sentMessageId!, part, {
              parse_mode: "Markdown",
            });
          });
          tgLog?.ok(`Reply sent (Markdown, edited streaming preview)`);
        } catch (error) {
          log.warn("Markdown edit failed, falling back to plain text", {
            error,
          });
          tgLog?.warn(`Markdown failed, trying plain text`);
          try {
            await sendLongMessage(ctx, plainSignedResponse, async (part) => {
              await ctx.api.editMessageText(chatId, sentMessageId!, part);
            });
            tgLog?.ok(`Reply sent (plain text, edited)`);
          } catch (editError) {
            log.warn("Plain text edit also failed, sending new message", {
              editError,
            });
            tgLog?.warn(`Edit failed, sending new message`);
            await sendLongMessage(ctx, plainSignedResponse, async (part) => {
              await ctx.reply(part);
            });
            tgLog?.ok(`Reply sent (new plain text message)`);
          }
        }
      } else {
        try {
          await sendLongMessage(ctx, signedResponse, async (part) => {
            await ctx.reply(part, { parse_mode: "Markdown" });
          });
          tgLog?.ok(`Reply sent (Markdown, new message)`);
        } catch (mdError) {
          await sendLongMessage(ctx, plainSignedResponse, async (part) => {
            await ctx.reply(part);
          });
          tgLog?.ok(`Reply sent (plain text fallback)`);
        }
      }

      // Confidence-based soft escalation for non-owner users
      if (!userIsOwner && userId) {
        try {
          if (looksUncertain(fullResponse)) {
            tgLog?.thought(`Response looks uncertain — soft escalation`);
            const softEsc = await createEscalation(env.SESSIONS, {
              reason: "Bot response may be uncertain or unhelpful",
              userId,
              username,
              originalMessage: messageText.substring(0, 500),
              chatId,
              chatTitle: "DM",
            });
            await notifyOwnerUncertainResponse(env, softEsc, fullResponse);
            tgLog?.ok(`Soft escalation created + owner notified`);
          }
        } catch {
          // Non-critical — don't break the flow
        }
      }
    } else {
      log.warn("No response content to send");
      tgLog?.warn(`No response content from agent — nothing to send`);

      // If a regular user got no response → escalate to owner
      if (!userIsOwner && userId) {
        tgLog?.decision(`Escalating to owner: empty agent response for user`);
        try {
          const escTask = await createEscalation(env.SESSIONS, {
            reason: "Bot failed to generate a response for user message",
            userId,
            username,
            originalMessage: messageText.substring(0, 500),
            chatId,
            chatTitle: "DM",
          });
          // Push-notify the owner
          await notifyOwnerEscalation(env, escTask);
          await ctx.reply(
            "I'm sorry, I wasn't able to help with that. I've notified the team and they'll get back to you.",
          );
          tgLog?.ok(`Escalation created + owner notified`);
        } catch (escError) {
          tgLog?.error(`Failed to create escalation: ${escError}`);
        }
      }
    }
  } catch (error) {
    log.error("handleMessage failed", error);
    tgLog?.error(`handleMessage failed: ${formatError(error)}`);

    // If a regular user hit an error → escalate to owner
    if (!userIsOwner && userId) {
      tgLog?.decision(`Escalating to owner: agent error for user`);
      try {
        const escTask = await createEscalation(env.SESSIONS, {
          reason: `Agent error: ${formatError(error)}`,
          userId,
          username,
          originalMessage: messageText.substring(0, 500),
          chatId,
          chatTitle: "DM",
        });
        await notifyOwnerEscalation(env, escTask);
        await ctx.reply(
          "I'm sorry, something went wrong. I've notified the team — they'll look into it.",
        );
        tgLog?.ok(`Escalation created + owner notified`);
        return; // Don't throw — we handled it gracefully
      } catch (escError) {
        tgLog?.error(`Failed to create escalation: ${escError}`);
      }
    }

    await ctx.reply(
      `❌ Error: ${formatError(error)}\n\nPlease try again or use /status to check the connection.`,
    );
    throw error;
  }
}

// ─── Confidence Detection ──────────────────────────────────────────

/**
 * Uncertainty patterns — only explicit refusals, not casual mentions.
 *
 * Requires TWO conditions to trigger:
 * 1. Response is short (under 600 chars — long answers are usually helpful)
 * 2. Contains an explicit refusal / inability phrase
 *
 * Avoids: "к сожалению", "unfortunately" alone — these appear in normal answers.
 */
const UNCERTAINTY_PATTERNS = [
  // EN: explicit inability
  /\bi(?:'m| am) not (?:sure|able)\b.*\b(?:help|answer|assist|provide)\b/i,
  /\bi (?:don'?t|do not) have (?:that|this|enough) information\b/i,
  /\bi(?:'m| am) unable to (?:help|answer|assist|provide)\b/i,
  /\bi cannot (?:help|answer|assist) (?:with|you)\b/i,
  /\bbeyond my (?:knowledge|capabilities|scope)\b/i,
  /\bi'?m afraid i (?:can'?t|cannot|don'?t)\b/i,
  // EN: explicit redirect
  /\byou (?:should|need to|might want to) (?:contact|reach out to|ask) (?:a |an |the )?\w+ (?:support|team|admin|human)\b/i,
  // RU: explicit inability
  /\bя не могу (?:помочь|ответить|предоставить)\b/i,
  /\bне в моей компетенции\b/i,
  /\bобратитесь к (?:администратор|поддержк|специалист|оператор)/i,
];

/**
 * Heuristic: does the bot response look like an explicit refusal?
 * Only short responses are flagged — long detailed answers are not.
 */
function looksUncertain(response: string): boolean {
  if (!response || response.length < 20) return false;
  // Long responses are likely detailed and helpful
  if (response.length > 600) return false;

  return UNCERTAINTY_PATTERNS.some((pattern) => pattern.test(response));
}
