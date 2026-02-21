/**
 * Channel Handler - Social Media Manager commands
 *
 * Commands:
 * - /addchannel @channel - Add a channel to manage
 * - /channels - List managed channels
 * - /removechannel - Remove a channel
 * - /post - Post to a channel
 * - /generate - Generate post with AI
 */

import { Bot, Context, InlineKeyboard } from "grammy";
import {
  type BotChat,
  getPostableBotChats,
  upsertBotChat,
  removeBotChat,
  removeStaleBotChat,
} from "../utils/bot-chats-storage";
import { escapeHtml, buildPostLink, formatError } from "../utils/helpers";
import {
  parseFormatHints,
  getPromptForFormat,
} from "../utils/prompts";
import { parseContentBlock } from "../types/content";
import { publishContent } from "../utils/content-publisher";
import { loggers } from "../utils/logger";
import { sendAgentMessage } from "../utils/agent-client";
import { getKnowledgeBasePrompt } from "../utils/knowledge-base";
import {
  getPendingPost,
  setPendingPost,
  clearPendingPost,
  getPendingGeneration,
  setPendingGeneration,
  clearPendingGeneration,
  type PendingGenerationTarget,
} from "../utils/pending-state";
import type { TelegramBotEnv } from "../types/env";

const log = loggers.channel;

/** Result of posting to a channel */
interface PostResult {
  success: boolean;
  messageId?: number;
  error?: string;
}

/** Info returned from channel access verification */
interface ChannelInfo {
  chatId: number;
  title: string;
  type: string;
  username?: string;
  canPost: boolean;
}

type Env = TelegramBotEnv;

/**
 * Setup channel management handlers
 *
 * Channels are auto-tracked via `my_chat_member` updates (bot-chats-storage).
 * `/addchannel` does a manual verify + upsert for channels the bot missed.
 */
export function setupChannelHandlers(bot: Bot, env: Env): void {
  // /addchannel command — verify bot access and register in bot-chats
  bot.command("addchannel", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const args = ctx.message?.text?.split(" ").slice(1).join(" ").trim();

    if (!args) {
      await ctx.reply(
        "📢 <b>Add Channel</b>\n\n" +
          "Usage: <code>/addchannel @channel_username</code>\n\n" +
          "<i>Tip: Channels are usually detected automatically when you add " +
          "the bot as admin. Use this command only if auto-detection missed it.</i>",
        { parse_mode: "HTML" },
      );
      return;
    }

    const channelId = args.startsWith("@") ? args : `@${args}`;

    await ctx.reply(`🔍 Checking channel ${channelId}...`);

    try {
      const info = await verifyChannelAccess(ctx, channelId);

      if (!info) {
        await ctx.reply(
          `❌ Cannot access channel ${channelId}\n\n` +
            "Make sure:\n" +
            "1. The channel exists\n" +
            "2. Bot is added as admin\n" +
            "3. Bot has 'Post Messages' permission",
        );
        return;
      }

      // Upsert into bot-chats (unified storage)
      const chat: BotChat = {
        chatId: info.chatId,
        title: info.title,
        type: (info.type as BotChat["type"]) || "channel",
        username: info.username,
        role: info.canPost ? "administrator" : "member",
        canPost: info.canPost,
        addedBy: userId,
        updatedAt: Date.now(),
      };

      await upsertBotChat(env.SESSIONS, chat);

      await ctx.reply(
        `✅ <b>Channel registered!</b>\n\n` +
          `📢 ${chat.title}\n` +
          `🆔 ${channelId}\n` +
          `📝 Can post: ${chat.canPost ? "Yes ✅" : "No ❌"}\n\n` +
          `Use /post to publish content.`,
        { parse_mode: "HTML" },
      );
    } catch (error) {
      log.error("Error adding channel", error);
      await ctx.reply(`❌ Error adding channel: ${formatError(error)}`);
    }
  });

  // /channels command - list all postable chats (auto-tracked)
  bot.command("channels", async (ctx) => {
    const chats = await getPostableBotChats(env.SESSIONS);

    if (chats.length === 0) {
      await ctx.reply(
        "📢 <b>No channels or groups yet</b>\n\n" +
          "Add the bot as admin to a channel or group — it will appear here " +
          "automatically.\n\n" +
          "Or use /addchannel @channel to register manually.",
        { parse_mode: "HTML" },
      );
      return;
    }

    let message = "📢 <b>Postable Chats</b>\n\n";

    for (const chat of chats) {
      const icon = chat.type === "channel" ? "📢" : "💬";
      const roleTag = chat.role === "administrator" ? "admin" : chat.role;
      message += `${icon} <b>${chat.title}</b>\n`;
      message += `   Type: ${chat.type} · Role: ${roleTag}\n`;
      if (chat.username) {
        message += `   @${chat.username}\n`;
      }
      message += "\n";
    }

    message += `Total: ${chats.length} chat(s)\n`;
    message += `\nUse /post to publish or /removechannel to remove.`;

    await ctx.reply(message, { parse_mode: "HTML" });
  });

  // /removechannel command
  bot.command("removechannel", async (ctx) => {
    const chats = await getPostableBotChats(env.SESSIONS);

    if (chats.length === 0) {
      await ctx.reply("📢 No channels to remove.");
      return;
    }

    const keyboard = new InlineKeyboard();

    for (const chat of chats) {
      const icon = chat.type === "channel" ? "📢" : "💬";
      keyboard
        .text(`🗑️ ${icon} ${chat.title}`, `remove_channel:${chat.chatId}`)
        .row();
    }

    keyboard.text("❌ Cancel", "remove_channel:cancel");

    await ctx.reply("Select a channel to remove:", {
      reply_markup: keyboard,
    });
  });

  // Handle remove channel callback
  bot.callbackQuery(/^remove_channel:(.+)$/, async (ctx) => {
    const match = ctx.match[1];

    if (match === "cancel") {
      await ctx.answerCallbackQuery("Cancelled");
      await ctx.deleteMessage();
      return;
    }

    const chatId = parseInt(match, 10);
    await removeBotChat(env.SESSIONS, chatId);

    await ctx.answerCallbackQuery("Channel removed!");
    await ctx.editMessageText(`✅ Channel removed.`);
  });

  // /post command
  bot.command("post", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const chats = await getPostableBotChats(env.SESSIONS);

    if (chats.length === 0) {
      await ctx.reply(
        "📢 No postable channels or groups yet.\n\n" +
          "Add the bot as admin to a channel/group, or use /addchannel.",
      );
      return;
    }

    const args = ctx.message?.text?.split(" ").slice(1).join(" ").trim();

    if (args && chats.length === 1) {
      await postToChat(ctx, env, chats[0], args);
      return;
    }

    if (args) {
      await setPendingPost(env.SESSIONS, userId, { channelId: "", text: args });
    }

    const keyboard = new InlineKeyboard();

    for (const chat of chats) {
      const icon = chat.type === "channel" ? "📢" : "💬";
      keyboard.text(`${icon} ${chat.title}`, `post_to:${chat.chatId}`).row();
    }

    keyboard.text("❌ Cancel", "post_to:cancel");

    const message = args
      ? `📝 <b>Select channel to post:</b>\n\n<i>"${args.substring(0, 100)}${args.length > 100 ? "..." : ""}"</i>`
      : "📢 <b>Select channel to post to:</b>\n\n<i>After selecting, send the text you want to post.</i>";

    await ctx.reply(message, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  });

  // Handle post channel selection
  bot.callbackQuery(/^post_to:(.+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const match = ctx.match[1];

    if (match === "cancel") {
      await clearPendingPost(env.SESSIONS, userId);
      await ctx.answerCallbackQuery("Cancelled");
      await ctx.deleteMessage();
      return;
    }

    const chatId = parseInt(match, 10);
    const chats = await getPostableBotChats(env.SESSIONS);
    const chat = chats.find((c) => c.chatId === chatId);

    if (!chat) {
      await ctx.answerCallbackQuery("Channel not found");
      return;
    }

    const pending = await getPendingPost(env.SESSIONS, userId);

    if (pending?.text) {
      await ctx.answerCallbackQuery("Posting...");
      await ctx.deleteMessage();
      await postToChat(ctx, env, chat, pending.text);
      await clearPendingPost(env.SESSIONS, userId);
    } else {
      await setPendingPost(env.SESSIONS, userId, {
        channelId: String(chat.chatId),
      });
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        `📢 <b>Posting to: ${chat.title}</b>\n\n` +
          `Now send me the text you want to post.\n\n` +
          `<i>Or send /cancel to cancel.</i>`,
        { parse_mode: "HTML" },
      );
    }
  });

  // Handle incoming text for pending posts (DM only — skip groups to avoid extra KV reads)
  bot.on("message:text", async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();
    if (ctx.chat?.type !== "private") return next();

    const pending = await getPendingPost(env.SESSIONS, userId);
    if (!pending?.channelId) return next();

    const text = ctx.message.text;

    if (text === "/cancel") {
      await clearPendingPost(env.SESSIONS, userId);
      await ctx.reply("❌ Post cancelled.");
      return;
    }

    if (text.startsWith("/")) return next();

    const chatId = parseInt(pending.channelId, 10);
    const chats = await getPostableBotChats(env.SESSIONS);
    const chat = chats.find((c) => c.chatId === chatId);

    if (!chat) {
      await clearPendingPost(env.SESSIONS, userId);
      await ctx.reply("❌ Channel not found. Please try /post again.");
      return;
    }

    await postToChat(ctx, env, chat, text);
    await clearPendingPost(env.SESSIONS, userId);
  });

  // ============ AI Generation Commands ============

  /**
   * /generate [topic]  — multi-target post generator
   * /quickpost [topic]  — alias
   *
   * Flow:
   * - 1 channel + topic  → auto-generate → auto-post → link (0 taps)
   * - 1 channel no topic → ask topic → generate → auto-post → link
   * - N channels + topic → show multi-select → confirm → generate → post all → links
   * - N channels no topic → show multi-select → confirm → ask topic → generate → post all → links
   */
  bot.command(["generate", "quickpost"], async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const topic = ctx.message?.text?.split(" ").slice(1).join(" ").trim();
    const chats = await getPostableBotChats(env.SESSIONS);

    if (chats.length === 0) {
      await ctx.reply(
        "⚠️ No channels or groups to post to.\n\nAdd the bot as admin to a channel/group first.",
      );
      return;
    }

    // ── Single channel: fast path ──
    if (chats.length === 1) {
      const target = chats[0];

      if (!topic) {
        // Save target, ask for topic
        await setPendingGeneration(env.SESSIONS, userId, {
          topic: "",
          step: "enter_topic",
          selectedTargets: [
            {
              chatId: target.chatId,
              title: target.title,
              type: target.type,
              username: target.username,
            },
          ],
        });
        await ctx.reply(
          `✨ <b>Generate post → ${escapeHtml(target.title)}</b>\n\n` +
            `What should I write about? Send the topic or details:`,
          { parse_mode: "HTML" },
        );
        return;
      }

      // Has topic + single channel → verify access, then generate & post
      // Pre-check avoids wasting AI tokens if the bot lost access.
      if (!(await isChatReachable(ctx, env, target))) {
        await ctx.reply(
          `❌ <b>Cannot reach "${escapeHtml(target.title)}"</b>\n\n` +
            `🧹 This chat has been removed from the list.\n` +
            `Re-add the bot as admin, then use /scan or /addchannel.`,
          { parse_mode: "HTML" },
        );
        return;
      }

      await ctx.reply(
        `✨ Generating and posting to <b>${escapeHtml(target.title)}</b>...\n⏳`,
        { parse_mode: "HTML" },
      );

      try {
        const { cleanTopic, format } = parseFormatHints(topic);
        const imagesEnabled =
          (await env.SESSIONS?.get("setting:image_with_posts")) !== "false";
        const prompt = getPromptForFormat(format, !!env.AI, imagesEnabled);
        const kbPrompt = await getKnowledgeBasePrompt(env.SESSIONS);
        const systemPrompt = kbPrompt + "\n\n" + prompt + cleanTopic;
        const rawText = await generateWithAI(
          env,
          systemPrompt,
          `Write a post about: ${cleanTopic}`,
        );
        if (!rawText) {
          await ctx.reply(
            "❌ Generation failed (both Workers AI and Agent returned empty). Check worker logs. Try again.",
          );
          return;
        }
        await publishToChat(ctx, env, target, rawText);
      } catch (error) {
        log.error("Generate error", error);
        await ctx.reply(`❌ Error: ${formatError(error)}`);
      }
      return;
    }

    // ── Multiple channels: show multi-select ──
    // Pre-select all targets by default for plug-and-play
    const allTargets: PendingGenerationTarget[] = chats.map((c) => ({
      chatId: c.chatId,
      title: c.title,
      type: c.type,
      username: c.username,
    }));

    await setPendingGeneration(env.SESSIONS, userId, {
      topic: topic || "",
      step: "select_targets",
      selectedTargets: allTargets, // all selected by default
    });

    const keyboard = buildTargetSelectionKeyboard(chats, allTargets);

    await ctx.reply(
      `✨ <b>Generate Post</b>\n\n` +
        `Select where to publish (tap to toggle):\n` +
        `<i>All channels selected by default.</i>` +
        (topic ? `\n\n📝 Topic: <i>"${escapeHtml(topic)}"</i>` : ``),
      { parse_mode: "HTML", reply_markup: keyboard },
    );
  });

  // ── Toggle target selection: gen_toggle:{chatId} ──
  bot.callbackQuery(/^gen_toggle:(.+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const match = ctx.match[1];
    const pending = await getPendingGeneration(env.SESSIONS, userId);
    if (!pending || pending.step !== "select_targets") {
      await ctx.answerCallbackQuery("Session expired");
      return;
    }

    const chats = await getPostableBotChats(env.SESSIONS);
    const selected = pending.selectedTargets || [];

    if (match === "all") {
      // Toggle all: if all selected → deselect all, else select all
      if (selected.length === chats.length) {
        pending.selectedTargets = [];
      } else {
        pending.selectedTargets = chats.map((c) => ({
          chatId: c.chatId,
          title: c.title,
          type: c.type,
          username: c.username,
        }));
      }
    } else {
      const chatId = parseInt(match, 10);
      const idx = selected.findIndex((t) => t.chatId === chatId);
      if (idx >= 0) {
        // Deselect
        selected.splice(idx, 1);
        pending.selectedTargets = selected;
      } else {
        // Select
        const chat = chats.find((c) => c.chatId === chatId);
        if (chat) {
          selected.push({
            chatId: chat.chatId,
            title: chat.title,
            type: chat.type,
            username: chat.username,
          });
          pending.selectedTargets = selected;
        }
      }
    }

    await setPendingGeneration(env.SESSIONS, userId, pending);
    await ctx.answerCallbackQuery();

    const keyboard = buildTargetSelectionKeyboard(
      chats,
      pending.selectedTargets || [],
    );

    const selectedCount = (pending.selectedTargets || []).length;
    await ctx.editMessageText(
      `✨ <b>Generate Post</b>\n\n` +
        `Select where to publish (tap to toggle):\n` +
        `<b>${selectedCount}</b> of ${chats.length} selected` +
        (pending.topic
          ? `\n\n📝 Topic: <i>"${escapeHtml(pending.topic)}"</i>`
          : ``),
      { parse_mode: "HTML", reply_markup: keyboard },
    );
  });

  // ── Confirm targets and proceed: gen_confirm ──
  bot.callbackQuery("gen_confirm", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const pending = await getPendingGeneration(env.SESSIONS, userId);
    if (!pending?.selectedTargets || pending.selectedTargets.length === 0) {
      await ctx.answerCallbackQuery("Select at least one channel!");
      return;
    }

    // If we already have a topic → generate and post
    if (pending.topic) {
      await ctx.answerCallbackQuery("Generating...");
      await ctx.editMessageText(
        `✨ <b>Generating and posting to ${pending.selectedTargets.length} target(s)...</b>\n⏳`,
        { parse_mode: "HTML" },
      );
      await generateAndPostToTargets(
        ctx,
        env,
        pending.topic,
        pending.selectedTargets,
      );
      await clearPendingGeneration(env.SESSIONS, userId);
      return;
    }

    // No topic yet → ask for it
    pending.step = "enter_topic";
    await setPendingGeneration(env.SESSIONS, userId, pending);
    await ctx.answerCallbackQuery();

    const targetNames = pending.selectedTargets.map((t) => t.title).join(", ");
    await ctx.editMessageText(
      `✨ <b>Targets:</b> ${escapeHtml(targetNames)}\n\n` +
        `Now send me the topic or details for the post:`,
      { parse_mode: "HTML" },
    );
  });

  // ── Cancel generate flow ──
  bot.callbackQuery("gen_cancel", async (ctx) => {
    const userId = ctx.from?.id;
    if (userId) await clearPendingGeneration(env.SESSIONS, userId);
    await ctx.answerCallbackQuery("Cancelled");
    await ctx.deleteMessage();
  });

  // ── Handle text input for topic (step: enter_topic) ──
  bot.on("message:text", async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();
    if (ctx.chat?.type !== "private") return next();

    const pending = await getPendingGeneration(env.SESSIONS, userId);
    if (!pending) return next();

    // Handle topic input step
    if (pending.step === "enter_topic") {
      const text = ctx.message.text;
      if (text === "/cancel") {
        await clearPendingGeneration(env.SESSIONS, userId);
        await ctx.reply("❌ Cancelled.");
        return;
      }
      if (text.startsWith("/")) return next();

      const targets = pending.selectedTargets || [];
      if (targets.length === 0) {
        await clearPendingGeneration(env.SESSIONS, userId);
        await ctx.reply("❌ No targets selected. Use /generate again.");
        return;
      }

      const targetNames = targets.map((t) => t.title).join(", ");
      await ctx.reply(
        `✨ <b>Generating and posting to ${targets.length} target(s)...</b>\n` +
          `📢 ${escapeHtml(targetNames)}\n⏳`,
        { parse_mode: "HTML" },
      );

      await generateAndPostToTargets(ctx, env, text, targets);
      await clearPendingGeneration(env.SESSIONS, userId);
      return;
    }

    // Handle editing step (from preview)
    if (pending.step === "editing" && pending.generatedText) {
      const text = ctx.message.text;
      if (text === "/cancel") {
        await clearPendingGeneration(env.SESSIONS, userId);
        await ctx.reply("❌ Editing cancelled.");
        return;
      }
      if (text.startsWith("/")) return next();

      pending.generatedText = text;
      pending.step = "preview";
      await setPendingGeneration(env.SESSIONS, userId, pending);

      // Re-show preview with targets
      const targets = pending.selectedTargets || [];
      const keyboard = buildPreviewKeyboard(targets);

      await ctx.reply(
        `✅ <b>Updated!</b>\n\n` +
          `<blockquote>${escapeHtml(text)}</blockquote>\n\n` +
          buildTargetSummary(targets),
        { parse_mode: "HTML", reply_markup: keyboard },
      );
      return;
    }

    return next();
  });

  // ── Preview actions (regenerate, edit, post) ──
  bot.callbackQuery(/^gen_preview:(.+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const action = ctx.match[1];
    const pending = await getPendingGeneration(env.SESSIONS, userId);

    if (action === "cancel") {
      if (userId) await clearPendingGeneration(env.SESSIONS, userId);
      await ctx.answerCallbackQuery("Cancelled");
      await ctx.deleteMessage();
      return;
    }

    if (!pending?.generatedText) {
      await ctx.answerCallbackQuery("Session expired");
      await ctx.deleteMessage();
      return;
    }

    if (action === "post") {
      const targets = pending.selectedTargets || [];
      if (targets.length === 0) {
        await ctx.answerCallbackQuery("No targets!");
        return;
      }
      await ctx.answerCallbackQuery("Posting...");
      await ctx.deleteMessage();

      // Post to all targets (with image/content-block support)
      for (const target of targets) {
        await publishToChat(ctx, env, target, pending.generatedText);
      }
      await clearPendingGeneration(env.SESSIONS, userId);
      return;
    }

    if (action === "regenerate") {
      await ctx.answerCallbackQuery("Regenerating...");
      await ctx.editMessageText("✨ <b>Regenerating...</b>\n⏳", {
        parse_mode: "HTML",
      });

      try {
        const { cleanTopic: regenTopic, format: regenFmt } = parseFormatHints(
          pending.topic,
        );
        const regenImagesEnabled =
          (await env.SESSIONS?.get("setting:image_with_posts")) !== "false";
        const regenPrompt = getPromptForFormat(
          regenFmt,
          !!env.AI,
          regenImagesEnabled,
        );
        const regenKb = await getKnowledgeBasePrompt(env.SESSIONS);
        const regenSystem = regenKb + "\n\n" + regenPrompt + regenTopic;
        const text = await generateWithAI(
          env,
          regenSystem,
          `Write a post about: ${regenTopic}`,
        );
        if (!text) {
          await ctx.editMessageText("❌ Regeneration failed.");
          return;
        }
        pending.generatedText = text;
        await setPendingGeneration(env.SESSIONS, userId, pending);

        const targets = pending.selectedTargets || [];
        const keyboard = buildPreviewKeyboard(targets);

        await ctx.editMessageText(
          `✨ <b>Regenerated Post</b>\n\n` +
            `<blockquote>${escapeHtml(text)}</blockquote>\n\n` +
            buildTargetSummary(targets),
          { parse_mode: "HTML", reply_markup: keyboard },
        );
      } catch {
        await ctx.editMessageText(
          "❌ Regeneration failed. Try /generate again.",
        );
      }
      return;
    }

    if (action === "edit") {
      await ctx.answerCallbackQuery();
      pending.step = "editing";
      await setPendingGeneration(env.SESSIONS, userId, pending);
      await ctx.editMessageText(
        `✏️ <b>Edit mode</b>\n\n` +
          `Current text:\n<blockquote>${escapeHtml(pending.generatedText)}</blockquote>\n\n` +
          `Send your edited version, or /cancel to abort.`,
        { parse_mode: "HTML" },
      );
      return;
    }

    await ctx.answerCallbackQuery("Unknown action");
  });
}

// ─── Generate Helpers ──────────────────────────────────────────────

/**
 * Build multi-select target keyboard with checkboxes.
 */
function buildTargetSelectionKeyboard(
  allChats: BotChat[],
  selected: PendingGenerationTarget[],
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const selectedIds = new Set(selected.map((t) => t.chatId));

  for (const c of allChats.slice(0, 8)) {
    const icon = c.type === "channel" ? "📢" : "💬";
    const check = selectedIds.has(c.chatId) ? "✅" : "⬜";
    keyboard
      .text(`${check} ${icon} ${c.title}`, `gen_toggle:${c.chatId}`)
      .row();
  }

  // Select all / deselect all
  const allSelected = selected.length === allChats.length;
  keyboard
    .text(allSelected ? "☐ Deselect All" : "☑ Select All", "gen_toggle:all")
    .row();

  // Continue button (shows count)
  const count = selected.length;
  keyboard
    .text(
      count > 0 ? `🚀 Continue (${count})` : `Select at least one`,
      count > 0 ? "gen_confirm" : "gen_toggle:all",
    )
    .row();

  keyboard.text("❌ Cancel", "gen_cancel");

  return keyboard;
}

/**
 * Build preview keyboard after generation.
 */
function buildPreviewKeyboard(
  targets: PendingGenerationTarget[],
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  keyboard
    .text(`🚀 Post to ${targets.length} target(s)`, "gen_preview:post")
    .row();
  keyboard
    .text("🔄 Regenerate", "gen_preview:regenerate")
    .text("✏️ Edit", "gen_preview:edit")
    .row();
  keyboard.text("❌ Cancel", "gen_preview:cancel");
  return keyboard;
}

/**
 * Build a target summary line for messages.
 */
function buildTargetSummary(targets: PendingGenerationTarget[]): string {
  if (targets.length === 0) return "⚠️ No targets selected.";
  if (targets.length === 1)
    return `📢 Target: <b>${escapeHtml(targets[0].title)}</b>`;
  return `📢 Targets (${targets.length}): ${targets.map((t) => `<b>${escapeHtml(t.title)}</b>`).join(", ")}`;
}

/**
 * Generate a post and publish to multiple targets.
 *
 * Pre-verifies all targets are still reachable before spending AI tokens.
 */
async function generateAndPostToTargets(
  ctx: Context,
  env: Env,
  topic: string,
  targets: PendingGenerationTarget[],
): Promise<void> {
  try {
    // Pre-verify targets so we don't waste AI generation on stale chats
    const reachable = await filterReachableTargets(ctx, env, targets);
    if (reachable.length === 0) {
      await ctx.reply(
        "❌ <b>No reachable targets left.</b>\n\n" +
          "Re-add the bot as admin to your channels/groups, then /scan.",
        { parse_mode: "HTML" },
      );
      return;
    }

    const { cleanTopic: multiTopic, format: multiFmt } =
      parseFormatHints(topic);
    const multiImagesEnabled =
      (await env.SESSIONS?.get("setting:image_with_posts")) !== "false";
    const multiPrompt = getPromptForFormat(
      multiFmt,
      !!env.AI,
      multiImagesEnabled,
    );
    const kbPrompt = await getKnowledgeBasePrompt(env.SESSIONS);
    const systemPrompt = kbPrompt + "\n\n" + multiPrompt + multiTopic;
    const rawText = await generateWithAI(
      env,
      systemPrompt,
      `Write a post about: ${multiTopic}`,
    );

    if (!rawText) {
      await ctx.reply(
        "❌ Generation failed (both Workers AI and Agent returned empty). Check worker logs. Try again.",
      );
      return;
    }

    // Post to every verified target (with image support)
    for (const target of reachable) {
      await publishToChat(ctx, env, target, rawText);
    }
  } catch (error) {
    log.error("Generate and post error", error);
    await ctx.reply(`❌ Error: ${formatError(error)}`);
  }
}

/**
 * Quick-check that the bot can still reach a chat.
 *
 * Calls `getChat` (cheap, no message sent). Returns `true` when the
 * chat exists and the bot has visibility; `false` when Telegram says
 * "chat not found" / "bot was kicked" / etc.
 *
 * On failure the stale KV entry is removed automatically so the chat
 * won't appear in future `/generate` lists.
 */
async function isChatReachable(
  ctx: Context,
  env: Env,
  chat: BotChat,
): Promise<boolean> {
  try {
    await ctx.api.getChat(chat.chatId);
    return true;
  } catch (error) {
    const msg = formatError(error);
    const gone =
      msg.includes("chat not found") ||
      msg.includes("bot was kicked") ||
      msg.includes("bot is not a member");
    if (gone) {
      await removeStaleBotChat(env.SESSIONS, chat.chatId);
      log.warn(
        `Pre-check: removed stale chat "${chat.title}" (${chat.chatId})`,
      );
    }
    return false;
  }
}

/**
 * Filter targets, dropping any the bot can no longer reach.
 * Notifies the user about removed chats.
 */
async function filterReachableTargets(
  ctx: Context,
  env: Env,
  targets: PendingGenerationTarget[],
): Promise<PendingGenerationTarget[]> {
  const results: PendingGenerationTarget[] = [];
  const removed: string[] = [];

  for (const target of targets) {
    const chat: BotChat = {
      chatId: target.chatId,
      title: target.title,
      type: target.type,
      username: target.username,
      role: "administrator",
      canPost: true,
      updatedAt: Date.now(),
    };

    if (await isChatReachable(ctx, env, chat)) {
      results.push(target);
    } else {
      removed.push(target.title);
    }
  }

  if (removed.length > 0) {
    await ctx.reply(
      `🧹 <b>Stale chat(s) removed:</b> ${removed.map((t) => escapeHtml(t)).join(", ")}\n` +
        `Re-add the bot as admin, then use /scan or /addchannel.`,
      { parse_mode: "HTML" },
    );
  }

  return results;
}

/**
 * Verify bot has access to channel and can post
 */
async function verifyChannelAccess(
  ctx: Context,
  channelId: string,
): Promise<ChannelInfo | null> {
  try {
    // Get chat info
    const chat = await ctx.api.getChat(channelId);

    if (!chat) return null;

    // Check if bot is admin
    const botId = ctx.me.id;
    const member = await ctx.api.getChatMember(chat.id, botId);

    const canPost =
      member.status === "administrator" &&
      (member.can_post_messages === true ||
        chat.type === "group" ||
        chat.type === "supergroup");

    return {
      chatId: chat.id,
      title: chat.title || chat.username || String(chat.id),
      type: chat.type,
      username: "username" in chat ? chat.username : undefined,
      canPost,
    };
  } catch (error) {
    log.error("Error verifying channel", error);
    return null;
  }
}

// buildPostLink is imported from ../utils/helpers

/**
 * Post message to a channel or group.
 *
 * Auto-cleans stale KV entries when Telegram returns "chat not found"
 * (bot was removed, channel deleted, or bot token changed).
 */
async function postToChat(
  ctx: Context,
  env: Env,
  chat: BotChat,
  text: string,
): Promise<PostResult> {
  try {
    // Parse content through the ContentBlock pipeline which sets
    // parseMode: "Markdown" and normalizes formatting (blank lines, etc.)
    const contentBlock = parseContentBlock(text);
    const messageId = await publishContent(ctx.api, chat.chatId, contentBlock);

    const link = buildPostLink(chat.chatId, messageId, chat.username);

    await ctx.reply(
      `✅ <b>Posted!</b>\n\n` +
        `📢 ${escapeHtml(chat.title)}\n` +
        `🔗 <a href="${link}">View post</a>`,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    );

    return { success: true, messageId };
  } catch (error) {
    const errorMsg = formatError(error);
    log.error("Error posting to channel", error);

    // Auto-cleanup stale entries: if Telegram can't find the chat,
    // the bot was removed, channel was deleted, or bot token changed.
    const isChatGone =
      errorMsg.includes("chat not found") ||
      errorMsg.includes("bot was kicked") ||
      errorMsg.includes("bot is not a member");

    if (isChatGone) {
      await removeStaleBotChat(env.SESSIONS, chat.chatId);
      log.warn(
        `Removed stale chat "${chat.title}" (${chat.chatId}) from bot_chats`,
      );

      await ctx.reply(
        `❌ <b>Failed to post</b>\n\n` +
          `Chat: ${escapeHtml(chat.title)} (<code>${chat.chatId}</code>)\n` +
          `Error: ${escapeHtml(errorMsg)}\n\n` +
          `🧹 This chat has been removed from the list.\n` +
          `To fix: re-add the bot as admin to the channel/group, then use /scan or /addchannel.`,
        { parse_mode: "HTML" },
      );
    } else {
      await ctx.reply(
        `❌ <b>Failed to post</b>\n\n` +
          `Chat: ${escapeHtml(chat.title)} (<code>${chat.chatId}</code>)\n` +
          `Error: ${escapeHtml(errorMsg)}`,
        { parse_mode: "HTML" },
      );
    }

    return { success: false, error: errorMsg };
  }
}

/**
 * Publish AI-generated content (text, photo, poll, etc.) to a chat.
 *
 * Parses the raw AI response as a ContentBlock, then delegates to
 * publishContent() which sends the correct Telegram API method
 * (sendMessage, sendPhoto, sendPoll, etc.).
 *
 * Falls back to plain-text postToChat() on any publishContent error
 * so the user always gets *something* posted.
 */
async function publishToChat(
  ctx: Context,
  env: Env,
  target: BotChat | PendingGenerationTarget,
  rawAIResponse: string,
): Promise<PostResult> {
  const chat: BotChat = {
    chatId: target.chatId,
    title: target.title,
    type: target.type,
    username: target.username,
    role: "role" in target ? (target as BotChat).role : "administrator",
    canPost: true,
    updatedAt: Date.now(),
  };

  try {
    const contentBlock = parseContentBlock(rawAIResponse);
    log.debug(`Publishing ${contentBlock.type} to "${chat.title}"`);

    const messageId = await publishContent(
      ctx.api,
      chat.chatId,
      contentBlock,
      env.AI, // Workers AI binding for on-the-fly image generation
    );

    const link = buildPostLink(chat.chatId, messageId, chat.username);

    const typeLabel =
      contentBlock.type === "photo"
        ? "📸 Photo post"
        : contentBlock.type === "poll"
          ? "📊 Poll"
          : "📝 Text post";

    await ctx.reply(
      `✅ <b>${typeLabel} posted!</b>\n\n` +
        `📢 ${escapeHtml(chat.title)}\n` +
        `🔗 <a href="${link}">View post</a>`,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    );

    return { success: true, messageId };
  } catch (error) {
    const errorMsg = formatError(error);
    log.error(
      `publishContent failed for "${chat.title}", falling back to text`,
      error,
    );

    // Auto-cleanup stale entries
    const isChatGone =
      errorMsg.includes("chat not found") ||
      errorMsg.includes("bot was kicked") ||
      errorMsg.includes("bot is not a member");

    if (isChatGone) {
      await removeStaleBotChat(env.SESSIONS, chat.chatId);
      await ctx.reply(
        `❌ <b>Failed to post</b>\n\n` +
          `Chat: ${escapeHtml(chat.title)} (<code>${chat.chatId}</code>)\n` +
          `Error: ${escapeHtml(errorMsg)}\n\n` +
          `🧹 This chat has been removed from the list.\n` +
          `Re-add the bot as admin, then use /scan or /addchannel.`,
        { parse_mode: "HTML" },
      );
      return { success: false, error: errorMsg };
    }

    // Fallback: try sending as plain text
    return postToChat(ctx, env, chat, rawAIResponse);
  }
}

/**
 * Generate text using AI agent.
 * Uses sendAgentMessage which properly routes via AGENT_SERVICE (Durable Object
 * service binding in single-worker) or via HTTP (standalone deployments).
 */
async function generateWithAI(
  env: Env,
  systemPrompt: string,
  userMessage: string,
): Promise<string | null> {
  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userMessage },
  ];

  let content: string | undefined;
  const errors: string[] = [];

  // Try Workers AI FIRST — faster, no DO overhead, ideal for post generation
  if (env.AI) {
    try {
      console.log("[generateWithAI] trying Workers AI (primary)");
      const t0 = Date.now();
      const result = (await env.AI.run(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as keyof AiModels,
        { messages } as any,
      )) as { response?: string };
      const dur = Date.now() - t0;
      console.log("[generateWithAI] Workers AI ok", JSON.stringify({
        duration: dur, responseLen: result.response?.length ?? 0,
      }));
      content = result.response?.trim() || undefined;
    } catch (aiError) {
      const msg = aiError instanceof Error ? aiError.message : String(aiError);
      console.error("[generateWithAI] Workers AI FAILED:", msg);
      errors.push(`WorkersAI: ${msg}`);
    }
  }

  // Fallback to Agent (via AGENT_SERVICE or AGENT_URL)
  if (!content) {
    const agentUrl = env.AGENT_URL || "";
    const useServiceBinding = !!env.AGENT_SERVICE;
    const hasAgent = !!agentUrl || useServiceBinding;

    if (hasAgent) {
      try {
        const sessionId = `gen_${Date.now()}`;
        console.log("[generateWithAI] trying Agent (fallback)");
        const t0 = Date.now();
        const fullText = await sendAgentMessage(
          agentUrl,
          sessionId,
          messages,
          useServiceBinding ? env.AGENT_SERVICE : undefined,
        );
        const dur = Date.now() - t0;
        console.log("[generateWithAI] agent ok", JSON.stringify({
          duration: dur, responseLen: fullText.length,
        }));
        content = fullText.trim() || undefined;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[generateWithAI] Agent FAILED:", msg);
        errors.push(`Agent: ${msg}`);
      }
    }
  }

  if (!content && errors.length > 0) {
    console.error("[generateWithAI] ALL FAILED:", errors.join(" | "));
  }

  return content || null;
}
