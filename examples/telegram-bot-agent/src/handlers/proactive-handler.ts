/**
 * Proactive Mode Handler (Simplified)
 *
 * Commands:
 * - /proactive - Configure proactive mode
 * - /prompt - Set/view the bot's prompt (contains everything)
 *
 * All configuration is owner-only. The bot owner controls proactive
 * settings for all groups where the bot is present.
 */

import { Bot, Context, InlineKeyboard } from "grammy";
import type { ProactiveMode } from "../types/proactive";
import {
  getProactiveSettings,
  getOrCreateProactiveSettings,
  saveProactiveSettings,
  enableProactiveMode,
  disableProactiveMode,
  setSystemPrompt,
} from "../utils/proactive-storage";
import {
  getPendingPromptState,
  setPendingPromptState,
  clearPendingPromptState,
} from "../utils/pending-state";
import { isOwner } from "../utils/owner";
import type { TelegramBotEnv } from "../types/env";

type Env = TelegramBotEnv;

/**
 * Setup proactive mode command handlers
 */
export function setupProactiveHandlers(bot: Bot, env: Env): void {
  // /proactive command - Main settings (owner only, gated by middleware too)
  bot.command("proactive", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    const chatType = ctx.chat?.type;

    if (!userId || !chatId) return;

    // Only works in groups
    if (chatType !== "group" && chatType !== "supergroup") {
      await ctx.reply(
        "🤖 <b>Proactive Mode</b>\n\n" +
          "This feature works in group chats.\n" +
          "Add me to a group and use /proactive there.",
        { parse_mode: "HTML" },
      );
      return;
    }

    // Owner check (replaces old verifyAdmin)
    if (!(await isOwner(env, userId))) {
      await ctx.reply("⚠️ Only the bot owner can configure proactive mode.");
      return;
    }

    // Check if bot is admin
    const botMember = await ctx.api.getChatMember(chatId, ctx.me.id);
    if (botMember.status !== "administrator") {
      await ctx.reply(
        "⚠️ I need to be an administrator to use proactive mode.\n\n" +
          "Please make me admin with 'Read Messages' permission.",
      );
      return;
    }

    await showProactiveSettings(ctx, env, chatId);
  });

  // Mode selection - after selecting, ask for prompt
  bot.callbackQuery(/^proactive_mode:(-?\d+):(\w+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    if (!(await isOwner(env, userId))) {
      await ctx.answerCallbackQuery("Owner only");
      return;
    }

    const chatId = parseInt(ctx.match[1]);
    const mode = ctx.match[2] as ProactiveMode;

    const chatTitle = ctx.chat?.title || "Group";

    if (mode === "off") {
      await disableProactiveMode(env.SESSIONS, chatId);
      await ctx.answerCallbackQuery("Proactive mode disabled");
      await showProactiveSettings(ctx, env, chatId);
      return;
    }

    // Enable mode with preset prompt
    await enableProactiveMode(env.SESSIONS, chatId, chatTitle, mode);

    // Use chatId:userId key so only THIS owner's messages are intercepted
    const pendingKey = `prompt:${chatId}:${userId}`;

    // For Support/Community - ask for project description
    if (mode === "support" || mode === "community") {
      await ctx.answerCallbackQuery();

      // Store pending prompt state tied to specific owner
      await setPendingPromptState(env.SESSIONS, pendingKey, { chatId });

      const modeEmoji = mode === "support" ? "🎧" : "👥";
      const modeLabel = mode === "support" ? "Support" : "Community";

      await ctx.editMessageText(
        `${modeEmoji} <b>${modeLabel} Mode Enabled!</b>\n\n` +
          `Now describe your project so I know how to help:\n\n` +
          `<i>Example: "CryptoDAO project — $DAO token, TGE Q2 2026. ` +
          `15% APY staking. Reply concisely and in a friendly tone."</i>\n\n` +
          `Send your description or /skip to use default.`,
        { parse_mode: "HTML" },
      );
    } else {
      // Custom mode - also ask for prompt
      await ctx.answerCallbackQuery();
      await setPendingPromptState(env.SESSIONS, pendingKey, { chatId });

      await ctx.editMessageText(
        `⚙️ <b>Custom Mode</b>\n\n` +
          `Send your complete prompt for the bot.\n\n` +
          `<i>Include: who you are, what project, how to respond, any FAQ.</i>\n\n` +
          `Or /skip to configure later with /prompt`,
        { parse_mode: "HTML" },
      );
    }
  });

  // Handle prompt input after mode selection
  // Key is prompt:${chatId}:${userId} so only the owner who started setup is intercepted
  bot.on("message:text", async (ctx, next) => {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    if (!chatId || !userId) return next();

    // Check if THIS user is in prompt-setting mode for THIS chat
    const pendingKey = `prompt:${chatId}:${userId}`;
    const pending = await getPendingPromptState(env.SESSIONS, pendingKey);
    if (!pending) return next();

    const text = ctx.message.text;

    // Skip command
    if (text === "/skip") {
      await clearPendingPromptState(env.SESSIONS, pendingKey);
      await ctx.reply(
        "✅ Using default prompt.\n\n" + "Use /prompt anytime to customize.",
        { parse_mode: "HTML" },
      );
      return;
    }

    // Don't intercept other commands
    if (text.startsWith("/")) return next();

    // Save prompt
    const chatTitle = ctx.chat.title || "Group";
    await setSystemPrompt(env.SESSIONS, chatId, chatTitle, text);
    await clearPendingPromptState(env.SESSIONS, pendingKey);

    await ctx.reply(
      `✅ <b>All set!</b>\n\n` +
        `Your prompt:\n` +
        `<i>${text.substring(0, 200)}${text.length > 200 ? "..." : ""}</i>\n\n` +
        `Bot will now respond to questions and mentions.\n` +
        `Use /proactive to adjust settings or /prompt to change.`,
      { parse_mode: "HTML" },
    );
  });

  // Toggle triggers
  bot.callbackQuery(/^proactive_trigger:(-?\d+):(\w+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    if (!(await isOwner(env, userId))) {
      await ctx.answerCallbackQuery("Owner only");
      return;
    }

    const chatId = parseInt(ctx.match[1]);
    const trigger = ctx.match[2];

    const settings = await getProactiveSettings(env.SESSIONS, chatId);
    if (!settings) return;

    switch (trigger) {
      case "mentions":
        settings.respondToMentions = !settings.respondToMentions;
        break;
      case "replies":
        settings.respondToReplies = !settings.respondToReplies;
        break;
      case "questions":
        settings.respondToQuestions = !settings.respondToQuestions;
        break;
    }

    await saveProactiveSettings(env.SESSIONS, settings);
    await ctx.answerCallbackQuery("Updated");
    await showProactiveSettings(ctx, env, chatId);
  });

  // Adjust probability
  bot.callbackQuery(/^proactive_prob:(-?\d+):(\w+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    if (!(await isOwner(env, userId))) {
      await ctx.answerCallbackQuery("Owner only");
      return;
    }

    const chatId = parseInt(ctx.match[1]);
    const action = ctx.match[2];

    const settings = await getProactiveSettings(env.SESSIONS, chatId);
    if (!settings) return;

    if (action === "up" && settings.responseProbability < 100) {
      settings.responseProbability = Math.min(
        100,
        settings.responseProbability + 10,
      );
    } else if (action === "down" && settings.responseProbability > 0) {
      settings.responseProbability = Math.max(
        0,
        settings.responseProbability - 10,
      );
    }

    await saveProactiveSettings(env.SESSIONS, settings);
    await ctx.answerCallbackQuery(
      `Probability: ${settings.responseProbability}%`,
    );
    await showProactiveSettings(ctx, env, chatId);
  });

  // Back to settings
  bot.callbackQuery(/^proactive_back:(-?\d+)$/, async (ctx) => {
    const chatId = parseInt(ctx.match[1]);
    await ctx.answerCallbackQuery();
    await showProactiveSettings(ctx, env, chatId);
  });

  // Show mode selection
  bot.callbackQuery(/^proactive_modes:(-?\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    if (!(await isOwner(env, userId))) {
      await ctx.answerCallbackQuery("Owner only");
      return;
    }

    const chatId = parseInt(ctx.match[1]);

    const keyboard = new InlineKeyboard()
      .text("🎧 Support", `proactive_mode:${chatId}:support`)
      .row()
      .text("👥 Community", `proactive_mode:${chatId}:community`)
      .row()
      .text("⚙️ Custom", `proactive_mode:${chatId}:custom`)
      .row()
      .text("🔴 Disable", `proactive_mode:${chatId}:off`)
      .row()
      .text("« Back", `proactive_back:${chatId}`);

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      "🤖 <b>Select Mode</b>\n\n" +
        "<b>🎧 Support</b>\n" +
        "Answers questions about your project.\n\n" +
        "<b>👥 Community</b>\n" +
        "Keeps chat friendly and engaged.\n\n" +
        "<b>⚙️ Custom</b>\n" +
        "Full control with your own prompt.",
      { parse_mode: "HTML", reply_markup: keyboard },
    );
  });

  // /prompt command - View/set prompt (owner only)
  bot.command("prompt", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    const chatType = ctx.chat?.type;

    if (!userId || !chatId) return;

    if (chatType !== "group" && chatType !== "supergroup") {
      await ctx.reply("Use this command in a group chat.");
      return;
    }

    // Owner check
    if (!(await isOwner(env, userId))) {
      await ctx.reply("⚠️ Only the bot owner can manage the prompt.");
      return;
    }

    const prompt = ctx.message?.text?.split(" ").slice(1).join(" ").trim();
    const settings = await getProactiveSettings(env.SESSIONS, chatId);

    // No argument - show current prompt
    if (!prompt) {
      const currentPrompt = settings?.systemPrompt || "(not set)";
      const statusIcon = settings?.enabled ? "✅" : "❌";

      await ctx.reply(
        `📝 <b>Bot Prompt</b>\n\n` +
          `Status: ${statusIcon}\n\n` +
          `<b>Current prompt:</b>\n` +
          `<i>${currentPrompt.substring(0, 500)}${currentPrompt.length > 500 ? "..." : ""}</i>\n\n` +
          `<b>To change:</b>\n` +
          `<code>/prompt Your new prompt here</code>\n\n` +
          `Include: project name, key info, how to respond.`,
        { parse_mode: "HTML" },
      );
      return;
    }

    // Set new prompt
    const chatTitle = ctx.chat.title || "Group";
    await setSystemPrompt(env.SESSIONS, chatId, chatTitle, prompt);

    // Enable proactive mode if not already
    if (!settings?.enabled) {
      await enableProactiveMode(env.SESSIONS, chatId, chatTitle, "custom");
    }

    await ctx.reply(
      "✅ <b>Prompt updated!</b>\n\n" +
        `<i>${prompt.substring(0, 300)}${prompt.length > 300 ? "..." : ""}</i>\n\n` +
        "Bot is now active. Use /proactive to adjust triggers.",
      { parse_mode: "HTML" },
    );
  });
}

/**
 * Show proactive settings UI (simplified)
 */
async function showProactiveSettings(
  ctx: Context,
  env: Env,
  chatId: number,
): Promise<void> {
  const settings = await getOrCreateProactiveSettings(
    env.SESSIONS,
    chatId,
    ctx.chat?.title || "Group",
  );

  const statusIcon = settings.enabled ? "✅" : "❌";
  const modeLabel =
    settings.mode === "off"
      ? "Disabled"
      : settings.mode.charAt(0).toUpperCase() + settings.mode.slice(1);

  let message = `🤖 <b>Proactive Mode</b>\n`;
  message += `📍 ${settings.chatTitle}\n\n`;
  message += `Status: ${statusIcon} <b>${modeLabel}</b>\n\n`;

  if (settings.enabled) {
    // Show prompt preview
    if (settings.systemPrompt) {
      message += `📝 <b>Prompt:</b>\n`;
      message += `<i>${settings.systemPrompt.substring(0, 100)}${settings.systemPrompt.length > 100 ? "..." : ""}</i>\n\n`;
    }

    message += `<b>Responds to:</b>\n`;
    message += `${settings.respondToMentions ? "✅" : "❌"} @mentions\n`;
    message += `${settings.respondToReplies ? "✅" : "❌"} Replies\n`;
    message += `${settings.respondToQuestions ? "✅" : "❌"} Questions (${settings.responseProbability}%)\n\n`;

    message += `📈 This hour: ${settings.responsesThisHour}/${settings.maxResponsesPerHour}`;
  }

  const keyboard = new InlineKeyboard();

  // Mode selection
  keyboard.text("🎛️ Change Mode", `proactive_modes:${chatId}`).row();

  if (settings.enabled) {
    // Trigger toggles (simplified)
    keyboard.text(
      `${settings.respondToMentions ? "✅" : "❌"} @mentions`,
      `proactive_trigger:${chatId}:mentions`,
    );
    keyboard
      .text(
        `${settings.respondToQuestions ? "✅" : "❌"} Questions`,
        `proactive_trigger:${chatId}:questions`,
      )
      .row();

    // Probability controls
    keyboard.text("➖", `proactive_prob:${chatId}:down`);
    keyboard.text(
      `${settings.responseProbability}%`,
      `proactive_prob:${chatId}:noop`,
    );
    keyboard.text("➕", `proactive_prob:${chatId}:up`).row();
  }

  if (ctx.callbackQuery) {
    await ctx.editMessageText(message, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } else {
    await ctx.reply(message, { parse_mode: "HTML", reply_markup: keyboard });
  }
}
