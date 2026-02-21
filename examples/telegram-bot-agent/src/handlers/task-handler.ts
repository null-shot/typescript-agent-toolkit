/**
 * Task Handler (Refactored)
 *
 * Two-level interaction model:
 * - Owner: NLP detection creates kanban tasks (with optional approval flow)
 * - Users: Cannot create tasks; interact with bot in assigned role only
 *
 * Task flow:
 * 1. Owner says "write a post about AI"
 * 2. detectTask() → { type: "write_post", topic: "AI" }
 * 3. handleOwnerTask() → generates content → creates kanban task with status "awaiting-approval"
 * 4. Owner sees preview → approves/rejects/edits via inline keyboard
 * 5. On approval → executeTask() publishes the post
 *
 * For capabilities (moderate, engage): these toggle chat settings directly
 * and create persistent kanban tasks as trackers.
 */

import { Bot, Context, InlineKeyboard } from "grammy";
import { sendAgentMessage } from "../utils/agent-client";
import {
  POST_PROMPT,
  IMAGE_POST_PROMPT,
  MULTIFORMAT_POST_PROMPT,
  parseFormatHints,
  getPromptForFormat,
} from "../utils/prompts";
import { parseContentBlock } from "../types/content";
import { publishContent } from "../utils/content-publisher";
import { getTelegramApi } from "../utils/telegram-api";
import { getCurrentAgentInfo } from "./agent-handler";
import {
  getOrCreateSettings,
  toggleModeration,
  addUserManagedChat,
  getUserManagedChats,
} from "../utils/moderation-storage";
import {
  enableProactiveMode,
  disableProactiveMode,
} from "../utils/proactive-storage";
import { getBotChannels, getBotGroups } from "../utils/bot-chats-storage";
import {
  createApprovalTask,
  rejectTask,
  moveTask,
  getTask,
  updateTask,
  ensurePersistentTask,
  deactivatePersistentTask,
  getKanbanBoard,
  getAggregateStats,
  deleteTask,
  addTaskLog,
  incrementTaskStat,
  findActiveTask,
  recordTaskRun,
} from "../utils/kanban-storage";
import { isOwner } from "../utils/owner";
import { getKnowledgeBasePrompt } from "../utils/knowledge-base";
import { TelegramLog, truncLog } from "../utils/telegram-logger";
import { loggers } from "../utils/logger";
import {
  escapeHtml,
  buildPostLink,
  formatError,
  resolveTarget,
} from "../utils/helpers";
import type { DetectedTask } from "../types/task";
import type { TelegramBotEnv } from "../types/env";

const log = loggers.bot;

type Env = TelegramBotEnv;

// ─── Task Detection ────────────────────────────────────────────────

/** Patterns for "write a post" (EN + RU) */
const WRITE_POST_PATTERNS = [
  // EN
  /(?:write|create|make|generate|compose|draft)\s+(?:a\s+)?(?:post|article|message|text)\s*(.*)/i,
  /(?:publish|send)\s+(?:a\s+)?(?:post|message)\s*(.*)/i,
  // RU
  /(?:напиши|создай|сгенерируй|подготовь|составь|сделай)\s+(?:пост|статью|сообщение|текст)\s*(.*)/i,
  /(?:опубликуй|отправь)\s+(?:пост|сообщение)\s*(.*)/i,
];

/** Patterns for "start moderating" (EN + RU) */
const MODERATE_ON_PATTERNS = [
  // EN
  /(?:start|enable|begin|turn\s+on)\s+moderat/i,
  /(?:watch|guard|protect)\s+(?:the\s+)?(?:chat|group)/i,
  // RU
  /(?:начни|включи|запусти|активируй)\s+модерац/i,
  /(?:следи|охраняй|защищай)\s+(?:за\s+)?(?:чат|группу)/i,
];

/** Patterns for "stop moderating" (EN + RU) */
const MODERATE_OFF_PATTERNS = [
  // EN
  /(?:stop|disable|end|turn\s+off)\s+moderat/i,
  // RU
  /(?:останови|выключи|отключи|прекрати)\s+модерац/i,
];

/** Patterns for "start community engagement" (EN + RU) */
const ENGAGE_ON_PATTERNS = [
  // EN
  /(?:engage|start\s+engaging|community\s+mode|be\s+active|manage\s+community)/i,
  /(?:enable|start|turn\s+on)\s+(?:proactive|community|engagement)/i,
  // RU
  /(?:включи|начни|запусти)\s+(?:общение|коммьюнити|вовлечение|проактивн)/i,
  /(?:будь\s+активн|управляй\s+(?:сообществом|чатом))/i,
];

/** Patterns for "stop community engagement" (EN + RU) */
const ENGAGE_OFF_PATTERNS = [
  // EN
  /(?:stop\s+engag|disable\s+proactive|stop\s+community)/i,
  /(?:turn\s+off|disable)\s+(?:proactive|community|engagement)/i,
  // RU
  /(?:останови|выключи|отключи|прекрати)\s+(?:общение|коммьюнити|вовлечение|проактивн)/i,
];

/** Patterns for "enable images with posts" (EN + RU) */
const IMAGES_ON_PATTERNS = [
  /(?:enable|turn\s+on|start)\s+(?:post\s+)?image/i,
  /(?:images?|pictures?|photos?)\s+(?:on|enable)/i,
  /(?:включи|добавь|верни)\s+(?:картинк|изображен|фото)/i,
  /посты?\s+с\s+(?:картинк|фото|изображен)/i,
];

/** Patterns for "disable images with posts" (EN + RU) */
const IMAGES_OFF_PATTERNS = [
  /(?:disable|turn\s+off|stop|no)\s+(?:post\s+)?image/i,
  /(?:images?|pictures?|photos?)\s+(?:off|disable)/i,
  /(?:выключи|убери|отключи)\s+(?:картинк|изображен|фото)/i,
  /посты?\s+без\s+(?:картин|фото|изображен)/i,
  /(?:text|текст)\s+only/i,
];

/**
 * Detect if a message contains a natural language task.
 */
export function detectTask(message: string): DetectedTask {
  const trimmed = message.trim();

  // Check write_post patterns
  for (const pattern of WRITE_POST_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      let topic = (match[1] || "").trim();
      // Clean up topic: remove "about" / "про" / "на тему" / "о" prefix
      topic = topic.replace(/^(?:about|про|на\s+тему|об?)\s+/i, "").trim();
      return {
        type: "write_post",
        topic: topic || undefined,
        message: trimmed,
      };
    }
  }

  // Check moderate on
  for (const pattern of MODERATE_ON_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { type: "moderate_on", message: trimmed };
    }
  }

  // Check moderate off
  for (const pattern of MODERATE_OFF_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { type: "moderate_off", message: trimmed };
    }
  }

  // Check engage on
  for (const pattern of ENGAGE_ON_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { type: "engage_on", message: trimmed };
    }
  }

  // Check engage off
  for (const pattern of ENGAGE_OFF_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { type: "engage_off", message: trimmed };
    }
  }

  // Check images on
  for (const pattern of IMAGES_ON_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { type: "images_on", message: trimmed };
    }
  }

  // Check images off
  for (const pattern of IMAGES_OFF_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { type: "images_off", message: trimmed };
    }
  }

  return { type: "none", message: trimmed };
}

// ─── Task Execution (Owner Only) ──────────────────────────────────

/**
 * Handle a detected task from the OWNER.
 * Non-owners should never reach this function.
 */
export async function handleOwnerTask(
  ctx: Context,
  env: Env,
  task: DetectedTask,
  tgLog?: TelegramLog,
): Promise<boolean> {
  switch (task.type) {
    case "write_post":
      return await handleWritePost(ctx, env, task, tgLog);
    case "moderate_on":
      return await handleFeatureToggle(
        ctx,
        env,
        true,
        MODERATION_TOGGLE,
        tgLog,
      );
    case "moderate_off":
      return await handleFeatureToggle(
        ctx,
        env,
        false,
        MODERATION_TOGGLE,
        tgLog,
      );
    case "engage_on":
      return await handleFeatureToggle(ctx, env, true, ENGAGE_TOGGLE, tgLog);
    case "engage_off":
      return await handleFeatureToggle(ctx, env, false, ENGAGE_TOGGLE, tgLog);
    case "images_on":
      return await handleImageToggle(ctx, env, true, tgLog);
    case "images_off":
      return await handleImageToggle(ctx, env, false, tgLog);
    default:
      return false;
  }
}

// ─── Write Post → Kanban Approval ──────────────────────────────────

// POST_PROMPT imported from ../utils/prompts

async function handleWritePost(
  ctx: Context,
  env: Env,
  task: DetectedTask,
  tgLog?: TelegramLog,
): Promise<boolean> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (!chatId || !userId) return false;

  const topic = task.topic || task.message;
  tgLog?.step(
    `Task: write_post → kanban approval — topic: "${truncLog(topic, 60)}"`,
  );

  // Show typing while generating
  await ctx.api.sendChatAction(chatId, "typing");

  try {
    // Get agent info for content generation
    const { url: agentUrl, sessionId } = await getCurrentAgentInfo(
      env,
      chatId.toString(),
    );

    tgLog?.thought(`Generating post via agent...`);

    // Load Knowledge Base and build system prompt
    const kbPrompt = await getKnowledgeBasePrompt(env.SESSIONS);
    // Parse format hints from topic (e.g. "+poll", "+audio", "+text")
    const { cleanTopic: parsedTopic, format: postFormat } =
      parseFormatHints(topic);
    const imagesEnabled =
      (await env.SESSIONS?.get("setting:image_with_posts")) !== "false";
    const basePrompt = getPromptForFormat(postFormat, !!env.AI, imagesEnabled);
    const systemContent = kbPrompt + "\n\n" + basePrompt + parsedTopic;

    // Generate post content — fallback chain: Agent → Workers AI
    let content: string | null = null;
    const useServiceBinding = !!env.AGENT_SERVICE && agentUrl === env.AGENT_URL;
    const hasAgent = !!agentUrl || useServiceBinding;

    if (hasAgent) {
      try {
        content = await sendAgentMessage(
          agentUrl,
          sessionId,
          [
            { role: "system", content: systemContent },
            { role: "user", content: task.message },
          ],
          useServiceBinding ? env.AGENT_SERVICE : undefined,
          tgLog,
        );
      } catch (agentError) {
        tgLog?.warn(
          `Agent failed: ${formatError(agentError)}, trying Workers AI`,
        );
      }
    }

    // Fallback to Workers AI if agent failed or unavailable
    if ((!content || !content.trim()) && env.AI) {
      try {
        tgLog?.thought(`Generating via Workers AI (70B)...`);
        const result = (await env.AI.run(
          "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as keyof AiModels,
          {
            messages: [
              { role: "system", content: systemContent },
              { role: "user", content: task.message },
            ],
          } as any,
        )) as { response?: string };
        content = result.response ?? null;
      } catch (aiError) {
        tgLog?.error(`Workers AI also failed: ${formatError(aiError)}`);
      }
    }

    if (!content || content.trim().length === 0) {
      tgLog?.error(`All providers returned empty content`);
      await ctx.reply("❌ Failed to generate the post. Please try again.");
      return true;
    }

    tgLog?.ok(`Post generated: ${content.length} chars`);

    // Pre-generate image if the AI returned a PhotoContent with imagePrompt
    // This way the image is ready instantly when the owner approves
    if (env.AI) {
      try {
        const parsed = parseContentBlock(content.trim());
        if (
          parsed.type === "photo" &&
          parsed.imagePrompt &&
          !parsed.url &&
          !parsed.imageBase64
        ) {
          tgLog?.step(
            `Pre-generating image: "${parsed.imagePrompt.substring(0, 60)}..."`,
          );
          await ctx.api.sendChatAction(chatId, "upload_photo");

          const { generateImage } = await import("../utils/image-generator");
          const imageData = await generateImage(env.AI, parsed.imagePrompt);
          if (imageData) {
            // Encode as base64 and embed into the content JSON
            const bytes = new Uint8Array(imageData);
            let binary = "";
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]!);
            }
            const imageBase64 = btoa(binary);
            parsed.imageBase64 = imageBase64;
            content = JSON.stringify(parsed);
            tgLog?.ok(`Image pre-generated (${bytes.length} bytes)`);
          } else {
            tgLog?.warn(
              `Image pre-generation failed, will retry at publish time`,
            );
          }
        }
      } catch (imgError) {
        tgLog?.warn(`Image pre-generation error: ${formatError(imgError)}`);
        // Non-fatal — image will be generated at publish time
      }
    }

    // Get target channels/groups for display
    const botChannels = await getBotChannels(env.SESSIONS);
    const botGroups = await getBotGroups(env.SESSIONS);
    const totalTargets = botChannels.length + botGroups.length;

    // Create kanban task with approval status
    const kanbanTask = await createApprovalTask(env.SESSIONS, {
      title: `Post: ${topic.substring(0, 50)}`,
      description: `Generate and publish a post about: ${topic}`,
      action: "write_post",
      content: content.trim(),
      topic,
      chatId,
      chatTitle: ctx.chat?.title || "DM",
      role: "content",
      createdBy: userId,
      source: "owner",
    });

    // Build approval keyboard (consolidated — same function used for rewrites and back)
    const keyboard = buildPostApprovalKeyboard(
      kanbanTask.id,
      botChannels,
      botGroups,
    );

    // Show preview to owner — emphasize one-tap posting
    const previewText =
      `✨ <b>Post ready</b>\n\n` +
      `${escapeHtml(content.trim())}\n\n` +
      `─────────────────\n` +
      (totalTargets > 0
        ? `Tap a channel to post instantly:`
        : `⚠️ No channels/groups found. Add the bot as admin first.`);

    await ctx.reply(previewText, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });

    tgLog?.ok(`Kanban task ${kanbanTask.id} created (plug-and-play preview)`);
    return true;
  } catch (error) {
    log.error("Write post task failed", error);
    tgLog?.error(`Write post failed: ${formatError(error)}`);
    await ctx.reply(`❌ Error generating post: ${formatError(error)}`);
    return true;
  }
}

/**
 * Build a rich approval keyboard for a post task.
 * Row 1-N: channel/group publish targets
 * Next row: Schedule / Recurring
 * Last row: Rewrite / Reject
 */
function buildPostApprovalKeyboard(
  taskId: string,
  channels: { title: string; username?: string; chatId: number }[],
  groups: { title: string; chatId: number }[],
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  // Publish targets — use stable chatId instead of array index
  for (const ch of channels.slice(0, 4)) {
    const label = ch.title || ch.username || `Channel`;
    keyboard.text(label, `kb:approve:${taskId}:ch:${ch.chatId}`);
  }
  if (channels.length > 0) keyboard.row();

  for (const gr of groups.slice(0, 4)) {
    keyboard.text(gr.title, `kb:approve:${taskId}:gr:${gr.chatId}`);
  }
  if (groups.length > 0) keyboard.row();

  // Schedule & recurring options
  keyboard
    .text("Schedule", `kb:schedule:${taskId}`)
    .text("Recurring", `kb:recurring:${taskId}`)
    .row();

  // Rewrite & reject (reject goes to confirmation step first)
  keyboard
    .text("Rewrite", `kb:rewrite:${taskId}`)
    .text("Reject", `kb:confirmreject:${taskId}`);

  return keyboard;
}

// ─── Feature Toggle (generic for moderation & engagement) ──────────

/**
 * Configuration for a feature toggle (moderation or engagement).
 * Eliminates duplication between the nearly-identical moderate/engage flows.
 */
interface FeatureToggleConfig {
  /** Short identifier: "mod" or "eng" */
  key: string;
  /** Display name: "moderation" or "community mode" */
  label: string;
  /** Emoji when enabled */
  enabledIcon: string;
  /** Command hint for empty groups message */
  command: string;
  /** NLP hint for empty groups message */
  nlpHint: string;
  /** Apply the toggle to a specific chat */
  apply: (
    env: Env,
    chatId: number,
    chatTitle: string,
    userId: number,
    enable: boolean,
  ) => Promise<void>;
  /** Build the success reply text */
  successText: (chatTitle: string, enable: boolean) => string;
}

const MODERATION_TOGGLE: FeatureToggleConfig = {
  key: "mod",
  label: "moderation",
  enabledIcon: "🛡️",
  command: "/moderate",
  nlpHint: '"start moderating"',
  async apply(env, chatId, chatTitle, userId, enable) {
    // Step 1: ensure settings exist + track managed chat
    await getOrCreateSettings(env.SESSIONS, chatId, chatTitle);
    await addUserManagedChat(env.SESSIONS, userId, chatId, chatTitle);

    // Step 2: toggle moderation
    const settings = await toggleModeration(env.SESSIONS, chatId, enable);
    if (!settings) throw new Error("Failed to toggle moderation settings");

    // Step 3: sync kanban task (compensate on failure → revert step 2)
    try {
      if (enable) {
        await ensurePersistentTask(
          env.SESSIONS,
          chatId,
          chatTitle,
          "moderator",
          `Moderation: ${chatTitle}`,
          `Monitoring and moderating "${chatTitle}" for spam, scam, and violations.`,
          userId,
        );
      } else {
        await deactivatePersistentTask(env.SESSIONS, chatId, "moderator");
      }
    } catch (taskError) {
      // Compensate: revert the moderation toggle to keep state consistent
      await toggleModeration(env.SESSIONS, chatId, !enable);
      throw taskError;
    }
  },
  successText(chatTitle, enable) {
    const safe = escapeHtml(chatTitle);
    return enable
      ? `🛡️ Moderation <b>enabled</b> for "${safe}".\n\nBot will detect spam, scam, and violations.\nSettings: /moderate`
      : `🔕 Moderation <b>disabled</b> for "${safe}".\n\nBot no longer moderates this chat.`;
  },
};

const ENGAGE_TOGGLE: FeatureToggleConfig = {
  key: "eng",
  label: "community mode",
  enabledIcon: "💬",
  command: "/proactive",
  nlpHint: '"community mode"',
  async apply(env, chatId, chatTitle, userId, enable) {
    if (enable) {
      // Step 1: enable proactive mode
      await enableProactiveMode(env.SESSIONS, chatId, chatTitle, "community");

      // Step 2: sync kanban task (compensate on failure → revert step 1)
      try {
        await ensurePersistentTask(
          env.SESSIONS,
          chatId,
          chatTitle,
          "support",
          `Community: ${chatTitle}`,
          `Community engagement and proactive responses in "${chatTitle}".`,
          userId,
        );
      } catch (taskError) {
        await disableProactiveMode(env.SESSIONS, chatId);
        throw taskError;
      }
    } else {
      // Step 1: disable proactive mode
      await disableProactiveMode(env.SESSIONS, chatId);

      // Step 2: sync kanban task (compensate on failure → revert step 1)
      try {
        await deactivatePersistentTask(env.SESSIONS, chatId, "support");
      } catch (taskError) {
        await enableProactiveMode(env.SESSIONS, chatId, chatTitle, "community");
        throw taskError;
      }
    }
  },
  successText(chatTitle, enable) {
    const safe = escapeHtml(chatTitle);
    return enable
      ? `💬 <b>Community mode enabled</b> for "${safe}"!\n\n` +
          `The bot will:\n• Answer questions\n• Respond to @mentions\n• Engage in conversations\n• Help group members\n\nSettings: /proactive`
      : `🔕 <b>Community mode disabled</b> for "${safe}".`;
  },
};

/**
 * Toggle "images with posts" setting.
 * This is a global setting stored in KV (not per-chat).
 */
async function handleImageToggle(
  ctx: Context,
  env: Env,
  enable: boolean,
  tgLog?: TelegramLog,
): Promise<boolean> {
  try {
    if (enable) {
      await env.SESSIONS.delete("setting:image_with_posts");
    } else {
      await env.SESSIONS.put("setting:image_with_posts", "false");
    }

    const emoji = enable ? "🖼️" : "📝";
    const status = enable
      ? "enabled — all posts will include AI-generated images"
      : "disabled — posts will use AI-chosen format (text/photo/poll)";

    await ctx.reply(
      `${emoji} <b>Post images ${enable ? "ON" : "OFF"}</b>\n\n${status}`,
      {
        parse_mode: "HTML",
      },
    );

    tgLog?.ok(`Image with posts: ${enable}`);
    return true;
  } catch (error) {
    tgLog?.error(`Image toggle failed: ${formatError(error)}`);
    await ctx.reply(`❌ Failed to toggle image setting: ${formatError(error)}`);
    return true;
  }
}

/**
 * Generic feature toggle handler.
 *
 * - In a group: apply directly.
 * - In a DM with 1 managed group: apply directly.
 * - In a DM with N managed groups: show picker.
 */
async function handleFeatureToggle(
  ctx: Context,
  env: Env,
  enable: boolean,
  config: FeatureToggleConfig,
  tgLog?: TelegramLog,
): Promise<boolean> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  const chatType = ctx.chat?.type;
  if (!chatId || !userId) return false;

  tgLog?.step(`Task: ${config.key}_${enable ? "on" : "off"}`);

  // In a group — apply directly
  if (chatType === "group" || chatType === "supergroup") {
    const chatTitle = ctx.chat?.title || "Group";
    return await applyFeatureToggle(
      ctx,
      env,
      chatId,
      chatTitle,
      userId,
      enable,
      config,
      tgLog,
    );
  }

  // In DM — check managed groups
  const managedChats = await getUserManagedChats(env.SESSIONS, userId);

  if (managedChats.length === 0) {
    await ctx.reply(
      `📋 You have no groups to manage.\n\n` +
        `To add a group:\n` +
        `1. Add the bot to a group as admin\n` +
        `2. Use ${config.command} in the group\n` +
        `3. Or type ${config.nlpHint} in the group`,
      { parse_mode: "HTML" },
    );
    tgLog?.info(`No managed groups found for user`);
    return true;
  }

  if (managedChats.length === 1) {
    const chat = managedChats[0];
    return await applyFeatureToggle(
      ctx,
      env,
      chat.chatId,
      chat.chatTitle,
      userId,
      enable,
      config,
      tgLog,
    );
  }

  // Multiple groups — show picker
  const icon = enable ? config.enabledIcon : "🔕";
  const keyboard = new InlineKeyboard();
  for (const chat of managedChats.slice(0, 6)) {
    keyboard
      .text(
        `${icon} ${chat.chatTitle}`,
        `task:${config.key}:${enable ? "on" : "off"}:${chat.chatId}`,
      )
      .row();
  }
  keyboard.text("❌ Cancel", "task:cancel");

  await ctx.reply(
    `${icon} <b>${enable ? "Enable" : "Disable"} ${config.label}</b>\n\nSelect a group:`,
    { parse_mode: "HTML", reply_markup: keyboard },
  );

  tgLog?.info(`Showing ${managedChats.length} groups for ${config.key} toggle`);
  return true;
}

/**
 * Apply a feature toggle to a specific chat.
 */
async function applyFeatureToggle(
  ctx: Context,
  env: Env,
  chatId: number,
  chatTitle: string,
  userId: number,
  enable: boolean,
  config: FeatureToggleConfig,
  tgLog?: TelegramLog,
): Promise<boolean> {
  try {
    await config.apply(env, chatId, chatTitle, userId, enable);
    tgLog?.ok(
      `${config.label} ${enable ? "enabled" : "disabled"} for "${chatTitle}" (${chatId})`,
    );
    await ctx.reply(config.successText(chatTitle, enable), {
      parse_mode: "HTML",
    });
    return true;
  } catch (error) {
    tgLog?.error(`${config.label} toggle failed: ${formatError(error)}`);
    await ctx.reply(`❌ Error: ${formatError(error)}`);
    return true;
  }
}

// ─── Kanban Board Commands ─────────────────────────────────────────

/**
 * Format the kanban board for display.
 */
async function formatBoardMessage(env: Env): Promise<{
  text: string;
  keyboard: InlineKeyboard | null;
}> {
  const board = await getKanbanBoard(env.SESSIONS);
  const stats = await getAggregateStats(env.SESSIONS);

  let msg = `📋 <b>Task Board</b>\n\n`;

  if (board.awaitingApproval.length > 0) {
    msg += `⏳ <b>Awaiting Approval (${board.awaitingApproval.length})</b>\n`;
    for (const t of board.awaitingApproval.slice(0, 5)) {
      msg += `  • ${t.title}\n`;
    }
    msg += `\n`;
  }

  if (stats.escalationCount > 0) {
    const escalations = board.queued.filter(
      (t) => t.source === "bot-escalation",
    );
    msg += `⚠️ <b>Escalations (${stats.escalationCount})</b>\n`;
    for (const t of escalations.slice(0, 5)) {
      msg += `  • ${t.title}\n`;
    }
    msg += `\n`;
  }

  if (board.queued.filter((t) => t.source !== "bot-escalation").length > 0) {
    const regular = board.queued.filter((t) => t.source !== "bot-escalation");
    msg += `📥 <b>Queued (${regular.length})</b>\n`;
    for (const t of regular.slice(0, 5)) {
      msg += `  • ${t.title}\n`;
    }
    msg += `\n`;
  }

  // Active tasks — collect stoppable tasks for keyboard
  const stoppableTasks: { id: string; title: string }[] = [];

  if (board.inProgress.length > 0) {
    msg += `🔄 <b>Active (${board.inProgress.length})</b>\n`;
    for (const t of board.inProgress.slice(0, 5)) {
      const statLine = Object.entries(t.stats)
        .slice(0, 3)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      const kindTag =
        t.kind === "recurring" ? " 🔁" : t.kind === "persistent" ? " ♾️" : "";
      msg += `  • ${t.title}${kindTag}${statLine ? ` (${statLine})` : ""}\n`;

      // Recurring and persistent tasks can be stopped
      if (t.kind === "recurring" || t.kind === "persistent") {
        stoppableTasks.push({
          id: t.id,
          title: t.title.substring(0, 25),
        });
      }
    }
    msg += `\n`;
  }

  if (board.done.length > 0) {
    msg += `✅ <b>Done (${board.done.length})</b>\n`;
    for (const t of board.done.slice(0, 3)) {
      msg += `  • ${t.title}\n`;
    }
    msg += `\n`;
  }

  if (board.failed.length > 0) {
    msg += `❌ <b>Failed (${board.failed.length})</b>\n`;
    for (const t of board.failed.slice(0, 3)) {
      const reason =
        t.approval?.decision === "rejected"
          ? " (rejected)"
          : t.logs.length > 0
            ? ` (${t.logs[t.logs.length - 1].message.substring(0, 40)})`
            : "";
      msg += `  • ${t.title}${reason}\n`;
    }
    msg += `\n`;
  }

  if (board.totalTasks === 0) {
    msg += `<i>No tasks yet. Try "write a post about AI" or "start moderating".</i>\n`;
  }

  // Build keyboard with stop buttons for active recurring/persistent tasks
  let keyboard: InlineKeyboard | null = null;
  if (stoppableTasks.length > 0) {
    keyboard = new InlineKeyboard();
    for (const t of stoppableTasks.slice(0, 5)) {
      keyboard.text(`⏹️ Stop: ${t.title}`, `kb:stop:${t.id}`).row();
    }
  }

  return { text: msg, keyboard };
}

/**
 * Format analytics/stats for display.
 */
async function formatStatsMessage(env: Env): Promise<string> {
  const stats = await getAggregateStats(env.SESSIONS);

  let msg = `📊 <b>Bot Analytics</b>\n\n`;
  msg += `Total tasks: ${stats.totalTasks}\n`;
  msg += `Active: ${stats.activeTaskCount}\n`;
  msg += `Queued: ${stats.queuedCount}\n`;
  msg += `Awaiting approval: ${stats.awaitingApprovalCount}\n`;
  msg += `Escalations: ${stats.escalationCount}\n`;
  msg += `Completed: ${stats.doneCount}\n`;
  msg += `Failed: ${stats.failedCount}\n`;

  if (Object.keys(stats.statsSummary).length > 0) {
    msg += `\n<b>Cumulative Stats:</b>\n`;
    for (const [key, value] of Object.entries(stats.statsSummary)) {
      msg += `  ${key}: ${value}\n`;
    }
  }

  return msg;
}

// ─── Callback Handlers ─────────────────────────────────────────────

/**
 * Register task-related callback query handlers on the bot.
 */
export function setupTaskHandlers(
  bot: Bot,
  env: Env,
  logRef: { current?: TelegramLog },
): void {
  // ── /tasks or /board — show kanban board ──
  // (owner-gate middleware blocks non-owners before reaching here)
  bot.command(["tasks", "board"], async (ctx) => {
    const { text, keyboard } = await formatBoardMessage(env);
    await ctx.reply(text, {
      parse_mode: "HTML",
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  });

  // ── /stats — analytics ──
  bot.command("stats", async (ctx) => {
    const msg = await formatStatsMessage(env);
    await ctx.reply(msg, { parse_mode: "HTML" });
  });

  // ── Callback queries ──
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;

    // Handle new kanban-based callbacks (kb:*)
    if (data.startsWith("kb:")) {
      const tgLog = logRef.current;
      tgLog?.header(`Kanban callback: ${data}`);

      try {
        await handleKanbanCallback(ctx, env, data, tgLog);
      } catch (error) {
        log.error("Kanban callback error", error);
        tgLog?.error(`Kanban callback failed: ${formatError(error)}`);
        await ctx.answerCallbackQuery({ text: "❌ Error" });
      }
      return;
    }

    // Handle legacy task callbacks (task:*)
    if (data.startsWith("task:")) {
      const tgLog = logRef.current;
      tgLog?.header(`Task callback: ${data}`);

      try {
        await handleLegacyTaskCallback(ctx, env, data, tgLog);
      } catch (error) {
        log.error("Task callback error", error);
        tgLog?.error(`Task callback failed: ${formatError(error)}`);
        await ctx.answerCallbackQuery({ text: "❌ Error" });
      }
    }
  });
}

// ─── Kanban Callback Handlers ──────────────────────────────────────

async function handleKanbanCallback(
  ctx: Context,
  env: Env,
  data: string,
  tgLog?: TelegramLog,
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId || !(await isOwner(env, userId))) {
    await ctx.answerCallbackQuery({ text: "⚠️ Owner only" });
    return;
  }

  const chatId = ctx.chat?.id;
  if (!chatId) {
    await ctx.answerCallbackQuery({ text: "❌ No chat context" });
    return;
  }

  // ── Approve & publish: kb:approve:{taskId}:ch:{chatId} or kb:approve:{taskId}:gr:{chatId} ──
  if (data.startsWith("kb:approve:")) {
    const parts = data.split(":");
    const taskId = parts[2];
    const targetType = parts[3]; // "ch" or "gr"
    const targetIdx = parseInt(parts[4], 10); // chatId (negative) or legacy index

    const task = await getTask(env.SESSIONS, taskId);
    if (!task?.approval?.content) {
      await ctx.answerCallbackQuery({ text: "Task not found" });
      return;
    }

    // Guard: prevent double-publish from concurrent control planes
    if (task.status !== "awaiting-approval") {
      await ctx.answerCallbackQuery({
        text: `Task already ${task.status}`,
      });
      return;
    }

    const target = await resolveTarget(env.SESSIONS, targetType, targetIdx);
    if (!target) {
      await ctx.answerCallbackQuery({ text: "Target not found" });
      return;
    }

    const content = task.approval.editedContent || task.approval.content;

    tgLog?.step(`Approving task ${taskId} → publish to ${target.title}`);

    try {
      // Publish — parse as multiformat ContentBlock, fallback to plain text
      const contentBlock = parseContentBlock(content);
      const api = getTelegramApi(env.TELEGRAM_BOT_TOKEN);
      const messageId = await publishContent(
        api,
        target.chatId,
        contentBlock,
        env.AI,
      );

      const postLink = buildPostLink(target.chatId, messageId, target.username);

      // Update kanban task: directly mark as done (skip transient "queued" state)
      await updateTask(env.SESSIONS, taskId, {
        status: "done",
        approval: {
          ...task.approval,
          respondedAt: new Date().toISOString(),
          decision: "approved",
          targetChatId: target.chatId,
          targetChatTitle: target.title,
        },
      });
      await recordTaskRun(env.SESSIONS, taskId);
      await addTaskLog(
        env.SESSIONS,
        taskId,
        `Published to ${target.title}`,
        "post",
      );

      // Update content task stats if exists
      try {
        const contentTask = await findActiveTask(
          env.SESSIONS,
          target.chatId,
          "content",
        );
        if (contentTask) {
          await incrementTaskStat(
            env.SESSIONS,
            contentTask.id,
            "postsPublished",
          );
        }
      } catch {
        /* non-critical */
      }

      await ctx.editMessageText(
        `✅ <b>Published to ${escapeHtml(target.title)}!</b>\n\n` +
          `${escapeHtml(content)}\n\n` +
          `🔗 <a href="${postLink}">View post</a>`,
        { parse_mode: "HTML" },
      );
      await ctx.answerCallbackQuery({ text: "✅ Published!" });
      tgLog?.ok(`Task ${taskId} approved and published`);
    } catch (error) {
      tgLog?.error(`Publish failed: ${formatError(error)}`);
      await ctx.answerCallbackQuery({
        text: `❌ Error: ${formatError(error)}`,
      });
    }
    return;
  }

  // ── Rewrite: kb:rewrite:{taskId} ──
  if (data.startsWith("kb:rewrite:")) {
    const taskId = data.split(":")[2];
    const task = await getTask(env.SESSIONS, taskId);
    if (!task?.approval) {
      await ctx.answerCallbackQuery({ text: "Task not found" });
      return;
    }

    // Guard: only rewrite tasks still awaiting approval
    if (task.status !== "awaiting-approval") {
      await ctx.answerCallbackQuery({ text: `Task already ${task.status}` });
      return;
    }

    await ctx.answerCallbackQuery({ text: "Regenerating..." });
    await ctx.api.sendChatAction(chatId, "typing");

    tgLog?.step(`Rewriting task ${taskId}`);

    // Use dedicated topic field; fall back to parsing description for old tasks
    const topic =
      task.approval.topic ||
      task.description.replace(/^Generate and publish a post about:\s*/i, "");
    const { url: agentUrl, sessionId } = await getCurrentAgentInfo(
      env,
      chatId.toString(),
    );

    const useServiceBinding = !!env.AGENT_SERVICE && agentUrl === env.AGENT_URL;
    const hasAgent = !!agentUrl || useServiceBinding;
    const rewriteKb = await getKnowledgeBasePrompt(env.SESSIONS);
    const { cleanTopic: rewriteTopic, format: rewriteFormat } =
      parseFormatHints(topic);
    const rewriteImagesEnabled =
      (await env.SESSIONS?.get("setting:image_with_posts")) !== "false";
    const rewriteBasePrompt = getPromptForFormat(
      rewriteFormat,
      !!env.AI,
      rewriteImagesEnabled,
    );
    const rewriteMessages = [
      {
        role: "system" as const,
        content:
          rewriteBasePrompt +
          rewriteTopic +
          rewriteKb +
          "\n\nWrite a DIFFERENT version than before. Be creative.",
      },
      {
        role: "user" as const,
        content: `Rewrite the post about: ${rewriteTopic}`,
      },
    ];

    let content: string | null = null;

    if (hasAgent) {
      try {
        content = await sendAgentMessage(
          agentUrl,
          sessionId,
          rewriteMessages,
          useServiceBinding ? env.AGENT_SERVICE : undefined,
          tgLog,
        );
      } catch (agentError) {
        tgLog?.warn(`Agent rewrite failed: ${formatError(agentError)}`);
      }
    }

    // Fallback to Workers AI
    if ((!content || !content.trim()) && env.AI) {
      try {
        tgLog?.thought(`Rewriting via Workers AI (70B)...`);
        const result = (await env.AI.run(
          "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as keyof AiModels,
          { messages: rewriteMessages } as any,
        )) as { response?: string };
        content = result.response ?? null;
      } catch {
        // already logged
      }
    }

    if (!content || content.trim().length === 0) {
      await ctx.editMessageText("❌ Failed to regenerate. Please try again.");
      return;
    }

    // Update task with new content
    await updateTaskApprovalContent(env.SESSIONS, taskId, content.trim());

    // Rebuild keyboard
    const rewriteChannels = await getBotChannels(env.SESSIONS);
    const rewriteGroups = await getBotGroups(env.SESSIONS);

    const keyboard = buildPostApprovalKeyboard(
      taskId,
      rewriteChannels,
      rewriteGroups,
    );

    await ctx.editMessageText(
      `📋 <b>New version (awaiting approval)</b>\n\n${escapeHtml(content.trim())}\n\n─────────────────\n✅ Approve & publish to a target:`,
      { parse_mode: "HTML", reply_markup: keyboard },
    );

    tgLog?.ok(`Task ${taskId} rewritten: ${content.length} chars`);
    return;
  }

  // ── Confirm reject: kb:confirmreject:{taskId} — ask "are you sure?" ──
  if (data.startsWith("kb:confirmreject:")) {
    const taskId = data.split(":")[2];
    const task = await getTask(env.SESSIONS, taskId);
    if (!task) {
      await ctx.answerCallbackQuery({ text: "Task not found" });
      return;
    }

    // Guard: check task is still in a rejectable state
    if (task.status !== "awaiting-approval" && task.status !== "queued") {
      await ctx.answerCallbackQuery({ text: `Task already ${task.status}` });
      return;
    }

    await ctx.answerCallbackQuery();
    const keyboard = new InlineKeyboard()
      .text("Yes, reject", `kb:reject:${taskId}`)
      .text("Cancel", `kb:back:${taskId}`);
    await ctx.editMessageText(
      `<b>Reject this task?</b>\n\n` +
        `"${escapeHtml(task.title)}"\n\n` +
        `This cannot be undone.`,
      { parse_mode: "HTML", reply_markup: keyboard },
    );
    return;
  }

  // ── Reject (confirmed): kb:reject:{taskId} ──
  if (data.startsWith("kb:reject:")) {
    const taskId = data.split(":")[2];
    const task = await getTask(env.SESSIONS, taskId);

    // Guard: check task is still in a rejectable state
    if (
      task &&
      task.status !== "awaiting-approval" &&
      task.status !== "queued"
    ) {
      await ctx.answerCallbackQuery({ text: `Task already ${task.status}` });
      return;
    }

    await rejectTask(env.SESSIONS, taskId);
    await ctx.editMessageText("Task rejected.");
    await ctx.answerCallbackQuery({ text: "Rejected" });
    tgLog?.ok(`Task ${taskId} rejected`);
    return;
  }

  // ── Resolve escalation: kb:resolve:{taskId} ──
  if (data.startsWith("kb:resolve:")) {
    const taskId = data.split(":")[2];
    await moveTask(env.SESSIONS, taskId, "done");
    await ctx.editMessageText("✅ Escalation resolved.");
    await ctx.answerCallbackQuery({ text: "Resolved" });
    tgLog?.ok(`Escalation ${taskId} resolved`);
    return;
  }

  // ── Dismiss escalation: kb:dismiss:{taskId} ──
  if (data.startsWith("kb:dismiss:")) {
    const taskId = data.split(":")[2];
    await deleteTask(env.SESSIONS, taskId);
    await ctx.editMessageText("🗑️ Escalation dismissed.");
    await ctx.answerCallbackQuery({ text: "Dismissed" });
    tgLog?.ok(`Escalation ${taskId} dismissed`);
    return;
  }

  // ── Schedule: kb:schedule:{taskId} — show time presets ──
  if (data.startsWith("kb:schedule:")) {
    const taskId = data.split(":")[2];
    const task = await getTask(env.SESSIONS, taskId);
    if (!task?.approval) {
      await ctx.answerCallbackQuery({ text: "Task not found" });
      return;
    }

    await ctx.answerCallbackQuery();

    // Show target selection first, then time
    const channels = await getBotChannels(env.SESSIONS);
    const groups = await getBotGroups(env.SESSIONS);

    const keyboard = new InlineKeyboard();

    // Target selection — stable chatId
    for (const ch of channels.slice(0, 4)) {
      keyboard.text(
        ch.title || ch.username || `Channel`,
        `kb:schedtarget:${taskId}:ch:${ch.chatId}`,
      );
    }
    if (channels.length > 0) keyboard.row();
    for (const gr of groups.slice(0, 4)) {
      keyboard.text(gr.title, `kb:schedtarget:${taskId}:gr:${gr.chatId}`);
    }
    if (groups.length > 0) keyboard.row();
    keyboard.text("Back", `kb:back:${taskId}`);

    const content = task.approval.editedContent || task.approval.content || "";
    await ctx.editMessageText(
      `<b>Schedule Post</b>\n\n` +
        `<i>${escapeHtml(content.substring(0, 150))}${content.length > 150 ? "..." : ""}</i>\n\n` +
        `Step 1: Select where to publish:`,
      { parse_mode: "HTML", reply_markup: keyboard },
    );
    return;
  }

  // ── Schedule target selected: kb:schedtarget:{taskId}:{type}:{chatId} ──
  if (data.startsWith("kb:schedtarget:")) {
    const parts = data.split(":");
    const taskId = parts[2];
    const targetType = parts[3];
    const targetIdx = parseInt(parts[4], 10);

    const task = await getTask(env.SESSIONS, taskId);
    if (!task?.approval) {
      await ctx.answerCallbackQuery({ text: "Task not found" });
      return;
    }

    const target = await resolveTarget(env.SESSIONS, targetType, targetIdx);
    if (!target) {
      await ctx.answerCallbackQuery({ text: "Target not found" });
      return;
    }

    // Save target to the task approval
    await updateTask(env.SESSIONS, taskId, {
      approval: {
        ...task.approval,
        targetChatId: target.chatId,
        targetChatTitle: target.title,
      },
    });

    await ctx.answerCallbackQuery();

    // Show time presets
    const keyboard = new InlineKeyboard()
      .text("⏱️ 10 min", `kb:schedtime:${taskId}:10m`)
      .text("⏱️ 30 min", `kb:schedtime:${taskId}:30m`)
      .text("⏱️ 1h", `kb:schedtime:${taskId}:1h`)
      .row()
      .text("⏱️ 3h", `kb:schedtime:${taskId}:3h`)
      .text("⏱️ 6h", `kb:schedtime:${taskId}:6h`)
      .text("⏱️ 12h", `kb:schedtime:${taskId}:12h`)
      .row()
      .text("📅 Tomorrow 10:00", `kb:schedtime:${taskId}:tomorrow`)
      .row()
      .text("« Back", `kb:back:${taskId}`);

    await ctx.editMessageText(
      `⏰ <b>Schedule Post</b>\n\n` +
        `📍 Target: <b>${escapeHtml(target.title)}</b>\n\n` +
        `Step 2: When to publish?`,
      { parse_mode: "HTML", reply_markup: keyboard },
    );
    return;
  }

  // ── Schedule time selected: kb:schedtime:{taskId}:{delay} ──
  if (data.startsWith("kb:schedtime:")) {
    const parts = data.split(":");
    const taskId = parts[2];
    const delay = parts[3];

    const task = await getTask(env.SESSIONS, taskId);
    if (!task?.approval) {
      await ctx.answerCallbackQuery({ text: "Task not found" });
      return;
    }

    const now = Date.now();
    let scheduledAt: number;
    let label: string;

    switch (delay) {
      case "10m":
        scheduledAt = now + 10 * 60 * 1000;
        label = "10 minutes";
        break;
      case "30m":
        scheduledAt = now + 30 * 60 * 1000;
        label = "30 minutes";
        break;
      case "1h":
        scheduledAt = now + 60 * 60 * 1000;
        label = "1 hour";
        break;
      case "3h":
        scheduledAt = now + 3 * 60 * 60 * 1000;
        label = "3 hours";
        break;
      case "6h":
        scheduledAt = now + 6 * 60 * 60 * 1000;
        label = "6 hours";
        break;
      case "12h":
        scheduledAt = now + 12 * 60 * 60 * 1000;
        label = "12 hours";
        break;
      case "tomorrow":
        {
          const tmr = new Date();
          tmr.setUTCDate(tmr.getUTCDate() + 1);
          tmr.setUTCHours(10, 0, 0, 0);
          scheduledAt = tmr.getTime();
          label = "tomorrow at 10:00 UTC";
        }
        break;
      default:
        await ctx.answerCallbackQuery({ text: "Invalid time" });
        return;
    }

    // Update task with schedule and move to queued
    await updateTask(env.SESSIONS, taskId, {
      status: "queued",
      schedule: {
        runAt: new Date(scheduledAt).toISOString(),
      },
      approval: {
        ...task.approval,
        respondedAt: new Date().toISOString(),
        decision: "approved",
      },
    });

    const targetTitle = task.approval.targetChatTitle || "target";
    const content = task.approval.editedContent || task.approval.content || "";

    await ctx.answerCallbackQuery({ text: `✅ Scheduled!` });
    await ctx.editMessageText(
      `✅ <b>Post scheduled!</b>\n\n` +
        `📍 ${escapeHtml(targetTitle)}\n` +
        `⏰ In ${label}\n` +
        `🕐 ${new Date(scheduledAt).toUTCString()}\n\n` +
        `<i>${escapeHtml(content.substring(0, 200))}${content.length > 200 ? "..." : ""}</i>`,
      { parse_mode: "HTML" },
    );
    tgLog?.ok(`Task ${taskId} scheduled for ${label} to ${targetTitle}`);
    return;
  }

  // ── Recurring: kb:recurring:{taskId} — show frequency options ──
  if (data.startsWith("kb:recurring:")) {
    const taskId = data.split(":")[2];
    const task = await getTask(env.SESSIONS, taskId);
    if (!task?.approval) {
      await ctx.answerCallbackQuery({ text: "Task not found" });
      return;
    }

    await ctx.answerCallbackQuery();

    // Target selection first
    const channels = await getBotChannels(env.SESSIONS);
    const groups = await getBotGroups(env.SESSIONS);

    const keyboard = new InlineKeyboard();
    for (const ch of channels.slice(0, 4)) {
      keyboard.text(
        ch.title || ch.username || `Channel`,
        `kb:recurtarget:${taskId}:ch:${ch.chatId}`,
      );
    }
    if (channels.length > 0) keyboard.row();
    for (const gr of groups.slice(0, 4)) {
      keyboard.text(gr.title, `kb:recurtarget:${taskId}:gr:${gr.chatId}`);
    }
    if (groups.length > 0) keyboard.row();
    keyboard.text("Back", `kb:back:${taskId}`);

    const content = task.approval.editedContent || task.approval.content || "";
    await ctx.editMessageText(
      `<b>Recurring Post</b>\n\n` +
        `<i>${escapeHtml(content.substring(0, 150))}${content.length > 150 ? "..." : ""}</i>\n\n` +
        `Step 1: Select where to publish:`,
      { parse_mode: "HTML", reply_markup: keyboard },
    );
    return;
  }

  // ── Recurring target: kb:recurtarget:{taskId}:{type}:{chatId} ──
  if (data.startsWith("kb:recurtarget:")) {
    const parts = data.split(":");
    const taskId = parts[2];
    const targetType = parts[3];
    const targetIdx = parseInt(parts[4], 10);

    const task = await getTask(env.SESSIONS, taskId);
    if (!task?.approval) {
      await ctx.answerCallbackQuery({ text: "Task not found" });
      return;
    }

    const target = await resolveTarget(env.SESSIONS, targetType, targetIdx);
    if (!target) {
      await ctx.answerCallbackQuery({ text: "Target not found" });
      return;
    }

    // Save target
    await updateTask(env.SESSIONS, taskId, {
      approval: {
        ...task.approval,
        targetChatId: target.chatId,
        targetChatTitle: target.title,
      },
    });

    await ctx.answerCallbackQuery();

    // Show frequency presets
    const keyboard = new InlineKeyboard()
      .text("🕐 Every 6h", `kb:recurfreq:${taskId}:6h`)
      .text("📅 Daily 10:00", `kb:recurfreq:${taskId}:daily`)
      .row()
      .text("📅 2x/week", `kb:recurfreq:${taskId}:2xweek`)
      .text("📅 Weekly", `kb:recurfreq:${taskId}:weekly`)
      .row()
      .text("« Back", `kb:back:${taskId}`);

    await ctx.editMessageText(
      `🔁 <b>Recurring Post</b>\n\n` +
        `📍 Target: <b>${escapeHtml(target.title)}</b>\n\n` +
        `Step 2: How often?\n\n` +
        `<i>The bot will generate a fresh post on this topic each time.</i>`,
      { parse_mode: "HTML", reply_markup: keyboard },
    );
    return;
  }

  // ── Recurring frequency: kb:recurfreq:{taskId}:{freq} ──
  if (data.startsWith("kb:recurfreq:")) {
    const parts = data.split(":");
    const taskId = parts[2];
    const freq = parts[3];

    const task = await getTask(env.SESSIONS, taskId);
    if (!task?.approval) {
      await ctx.answerCallbackQuery({ text: "Task not found" });
      return;
    }

    let cron: string;
    let label: string;

    switch (freq) {
      case "6h":
        cron = "0 */6 * * *";
        label = "Every 6 hours";
        break;
      case "daily":
        cron = "0 10 * * *";
        label = "Daily at 10:00 UTC";
        break;
      case "2xweek":
        cron = "0 10 * * 1,4";
        label = "Monday & Thursday at 10:00 UTC";
        break;
      case "weekly":
        cron = "0 10 * * 1";
        label = "Every Monday at 10:00 UTC";
        break;
      default:
        await ctx.answerCallbackQuery({ text: "Invalid frequency" });
        return;
    }

    // Convert task to recurring
    await updateTask(env.SESSIONS, taskId, {
      kind: "recurring",
      status: "in-progress",
      schedule: { cron },
      approval: {
        ...task.approval,
        respondedAt: new Date().toISOString(),
        decision: "approved",
      },
    });

    const targetTitle = task.approval.targetChatTitle || "target";
    const content = task.approval.editedContent || task.approval.content || "";

    await ctx.answerCallbackQuery({ text: "✅ Recurring task created!" });
    await ctx.editMessageText(
      `🔁 <b>Recurring post created!</b>\n\n` +
        `📍 ${escapeHtml(targetTitle)}\n` +
        `⏰ ${label}\n` +
        `📝 Topic: <i>${escapeHtml(task.description.replace(/^Generate and publish a post about: /, "").substring(0, 100))}</i>\n\n` +
        `<i>The bot will generate and post fresh content each time.\nUse /tasks to manage.</i>`,
      { parse_mode: "HTML" },
    );
    tgLog?.ok(`Task ${taskId} → recurring (${cron}) to ${targetTitle}`);
    return;
  }

  // ── Back to post preview: kb:back:{taskId} ──
  if (data.startsWith("kb:back:")) {
    const taskId = data.split(":")[2];
    const task = await getTask(env.SESSIONS, taskId);
    if (!task?.approval) {
      await ctx.answerCallbackQuery({ text: "Task not found" });
      return;
    }

    await ctx.answerCallbackQuery();

    const channels = await getBotChannels(env.SESSIONS);
    const groups = await getBotGroups(env.SESSIONS);
    const content = task.approval.editedContent || task.approval.content || "";

    const keyboard = buildPostApprovalKeyboard(taskId, channels, groups);

    await ctx.editMessageText(
      `📋 <b>Task → Awaiting approval</b>\n\n` +
        `${escapeHtml(content.trim())}\n\n` +
        `─────────────────\n` +
        `Choose an action:`,
      { parse_mode: "HTML", reply_markup: keyboard },
    );
    return;
  }

  // ── Stop recurring/persistent task: kb:stop:{taskId} ──
  if (data.startsWith("kb:stop:")) {
    const taskId = data.split(":")[2];
    const task = await getTask(env.SESSIONS, taskId);
    if (!task) {
      await ctx.answerCallbackQuery({ text: "Task not found" });
      return;
    }

    await updateTask(env.SESSIONS, taskId, { status: "done" });
    await addTaskLog(env.SESSIONS, taskId, "Stopped by owner", "lifecycle");

    await ctx.answerCallbackQuery({ text: "⏹️ Task stopped" });

    // Refresh the board
    const { text, keyboard } = await formatBoardMessage(env);
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });

    tgLog?.ok(`Task ${taskId} (${task.kind}) stopped by owner`);
    return;
  }

  // ── Fallback: unknown kb:* callback ──
  await ctx.answerCallbackQuery({ text: "Unknown action" });
}

// Helper to update approval content in a task
async function updateTaskApprovalContent(
  kv: KVNamespace,
  taskId: string,
  newContent: string,
): Promise<void> {
  const task = await getTask(kv, taskId);
  if (!task?.approval) return;

  await updateTask(kv, taskId, {
    approval: { ...task.approval, content: newContent },
  });
}

// ─── Legacy Task Callbacks (backwards-compat) ──────────────────────

async function handleLegacyTaskCallback(
  ctx: Context,
  env: Env,
  data: string,
  tgLog?: TelegramLog,
): Promise<void> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (!chatId || !userId) {
    await ctx.answerCallbackQuery({ text: "❌ No context" });
    return;
  }

  // Owner check
  if (!(await isOwner(env, userId))) {
    await ctx.answerCallbackQuery({ text: "⚠️ Owner only" });
    return;
  }

  // ── Cancel ──
  if (data === "task:cancel") {
    await ctx.editMessageText("❌ Cancelled.");
    await ctx.answerCallbackQuery({ text: "Cancelled" });
    tgLog?.ok("Task cancelled");
    return;
  }

  // ── Moderate or engage toggle from callback (task:mod:* or task:eng:*) ──
  if (data.startsWith("task:mod:") || data.startsWith("task:eng:")) {
    const parts = data.split(":");
    const config = parts[1] === "mod" ? MODERATION_TOGGLE : ENGAGE_TOGGLE;
    const enable = parts[2] === "on";
    const targetChatId = parseInt(parts[3], 10);

    const managedChats = await getUserManagedChats(env.SESSIONS, userId);
    const chat = managedChats.find((c) => c.chatId === targetChatId);

    if (!chat) {
      await ctx.answerCallbackQuery({ text: "Group not found" });
      return;
    }

    try {
      await config.apply(env, targetChatId, chat.chatTitle, userId, enable);
      await ctx.editMessageText(config.successText(chat.chatTitle, enable), {
        parse_mode: "HTML",
      });
      await ctx.answerCallbackQuery({
        text: enable ? `${config.enabledIcon} Enabled` : "🔕 Disabled",
      });
      tgLog?.ok(
        `${config.label} ${enable ? "enabled" : "disabled"} for ${chat.chatTitle}`,
      );
    } catch (error) {
      tgLog?.error(
        `${config.label} callback toggle failed: ${formatError(error)}`,
      );
      await ctx.answerCallbackQuery({ text: `❌ ${formatError(error)}` });
    }
    return;
  }

  // ── Fallback: unknown task:* callback ──
  await ctx.answerCallbackQuery({ text: "Unknown action" });
}

// escapeHtml, buildPostLink, formatError, resolveTarget → imported from ../utils/helpers
