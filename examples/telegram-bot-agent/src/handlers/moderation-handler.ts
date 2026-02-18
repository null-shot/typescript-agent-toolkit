/**
 * Moderation Handler - Community Manager commands
 *
 * Commands:
 * - /moderate - Configure moderation for a group
 * - /modstats - View moderation statistics
 * - /whitelist - Manage whitelist
 */

import { Bot, Context, InlineKeyboard } from "grammy";
import { verifyAdmin } from "../utils/helpers";
import type {
  ModerationSettings,
  ModerationAction,
  ContentCategory,
} from "../types/moderation";
import {
  CATEGORY_INFO,
  ACTION_INFO,
  getDefaultSettings,
} from "../types/moderation";
import {
  getModerationSettings,
  getOrCreateSettings,
  saveModerationSettings,
  toggleModeration,
  getUserManagedChats,
  addUserManagedChat,
  getModerationStats,
} from "../utils/moderation-storage";
import { loggers } from "../utils/logger";

const log = loggers.moderation;

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  SESSIONS: KVNamespace;
  AGENT_URL?: string;
}

/**
 * Setup moderation command handlers
 */
export function setupModerationHandlers(bot: Bot, env: Env): void {
  // /moderate command - Main moderation settings
  bot.command("moderate", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    // Check if in group or private chat
    const chatType = ctx.chat?.type;

    if (chatType === "group" || chatType === "supergroup") {
      // In group - setup moderation for this group
      await handleGroupModeration(ctx, env);
    } else {
      // In private - show list of managed groups
      await handlePrivateModeration(ctx, env);
    }
  });

  // Enable/disable moderation toggle
  bot.callbackQuery(/^mod_toggle:(-?\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const chatId = parseInt(ctx.match[1]);

    // Verify user is admin
    const isAdmin = await verifyAdmin(ctx, chatId, userId);
    if (!isAdmin) {
      await ctx.answerCallbackQuery("You must be an admin to change settings");
      return;
    }

    const settings = await getModerationSettings(env.SESSIONS, chatId);
    if (!settings) {
      await ctx.answerCallbackQuery("Settings not found");
      return;
    }

    const newEnabled = !settings.enabled;
    await toggleModeration(env.SESSIONS, chatId, newEnabled);

    await ctx.answerCallbackQuery(
      newEnabled ? "Moderation enabled ✅" : "Moderation disabled ❌",
    );
    await showModerationSettings(ctx, env, chatId);
  });

  // Detection toggles
  bot.callbackQuery(/^mod_detect:(-?\d+):(\w+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const chatId = parseInt(ctx.match[1]);
    const category = ctx.match[2] as keyof ModerationSettings;

    const isAdmin = await verifyAdmin(ctx, chatId, userId);
    if (!isAdmin) {
      await ctx.answerCallbackQuery("Admin only");
      return;
    }

    const settings = await getModerationSettings(env.SESSIONS, chatId);
    if (!settings) return;

    // Toggle detection
    const key =
      `detect${category.charAt(0).toUpperCase() + category.slice(1)}` as keyof ModerationSettings;
    if (key in settings && typeof settings[key] === "boolean") {
      (settings as unknown as Record<string, unknown>)[key] = !(
        settings as unknown as Record<string, unknown>
      )[key];
      await saveModerationSettings(env.SESSIONS, settings);
    }

    await ctx.answerCallbackQuery("Updated");
    await showModerationSettings(ctx, env, chatId);
  });

  // Action settings
  bot.callbackQuery(/^mod_action:(-?\d+):(\w+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const chatId = parseInt(ctx.match[1]);
    const category = ctx.match[2];

    const isAdmin = await verifyAdmin(ctx, chatId, userId);
    if (!isAdmin) {
      await ctx.answerCallbackQuery("Admin only");
      return;
    }

    // Show action selection keyboard
    const keyboard = new InlineKeyboard();
    const actions: ModerationAction[] = [
      "none",
      "delete",
      "warn",
      "mute",
      "ban",
    ];

    for (const action of actions) {
      const { emoji, label } = ACTION_INFO[action];
      keyboard
        .text(
          `${emoji} ${label}`,
          `mod_set_action:${chatId}:${category}:${action}`,
        )
        .row();
    }
    keyboard.text("« Back", `mod_settings:${chatId}`);

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `⚙️ <b>Action for ${CATEGORY_INFO[category as ContentCategory]?.label || category}</b>\n\n` +
        `Select what to do when this content is detected:`,
      { parse_mode: "HTML", reply_markup: keyboard },
    );
  });

  // Set action
  bot.callbackQuery(/^mod_set_action:(-?\d+):(\w+):(\w+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const chatId = parseInt(ctx.match[1]);
    const category = ctx.match[2];
    const action = ctx.match[3] as ModerationAction;

    const isAdmin = await verifyAdmin(ctx, chatId, userId);
    if (!isAdmin) {
      await ctx.answerCallbackQuery("Admin only");
      return;
    }

    const settings = await getModerationSettings(env.SESSIONS, chatId);
    if (!settings) return;

    const key = `${category}Action` as keyof ModerationSettings;
    if (key in settings) {
      (settings as unknown as Record<string, unknown>)[key] = action;
      await saveModerationSettings(env.SESSIONS, settings);
    }

    await ctx.answerCallbackQuery(`Action set to ${action}`);
    await showModerationSettings(ctx, env, chatId);
  });

  // Actions menu
  bot.callbackQuery(/^mod_actions_menu:(-?\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const chatId = parseInt(ctx.match[1]);

    const isAdmin = await verifyAdmin(ctx, chatId, userId);
    if (!isAdmin) {
      await ctx.answerCallbackQuery("Admin only");
      return;
    }

    const settings = await getModerationSettings(env.SESSIONS, chatId);
    if (!settings) {
      await ctx.answerCallbackQuery("Settings not found");
      return;
    }

    const keyboard = new InlineKeyboard();

    // Show action settings for each category
    const categories = ["spam", "scam", "hate", "flood", "links"] as const;
    for (const cat of categories) {
      const actionKey = `${cat}Action` as keyof typeof settings;
      const action = settings[actionKey] as string;
      const actionInfo = ACTION_INFO[action as keyof typeof ACTION_INFO];
      keyboard
        .text(
          `${CATEGORY_INFO[cat].emoji} ${CATEGORY_INFO[cat].label} → ${actionInfo?.emoji || "?"} ${actionInfo?.label || action}`,
          `mod_action:${chatId}:${cat}`,
        )
        .row();
    }

    keyboard.text("« Back", `mod_settings:${chatId}`);

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `⚙️ <b>Configure Actions</b>\n\n` +
        `Select a category to change its action:`,
      { parse_mode: "HTML", reply_markup: keyboard },
    );
  });

  // Back to settings
  bot.callbackQuery(/^mod_settings:(-?\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const chatId = parseInt(ctx.match[1]);

    // Verify user has access
    const isAdmin = await verifyAdmin(ctx, chatId, userId);
    if (!isAdmin) {
      await ctx.answerCallbackQuery("Admin only");
      return;
    }

    await ctx.answerCallbackQuery();
    await showModerationSettings(ctx, env, chatId);
  });

  // Select chat from private
  bot.callbackQuery(/^mod_select:(-?\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const chatId = parseInt(ctx.match[1]);

    // Verify user has access
    const isAdmin = await verifyAdmin(ctx, chatId, userId);
    if (!isAdmin) {
      await ctx.answerCallbackQuery("You don't have access to this chat");
      return;
    }

    await ctx.answerCallbackQuery();
    await showModerationSettings(ctx, env, chatId);
  });

  // /modstats command
  bot.command("modstats", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    // In group - show stats for this group
    if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
      const isAdmin = await verifyAdmin(ctx, chatId, userId);
      if (!isAdmin) {
        await ctx.reply("Only admins can view moderation stats.");
        return;
      }

      await showModerationStats(ctx, env, chatId);
    } else {
      // In private - list groups
      const chats = await getUserManagedChats(env.SESSIONS, userId);
      if (chats.length === 0) {
        await ctx.reply(
          "📊 <b>Moderation Stats</b>\n\n" +
            "No groups configured yet.\n" +
            "Add me to a group and use /moderate to set up.",
          { parse_mode: "HTML" },
        );
        return;
      }

      const keyboard = new InlineKeyboard();
      for (const chat of chats) {
        keyboard.text(`📊 ${chat.chatTitle}`, `mod_stats:${chat.chatId}`).row();
      }

      await ctx.reply("Select a group to view stats:", {
        reply_markup: keyboard,
      });
    }
  });

  // Stats callback
  bot.callbackQuery(/^mod_stats:(-?\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const chatId = parseInt(ctx.match[1]);

    // Verify user has access
    const isAdmin = await verifyAdmin(ctx, chatId, userId);
    if (!isAdmin) {
      await ctx.answerCallbackQuery("Admin only");
      return;
    }

    await ctx.answerCallbackQuery();
    await showModerationStats(ctx, env, chatId);
  });

  // /whitelist command
  bot.command("whitelist", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
      await ctx.reply("Use this command in a group chat.");
      return;
    }

    const isAdmin = await verifyAdmin(ctx, chatId, userId);
    if (!isAdmin) {
      await ctx.reply("Only admins can manage whitelist.");
      return;
    }

    const args = ctx.message?.text?.split(" ").slice(1);
    if (!args || args.length === 0) {
      const settings = await getModerationSettings(env.SESSIONS, chatId);
      const userCount = settings?.whitelistedUsers.length || 0;
      const domainCount = settings?.whitelistedDomains.length || 0;

      await ctx.reply(
        `📋 <b>Whitelist</b>\n\n` +
          `Users: ${userCount}\n` +
          `Domains: ${domainCount}\n\n` +
          `Usage:\n` +
          `<code>/whitelist add @username</code> - Add user\n` +
          `<code>/whitelist remove @username</code> - Remove user\n` +
          `<code>/whitelist domain example.com</code> - Add domain\n` +
          `<code>/whitelist list</code> - Show all`,
        { parse_mode: "HTML" },
      );
      return;
    }

    const action = args[0].toLowerCase();
    const target = args[1];

    const settings = await getOrCreateSettings(
      env.SESSIONS,
      chatId,
      ctx.chat.title || "Group",
    );

    switch (action) {
      case "add":
        // Check if replying to a message - get user ID from that
        const replyMsg = ctx.message?.reply_to_message;
        if (replyMsg?.from) {
          const targetUserId = replyMsg.from.id;
          const targetUsername =
            replyMsg.from.username || replyMsg.from.first_name;
          if (!settings.whitelistedUsers.includes(targetUserId)) {
            settings.whitelistedUsers.push(targetUserId);
            await saveModerationSettings(env.SESSIONS, settings);
            await ctx.reply(
              `✅ Added ${targetUsername} (ID: ${targetUserId}) to whitelist.`,
            );
          } else {
            await ctx.reply(
              `⚠️ User ${targetUsername} is already in whitelist.`,
            );
          }
          return;
        }

        // Try to parse as numeric ID
        if (target && /^\d+$/.test(target)) {
          const targetUserId = parseInt(target);
          if (!settings.whitelistedUsers.includes(targetUserId)) {
            settings.whitelistedUsers.push(targetUserId);
            await saveModerationSettings(env.SESSIONS, settings);
            await ctx.reply(`✅ Added user ID ${targetUserId} to whitelist.`);
          } else {
            await ctx.reply(
              `⚠️ User ID ${targetUserId} is already in whitelist.`,
            );
          }
          return;
        }

        await ctx.reply(
          "Usage: Reply to a user's message with /whitelist add\n" +
            "Or: /whitelist add <user_id>",
        );
        break;

      case "remove":
        if (!target) {
          await ctx.reply("Usage: /whitelist remove <user_id>");
          return;
        }

        const removeId = parseInt(target);
        if (isNaN(removeId)) {
          await ctx.reply("Please provide a numeric user ID.");
          return;
        }

        const index = settings.whitelistedUsers.indexOf(removeId);
        if (index > -1) {
          settings.whitelistedUsers.splice(index, 1);
          await saveModerationSettings(env.SESSIONS, settings);
          await ctx.reply(`✅ Removed user ID ${removeId} from whitelist.`);
        } else {
          await ctx.reply(`⚠️ User ID ${removeId} is not in whitelist.`);
        }
        break;

      case "domain":
        if (!target) {
          await ctx.reply("Usage: /whitelist domain example.com");
          return;
        }
        if (!settings.whitelistedDomains.includes(target)) {
          settings.whitelistedDomains.push(target);
          await saveModerationSettings(env.SESSIONS, settings);
        }
        await ctx.reply(`✅ Domain ${target} added to whitelist.`);
        break;

      case "list":
        let msg = `📋 <b>Whitelist</b>\n\n`;
        msg += `<b>Users:</b>\n`;
        if (settings.whitelistedUsers.length === 0) {
          msg += `<i>None</i>\n`;
        } else {
          for (const id of settings.whitelistedUsers) {
            msg += `• ${id}\n`;
          }
        }
        msg += `\n<b>Domains:</b>\n`;
        if (settings.whitelistedDomains.length === 0) {
          msg += `<i>None</i>\n`;
        } else {
          for (const domain of settings.whitelistedDomains) {
            msg += `• ${domain}\n`;
          }
        }
        await ctx.reply(msg, { parse_mode: "HTML" });
        break;

      default:
        await ctx.reply("Unknown action. Use: add, remove, domain, list");
    }
  });

  // Handle bot added to group — initialize moderation settings, then pass to next handler
  bot.on("my_chat_member", async (ctx, next) => {
    const update = ctx.myChatMember!;
    const newStatus = update.new_chat_member.status;
    const chatId = ctx.chat.id;
    const chatTitle =
      ("title" in ctx.chat ? ctx.chat.title : undefined) || "Group";
    const userId = ctx.from?.id;

    if (newStatus === "administrator" || newStatus === "member") {
      // Bot added to group - initialize moderation settings
      await getOrCreateSettings(env.SESSIONS, chatId, chatTitle);

      // If user is identifiable, add to their managed chats
      if (userId) {
        await addUserManagedChat(env.SESSIONS, userId, chatId, chatTitle);
      }
    }

    // IMPORTANT: pass to the next my_chat_member handler (index.ts)
    // which handles chat tracking, proactive auto-enable, and welcome message
    await next();
  });
}

/**
 * Handle moderation setup in a group
 */
async function handleGroupModeration(ctx: Context, env: Env): Promise<void> {
  const chatId = ctx.chat!.id;
  const userId = ctx.from!.id;
  const chatTitle = ctx.chat!.title || "Group";

  // Check if user is admin
  const isAdmin = await verifyAdmin(ctx, chatId, userId);
  if (!isAdmin) {
    await ctx.reply("⚠️ Only group administrators can configure moderation.");
    return;
  }

  // Check if bot is admin
  const botMember = await ctx.api.getChatMember(chatId, ctx.me.id);
  if (botMember.status !== "administrator") {
    await ctx.reply(
      "⚠️ I need to be an administrator to moderate this group.\n\n" +
        "Please make me admin with these permissions:\n" +
        "• Delete messages\n" +
        "• Restrict members (for mute/ban)",
    );
    return;
  }

  // Get or create settings
  await getOrCreateSettings(env.SESSIONS, chatId, chatTitle);

  // Add to user's managed chats
  await addUserManagedChat(env.SESSIONS, userId, chatId, chatTitle);

  // Show settings
  await showModerationSettings(ctx, env, chatId);
}

/**
 * Handle moderation from private chat
 */
async function handlePrivateModeration(ctx: Context, env: Env): Promise<void> {
  const userId = ctx.from!.id;

  const chats = await getUserManagedChats(env.SESSIONS, userId);

  if (chats.length === 0) {
    await ctx.reply(
      "🛡️ <b>Community Manager</b>\n\n" +
        "You don't have any groups to manage yet.\n\n" +
        "To set up moderation:\n" +
        "1. Add me to your group as admin\n" +
        "2. Use /moderate in the group\n\n" +
        "Or add me to a group and I'll detect it automatically!",
      { parse_mode: "HTML" },
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const chat of chats) {
    keyboard.text(`⚙️ ${chat.chatTitle}`, `mod_select:${chat.chatId}`).row();
  }

  await ctx.reply(
    "🛡️ <b>Community Manager</b>\n\n" + "Select a group to configure:",
    { parse_mode: "HTML", reply_markup: keyboard },
  );
}

/**
 * Show moderation settings for a chat
 */
async function showModerationSettings(
  ctx: Context,
  env: Env,
  chatId: number,
): Promise<void> {
  const settings = await getModerationSettings(env.SESSIONS, chatId);
  if (!settings) {
    if (ctx.callbackQuery) {
      await ctx.editMessageText(
        "Settings not found. Use /moderate in the group first.",
      );
    } else {
      await ctx.reply("Settings not found. Use /moderate in the group first.");
    }
    return;
  }

  const statusIcon = settings.enabled ? "✅" : "❌";
  const statusText = settings.enabled ? "ENABLED" : "DISABLED";

  let message = `🛡️ <b>Moderation Settings</b>\n`;
  message += `📍 ${settings.chatTitle}\n\n`;
  message += `Status: ${statusIcon} <b>${statusText}</b>\n\n`;

  message += `<b>Detection:</b>\n`;
  message += `${settings.detectSpam ? "✅" : "❌"} Spam → ${ACTION_INFO[settings.spamAction].emoji}\n`;
  message += `${settings.detectScam ? "✅" : "❌"} Scam → ${ACTION_INFO[settings.scamAction].emoji}\n`;
  message += `${settings.detectHate ? "✅" : "❌"} Hate speech → ${ACTION_INFO[settings.hateAction].emoji}\n`;
  message += `${settings.detectFlood ? "✅" : "❌"} Flood → ${ACTION_INFO[settings.floodAction].emoji}\n`;
  message += `${settings.detectLinks ? "✅" : "❌"} Links → ${ACTION_INFO[settings.linksAction].emoji}\n`;

  const keyboard = new InlineKeyboard();

  // Enable/disable toggle
  keyboard
    .text(settings.enabled ? "🔴 Disable" : "🟢 Enable", `mod_toggle:${chatId}`)
    .row();

  // Detection toggles
  keyboard.text(
    `${settings.detectSpam ? "✅" : "❌"} Spam`,
    `mod_detect:${chatId}:spam`,
  );
  keyboard
    .text(
      `${settings.detectScam ? "✅" : "❌"} Scam`,
      `mod_detect:${chatId}:scam`,
    )
    .row();

  keyboard.text(
    `${settings.detectHate ? "✅" : "❌"} Hate`,
    `mod_detect:${chatId}:hate`,
  );
  keyboard
    .text(
      `${settings.detectFlood ? "✅" : "❌"} Flood`,
      `mod_detect:${chatId}:flood`,
    )
    .row();

  keyboard
    .text(
      `${settings.detectLinks ? "✅" : "❌"} Links`,
      `mod_detect:${chatId}:links`,
    )
    .row();

  // Action settings
  keyboard.text("⚙️ Configure Actions", `mod_actions_menu:${chatId}`).row();

  // Stats
  keyboard.text("📊 View Stats", `mod_stats:${chatId}`).row();

  if (ctx.callbackQuery) {
    await ctx.editMessageText(message, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } else {
    await ctx.reply(message, { parse_mode: "HTML", reply_markup: keyboard });
  }
}

/**
 * Show moderation statistics
 */
async function showModerationStats(
  ctx: Context,
  env: Env,
  chatId: number,
): Promise<void> {
  const settings = await getModerationSettings(env.SESSIONS, chatId);
  const stats = await getModerationStats(env.SESSIONS, chatId);

  let message = `📊 <b>Moderation Stats</b>\n`;
  message += `📍 ${settings?.chatTitle || "Group"}\n\n`;

  message += `<b>Overview:</b>\n`;
  message += `• Total actions: ${stats.total}\n`;
  message += `• Last 24 hours: ${stats.last24h}\n\n`;

  if (stats.total > 0) {
    message += `<b>By Category:</b>\n`;
    for (const [cat, count] of Object.entries(stats.byCategory)) {
      const info = CATEGORY_INFO[cat as ContentCategory];
      message += `• ${info?.emoji || "•"} ${info?.label || cat}: ${count}\n`;
    }
    message += `\n`;

    message += `<b>By Action:</b>\n`;
    for (const [action, count] of Object.entries(stats.byAction)) {
      const info = ACTION_INFO[action as ModerationAction];
      message += `• ${info?.emoji || "•"} ${info?.label || action}: ${count}\n`;
    }
  } else {
    message += `<i>No moderation actions recorded yet.</i>\n`;
  }

  const keyboard = new InlineKeyboard();
  keyboard.text("« Back to Settings", `mod_settings:${chatId}`);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(message, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } else {
    await ctx.reply(message, { parse_mode: "HTML", reply_markup: keyboard });
  }
}
