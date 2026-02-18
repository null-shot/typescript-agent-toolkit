/**
 * Core Bot Handlers
 *
 * Shared inline handler registrations used by BOTH telegram-bot-agent
 * and single-worker. Extracted to eliminate code duplication.
 *
 * Includes:
 * - Owner-gate middleware (blocks non-owners from admin commands)
 * - All setup*Handler calls (agent, channel, schedule, moderation, etc.)
 * - Auto-track bot membership (my_chat_member)
 * - Auto-register channels (channel_post)
 * - Auto-enable proactive mode and moderation in groups
 * - Welcome messages when bot joins groups
 * - Greet new members in groups
 * - Owner commands: /mychats, /scan, /loghere, /logstop, /setowner
 * - Core commands: /start, /help, /status, /clear
 * - Text message handler (routes to handleMessage)
 * - Error handler (bot.catch)
 */

import { Bot } from "grammy";
import { handleMessage } from "./message-handler";
import {
  transcribeVoice,
  synthesizeSpeech,
  downloadVoiceFile,
  sendVoiceResponse,
  detectLanguageForTTS,
  isTTSSupported,
  isVoiceProcessable,
} from "../utils/voice-handler";
import { getOrCreateSessionData } from "../utils/session";
import {
  setupAgentHandlers,
  getAvailableAgents,
  getCurrentAgentName,
  getCurrentAgentUrl,
} from "./agent-handler";
import { setupChannelHandlers } from "./channel-handler";
import { setupScheduleHandlers } from "./schedule-handler";
import { setupModerationHandlers } from "./moderation-handler";
import { setupProactiveHandlers } from "./proactive-handler";
import { setupSetupHandlers } from "./setup-handler";
import { setupTaskHandlers } from "./task-handler";
import {
  TelegramLog,
  setLogChatId,
  removeLogChatId,
} from "../utils/telegram-logger";
import {
  upsertBotChat,
  removeBotChat,
  getPostableBotChats,
  getBotChannels,
  getBotGroups,
  ensureChatRegistered,
  removeStaleBotChat,
  type BotChat,
} from "../utils/bot-chats-storage";
import {
  isOwner,
  claimOwnerIfUnset,
  transferOwnership,
  OWNER_ONLY_COMMANDS,
  getOwnerId,
} from "../utils/owner";
import { formatError } from "../utils/helpers";
import {
  getPendingApprovals,
  getPendingEscalations,
} from "../utils/kanban-storage";
import {
  enableProactiveMode,
  getProactiveSettings,
} from "../utils/proactive-storage";
import {
  getOrCreateSettings,
  toggleModeration,
} from "../utils/moderation-storage";
import { loadBotProfile } from "../utils/knowledge-base";
import type { TelegramBotEnv } from "../types/env";

// ============================================================================
// TYPES
// ============================================================================

/** Mutable reference to the per-request TelegramLog instance */
export interface LogRef {
  current?: TelegramLog;
}

/**
 * Optional hooks for extending core handler behavior.
 * Used by single-worker to add dashboard-specific features.
 */
export interface CoreHandlerHooks {
  /**
   * Called during /start for any user in private chats.
   * Returns additional HTML text to append to the welcome message.
   * The hook itself should decide if the user qualifies (e.g., isAdmin check).
   * Example: dashboard PIN generation for admins.
   */
  onPrivateStart?: (
    ctx: any,
    env: TelegramBotEnv,
  ) => Promise<string>;

  /**
   * Register additional bot commands after core handlers.
   * Called once during setup.
   * Example: /pin command for dashboard PIN regeneration.
   */
  registerExtraCommands?: (
    bot: Bot,
    env: TelegramBotEnv,
    logRef: LogRef,
  ) => void;
}

// ============================================================================
// MAIN SETUP FUNCTION
// ============================================================================

/**
 * Register all core bot handlers on the Grammy bot instance.
 *
 * Two-level access:
 * - Admin commands are gated behind isOwner() check
 * - User-facing commands (start, help, status, clear) are available to all
 *
 * @param bot    Grammy Bot instance
 * @param env    Telegram bot environment (tokens, KV, agent config)
 * @param logRef Mutable ref to per-request TelegramLog
 * @param hooks  Optional hooks for extending behavior (dashboard integration)
 */
export function setupCoreHandlers(
  bot: Bot,
  env: TelegramBotEnv,
  logRef: LogRef,
  hooks?: CoreHandlerHooks,
): void {
  // ─── Owner-gate middleware ──────────────────────────────────────
  // Intercepts all owner-only commands and blocks non-owners.
  // Must be registered BEFORE the individual handlers.
  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;
    if (!text.startsWith("/")) return next();

    // Extract command name: "/command@botname args" → "command"
    const commandMatch = text.match(/^\/([a-zA-Z0-9_]+)/);
    if (!commandMatch) return next();
    const command = commandMatch[1].toLowerCase();

    // If not an owner-only command, let it through
    if (!OWNER_ONLY_COMMANDS.has(command)) return next();

    // Owner check
    const userIsOwner = await isOwner(env, ctx.from?.id);
    if (userIsOwner) return next();

    // Non-owner trying to use owner command → block
    await ctx.reply("⚠️ This command is only available to the bot owner.");
  });

  // ─── Handler registration ──────────────────────────────────────

  // Setup agent selection handlers first
  setupAgentHandlers(bot, env);

  // Setup channel management handlers (Social Media Manager)
  setupChannelHandlers(bot, env);

  // Setup scheduled posts handlers
  setupScheduleHandlers(bot, env);

  // Setup moderation handlers (Community Manager)
  setupModerationHandlers(bot, env);

  // Setup proactive mode handlers (Auto-respond in groups)
  setupProactiveHandlers(bot, env);

  // Setup wizard handlers (Role-based configuration)
  setupSetupHandlers(bot, env);

  // Setup task handlers (kanban-based task management + callbacks)
  setupTaskHandlers(bot, env, logRef);

  // Get available agents for display
  const agents = getAvailableAgents(env);
  const agentCount = agents.length;

  // ─── Auto-register channels on post ────────────────────────────
  bot.on("channel_post", async (ctx) => {
    const chat = ctx.chat;
    if (!chat || chat.type !== "channel") return;
    try {
      const wasNew = await ensureChatRegistered(
        env.SESSIONS,
        chat.id,
        chat.title || `Channel ${chat.id}`,
        "channel",
        "username" in chat ? chat.username : undefined,
      );
      if (wasNew) {
        logRef.current?.info(`Auto-registered channel "${chat.title}" on first post`);
      }
    } catch {
      /* non-critical */
    }
  });

  // ─── Auto-track bot membership ─────────────────────────────────

  // When the bot is added/removed/promoted in a chat, Telegram sends my_chat_member
  bot.on("my_chat_member", async (ctx) => {
    const update = ctx.myChatMember;
    const chat = update.chat;
    const newStatus = update.new_chat_member.status;
    const oldStatus = update.old_chat_member.status;
    const addedBy = update.from?.id;

    // Extract optional fields via safe narrowing (only groups/channels have title/username)
    const chatTitle = ("title" in chat ? chat.title : undefined) ?? `Chat ${chat.id}`;
    const chatUsername = "username" in chat ? chat.username : undefined;

    logRef.current?.header(`my_chat_member: ${chatTitle}`);
    logRef.current?.step(`Status: ${oldStatus} → ${newStatus}`);

    if (newStatus === "left" || newStatus === "kicked") {
      // Bot removed from chat
      await removeBotChat(env.SESSIONS, chat.id);
      logRef.current?.info(`Bot removed from "${chatTitle}"`);
      return;
    }

    // Determine bot capabilities
    const canPost =
      newStatus === "administrator" || newStatus === "creator"
        ? true
        : newStatus === "member"
          ? chat.type !== "channel" // Members can post in groups but not channels
          : false;

    const chatType =
      chat.type === "channel"
        ? "channel"
        : chat.type === "supergroup"
          ? "supergroup"
          : "group";

    const botChat: BotChat = {
      chatId: chat.id,
      title: chatTitle,
      type: chatType,
      username: chatUsername,
      role: newStatus as BotChat["role"],
      canPost,
      addedBy,
      updatedAt: Date.now(),
    };

    await upsertBotChat(env.SESSIONS, botChat);

    logRef.current?.ok(
      `Tracked: "${botChat.title}" (${chatType}, ${newStatus}, canPost: ${canPost})`,
    );

    // ── Auto-enable features in groups (plug & play) ──────────────
    // Triggers on:
    // 1. Bot first added as member or admin (old: left/kicked → new: member/admin)
    // 2. Bot promoted from member to admin (old: member → new: admin)
    const isGroup = chatType === "group" || chatType === "supergroup";
    const justJoined =
      (newStatus === "administrator" || newStatus === "member") &&
      oldStatus !== "administrator" &&
      oldStatus !== "member";
    const justPromoted =
      newStatus === "administrator" && oldStatus === "member";
    const isBotAdmin = newStatus === "administrator";

    if (isGroup && (justJoined || justPromoted)) {
      // Auto-enable proactive support mode (only on first join, not on promotion)
      if (justJoined) {
        try {
          const existingSettings = await getProactiveSettings(
            env.SESSIONS,
            chat.id,
          );
          if (!existingSettings || !existingSettings.enabled) {
            await enableProactiveMode(
              env.SESSIONS,
              chat.id,
              chatTitle,
              "support",
            );
            logRef.current?.ok(
              `Auto-enabled proactive "support" mode for "${chatTitle}"`,
            );
          }
        } catch (error) {
          logRef.current?.error(
            `Failed to auto-enable proactive: ${formatError(error)}`,
          );
        }
      }

      // Auto-enable moderation when bot becomes admin (first add OR promotion)
      if (isBotAdmin) {
        try {
          await getOrCreateSettings(env.SESSIONS, chat.id, chatTitle);
          const modResult = await toggleModeration(
            env.SESSIONS,
            chat.id,
            true,
          );
          if (modResult) {
            logRef.current?.ok(
              `Auto-enabled moderation for "${chatTitle}" (admin)`,
            );
          }
        } catch (error) {
          logRef.current?.error(
            `Failed to auto-enable moderation: ${formatError(error)}`,
          );
        }
      }

      // Send welcome / promotion message
      try {
        const moderationNote = isBotAdmin
          ? `\n🛡️ <b>Moderation is active</b> — I'll filter spam automatically.\n`
          : "";
        const statusText = justPromoted
          ? `I've been promoted to admin in <b>${chatTitle}</b>.`
          : `I'm now active in <b>${chatTitle}</b>${isBotAdmin ? " as an admin" : ""}.`;
        await ctx.api.sendMessage(
          chat.id,
          `👋 ${statusText}\n` +
            moderationNote +
            `\n<b>How to interact with me:</b>\n` +
            `• Mention @${ctx.me.username} — I'll always reply\n` +
            `• Reply to my message — I'll continue the conversation\n` +
            `• Ask a question — I may jump in to help\n\n` +
            `Everything works out of the box. Just chat!`,
          { parse_mode: "HTML" },
        );
        logRef.current?.ok(`${justPromoted ? "Promotion" : "Welcome"} message sent to "${chatTitle}"`);
      } catch (error) {
        logRef.current?.error(
          `Failed to send welcome: ${formatError(error)}`,
        );
      }
    }
  });

  // ─── Greet new members in groups ──────────────────────────────
  // When someone joins a group, send a short welcome if proactive mode is active.
  bot.on("message:new_chat_members", async (ctx) => {
    const chatId = ctx.chat?.id;
    const chatType = ctx.chat?.type;
    if (!chatId) return;

    // Only in groups
    if (chatType !== "group" && chatType !== "supergroup") return;

    // Check if proactive mode is enabled for this group
    const settings = await getProactiveSettings(env.SESSIONS, chatId);
    if (!settings?.enabled) return;

    // Don't greet the bot itself
    const newMembers = ctx.message.new_chat_members.filter(
      (m) => m.id !== ctx.me.id,
    );
    if (newMembers.length === 0) return;

    const names = newMembers
      .map((m) => m.first_name || m.username || "friend")
      .join(", ");

    try {
      await ctx.reply(
        `Welcome, ${names}! 👋 Feel free to ask if you have any questions.`,
      );
      logRef.current?.info(`Greeted new members: ${names}`);
    } catch (error) {
      logRef.current?.error(
        `Failed to greet new members: ${formatError(error)}`,
      );
    }
  });

  // ─── Owner commands ───────────────────────────────────────────

  // /mychats — list all chats where bot is admin
  // (owner-gate middleware blocks non-owners before reaching here)
  bot.command("mychats", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    logRef.current?.header(
      `/mychats from @${ctx.from?.username || "unknown"}`,
    );

    const channels = await getBotChannels(env.SESSIONS);
    const groups = await getBotGroups(env.SESSIONS);

    if (channels.length === 0 && groups.length === 0) {
      await ctx.reply(
        `📋 <b>No chats tracked yet.</b>\n\n` +
          `Add the bot to a group or channel as admin — it will appear here automatically.`,
        { parse_mode: "HTML" },
      );
      logRef.current?.info("No tracked chats");
      return;
    }

    let text = `📋 <b>Bot Chats</b>\n\n`;

    if (channels.length > 0) {
      text += `<b>📢 Channels (${channels.length}):</b>\n`;
      for (const ch of channels) {
        const username = ch.username ? ` @${ch.username}` : "";
        text += `• ${ch.title}${username}\n`;
      }
      text += `\n`;
    }

    if (groups.length > 0) {
      text += `<b>💬 Groups (${groups.length}):</b>\n`;
      for (const gr of groups) {
        const username = gr.username ? ` @${gr.username}` : "";
        text += `• ${gr.title}${username}\n`;
      }
      text += `\n`;
    }

    text += `The bot can publish posts to all these chats.`;

    await ctx.reply(text, { parse_mode: "HTML" });
    logRef.current?.ok(
      `Listed ${channels.length} channels, ${groups.length} groups`,
    );
  });

  // /scan — manually discover chats where the bot is admin
  bot.command("scan", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    logRef.current?.header(`/scan from @${ctx.from?.username || "unknown"}`);

    await ctx.reply("🔍 Scanning bot chats...");

    // Parse arguments for explicit chat IDs
    const text = ctx.message?.text || "";
    const args = text.split(/\s+/).slice(1); // everything after /scan
    const explicitIds: number[] = args
      .map((a) => parseInt(a, 10))
      .filter((n) => !isNaN(n));

    // Get all currently tracked chats
    const existing = await getPostableBotChats(env.SESSIONS);
    const chatIdsToCheck = new Set<number>(existing.map((c) => c.chatId));

    // Add explicitly requested IDs
    for (const eid of explicitIds) {
      chatIdsToCheck.add(eid);
    }

    // Also add the current chat if it's a group/channel
    const chatTypeStr = ctx.chat?.type;
    if (
      chatTypeStr === "group" ||
      chatTypeStr === "supergroup" ||
      chatTypeStr === "channel"
    ) {
      chatIdsToCheck.add(chatId);
    }

    let foundCount = 0;
    const results: string[] = [];

    for (const targetChatId of chatIdsToCheck) {
      try {
        const botInfo = await ctx.api.getChatMember(targetChatId, ctx.me.id);
        const chatInfo = await ctx.api.getChat(targetChatId);
        const title = ("title" in chatInfo ? chatInfo.title : undefined) ?? `Chat ${targetChatId}`;
        const type = chatInfo.type;
        const username = "username" in chatInfo ? chatInfo.username : undefined;
        const status = botInfo.status;
        const canPost = status === "administrator" || status === "creator";

        const chatEntry: BotChat = {
          chatId: targetChatId,
          title,
          type:
            type === "channel"
              ? "channel"
              : type === "supergroup"
                ? "supergroup"
                : "group",
          username,
          role: status as BotChat["role"],
          canPost,
          addedBy: ctx.from?.id,
          updatedAt: Date.now(),
        };

        await upsertBotChat(env.SESSIONS, chatEntry);
        foundCount++;

        const icon = type === "channel" ? "📢" : "💬";
        results.push(
          `${icon} ${title} — ${status}${canPost ? " ✅" : ""}`,
        );
        logRef.current?.ok(`Found: ${title} (${type}, ${status})`);
      } catch (error) {
        const errMsg = formatError(error);
        logRef.current?.warn(
          `Failed to check ${targetChatId}: ${errMsg}`,
        );

        // Auto-cleanup: remove stale entries the bot can no longer access
        const isGone =
          errMsg.includes("chat not found") ||
          errMsg.includes("bot was kicked") ||
          errMsg.includes("bot is not a member");
        if (isGone) {
          const removed = await removeStaleBotChat(env.SESSIONS, targetChatId);
          if (removed) {
            results.push(`🗑️ Removed stale chat ${targetChatId} (${errMsg})`);
            logRef.current?.warn(`Removed stale chat ${targetChatId}`);
          }
        }
      }
    }

    if (foundCount === 0 && results.length === 0) {
      await ctx.reply(
        "📋 No new chats found.\n\n" +
          "For the bot to discover a channel/group:\n" +
          "1. Add the bot as an admin\n" +
          "2. Send /scan <i>chat_id</i> here\n" +
          "3. Or remove/re-add the bot — it will detect the change automatically",
        { parse_mode: "HTML" },
      );
    } else {
      const staleRemoved = results.filter((r) => r.startsWith("🗑️")).length;
      const summary = staleRemoved > 0
        ? `✅ <b>${foundCount} chat(s) verified</b>, 🗑️ <b>${staleRemoved} stale removed</b>\n\n${results.join("\n")}\n\n` +
          `Use /mychats for the full list.`
        : `✅ <b>Found ${foundCount} chats</b>\n\n${results.join("\n")}\n\n` +
          `Use /mychats for the full list.`;
      await ctx.reply(summary, { parse_mode: "HTML" },
      );
    }
  });

  // ─── Logging commands (owner only) ─────────────────────────────

  bot.command("loghere", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    await setLogChatId(env.SESSIONS, chatId.toString());
    await ctx.reply(
      `📋 <b>Logging enabled!</b>\n\n` +
        `All bot activity logs will be sent to this chat.\n` +
        `Use /logstop to disable.`,
      { parse_mode: "HTML" },
    );

    // Send a test log
    const testLog = new TelegramLog(
      env.TELEGRAM_BOT_TOKEN,
      chatId.toString(),
    );
    testLog.header("Log system activated");
    testLog.ok("This chat is now the log target");
    testLog.info(`Chat ID: ${chatId}`);
    await testLog.flush();
  });

  bot.command("logstop", async (ctx) => {
    await removeLogChatId(env.SESSIONS);
    await ctx.reply(
      `🔕 <b>Logging disabled.</b>\n\nUse /loghere to re-enable.`,
      { parse_mode: "HTML" },
    );
  });

  // ─── Ownership commands (owner only) ────────────────────────────

  bot.command("setowner", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const argsText = ctx.message?.text?.split(" ").slice(1).join(" ").trim();
    if (!argsText) {
      await ctx.reply(
        `🔑 <b>Transfer Ownership</b>\n\n` +
          `Usage: <code>/setowner USER_ID</code>\n\n` +
          `The new owner must have already messaged the bot.\n` +
          `You can get a user's ID from @userinfobot.`,
        { parse_mode: "HTML" },
      );
      return;
    }

    const newOwnerId = parseInt(argsText, 10);
    if (isNaN(newOwnerId)) {
      await ctx.reply("❌ Invalid user ID. Must be a number.");
      return;
    }

    await transferOwnership(env, newOwnerId);
    await ctx.reply(
      `✅ <b>Ownership transferred</b> to user <code>${newOwnerId}</code>.\n\n` +
        `You no longer have admin access.`,
      { parse_mode: "HTML" },
    );
    logRef.current?.info(
      `Ownership transferred from ${userId} to ${newOwnerId}`,
    );
  });

  // ─── Register extra commands from hooks (e.g., /pin) ──────────
  if (hooks?.registerExtraCommands) {
    hooks.registerExtraCommands(bot, env, logRef);
  }

  // ─── Core commands ─────────────────────────────────────────────

  // Start command handler
  bot.command("start", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const userName = ctx.from?.first_name || "User";
    const username = ctx.from?.username;
    const userId = ctx.from?.id;

    // Auto-claim: first user to /start in DM becomes owner (if no owner set)
    let justClaimed = false;
    if (userId && ctx.chat?.type === "private") {
      const wasOwnerBefore = await getOwnerId(env);
      if (!wasOwnerBefore) {
        justClaimed = await claimOwnerIfUnset(env, userId);
        if (justClaimed) {
          logRef.current?.info(
            `Owner auto-claimed: ${username ? "@" + username : userId}`,
          );
        }
      }
    }

    const userIsOwner = await isOwner(env, userId);

    logRef.current?.header(
      `/start from ${username ? "@" + username : userName}${userIsOwner ? " [OWNER]" : ""}`,
    );
    logRef.current?.step(`User started bot (chat: ${chatId})`);

    // Get or create session for this chat
    await getOrCreateSessionData(env.SESSIONS, chatId.toString());

    // Get current agent name
    const currentAgentName = await getCurrentAgentName(
      env,
      chatId.toString(),
    );

    logRef.current?.info(`Agent: ${currentAgentName}`);
    logRef.current?.ok("Welcome message sent");

    if (userIsOwner) {
      // Owner welcome — show admin features + pending items
      let pendingNotice = "";
      try {
        const approvals = await getPendingApprovals(env.SESSIONS);
        const escalations = await getPendingEscalations(env.SESSIONS);
        if (approvals.length > 0 || escalations.length > 0) {
          pendingNotice = `\n📬 <b>Pending:</b>`;
          if (approvals.length > 0)
            pendingNotice += ` ${approvals.length} approval(s)`;
          if (escalations.length > 0)
            pendingNotice += ` ${escalations.length} escalation(s)`;
          pendingNotice += `\nUse /tasks to review.\n`;
        }
      } catch {
        /* non-critical */
      }

      const claimNotice = justClaimed
        ? `🔑 <b>You are now the bot owner!</b>\nYou're the first to start this bot — ownership claimed automatically.\n\n`
        : "";

      // Hook: let extensions add text (e.g., dashboard PIN)
      let hookMessage = "";
      if (hooks?.onPrivateStart && ctx.chat?.type === "private") {
        hookMessage = await hooks.onPrivateStart(ctx, env);
      }

      await ctx.reply(
        `👋 Welcome back, ${userName}!\n\n` +
          claimNotice +
          `Connected to <b>${currentAgentName}</b>.\n` +
          (agentCount > 1
            ? `📋 ${agentCount} agents available - use /agent to switch\n`
            : "") +
          pendingNotice +
          `\n<b>Quick Start:</b>\n` +
          `/tasks - View task board\n` +
          `/stats - Analytics\n` +
          `/setup - Configure bot\n` +
          `/help - All commands\n\n` +
          `💡 Try: "write a post about AI" or "start moderating"` +
          hookMessage,
        { parse_mode: "HTML" },
      );
    } else {
      // Hook for non-owners too (e.g., dashboard admin PIN)
      let hookMessage = "";
      if (hooks?.onPrivateStart && ctx.chat?.type === "private") {
        hookMessage = await hooks.onPrivateStart(ctx, env);
      }

      // User welcome — use custom from dashboard or default
      let welcomeText: string;
      try {
        const profile = await loadBotProfile(env.SESSIONS);
        const customWelcome = profile?.welcomeMessage?.trim();
        if (customWelcome) {
          welcomeText = customWelcome
            .replace(/\{\{userName\}\}/g, userName)
            .replace(/\{userName\}/g, userName);
        } else {
          welcomeText =
            `👋 Hello ${userName}!\n\n` +
            `I'm here to help. Just send me a message!\n\n` +
            `Use /help to see what I can do.`;
        }
      } catch {
        welcomeText =
          `👋 Hello ${userName}!\n\n` +
          `I'm here to help. Just send me a message!\n\n` +
          `Use /help to see what I can do.`;
      }

      await ctx.reply(welcomeText + hookMessage, { parse_mode: "HTML" });
    }
  });

  // Help command — different for owner vs users
  bot.command("help", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const userIsOwner = await isOwner(env, ctx.from?.id);

    logRef.current?.header(`/help from @${ctx.from?.username || "unknown"}`);
    logRef.current?.ok("Help message sent");

    if (userIsOwner) {
      const currentAgentName = await getCurrentAgentName(
        env,
        chatId.toString(),
      );

      await ctx.reply(
        `📚 <b>Owner Commands</b>\n\n` +
          `<b>📋 Task Board:</b>\n` +
          `/tasks - View all tasks\n` +
          `/stats - Analytics dashboard\n\n` +
          `<b>⚙️ Setup:</b>\n` +
          `/setup - Configuration wizard\n` +
          `/roles - View/change bot roles\n` +
          `/profile - Full bot configuration\n\n` +
          `<b>💬 Chat:</b>\n` +
          `/agent - Select AI agent (${agentCount} available)\n` +
          `/status - Check connection\n` +
          `/clear - Clear history\n\n` +
          `<b>📢 Content:</b>\n` +
          `/channels - List channels\n` +
          `/post - Post to channel\n` +
          `/generate - AI generate post\n` +
          `/schedule - Schedule post\n\n` +
          `<b>🛡️ Moderation:</b>\n` +
          `/moderate - Spam protection\n` +
          `/modstats - Statistics\n` +
          `/whitelist - Manage whitelist\n\n` +
          `<b>🎧 Proactive:</b>\n` +
          `/proactive - Auto-responses\n` +
          `/prompt - Bot prompt\n\n` +
          `<b>🔧 Admin:</b>\n` +
          `/mychats - Bot's chats\n` +
          `/scan - Discover chats\n` +
          `/loghere / /logstop - Logging\n\n` +
          `<b>💡 NLP commands:</b>\n` +
          `"Write a post about X" → creates task\n` +
          `"Start moderating" → enables moderation\n` +
          `"Community mode" → enables engagement\n\n` +
          `📍 Agent: <b>${currentAgentName}</b>`,
        { parse_mode: "HTML" },
      );
    } else {
      // User help — only show what they can use
      await ctx.reply(
        `📚 <b>Available Commands</b>\n\n` +
          `/start - Start over\n` +
          `/help - This message\n` +
          `/status - Check if bot is online\n` +
          `/clear - Clear conversation history\n\n` +
          `Just send me a message and I'll do my best to help!`,
        { parse_mode: "HTML" },
      );
    }
  });

  // Status command (available to all)
  bot.command("status", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const currentAgentName = await getCurrentAgentName(
      env,
      chatId.toString(),
    );

    logRef.current?.header(
      `/status from @${ctx.from?.username || "unknown"}`,
    );

    // If agent is co-located (Durable Object), it's always available
    if (env.AGENT_SERVICE) {
      logRef.current?.ok(`Agent is co-located DO (always online)`);
      await ctx.reply(
        `✅ <b>${currentAgentName}</b> is online (co-located agent).`,
        { parse_mode: "HTML" },
      );
      return;
    }

    const agentUrl = await getCurrentAgentUrl(env, chatId.toString());
    logRef.current?.step(`Checking agent: ${currentAgentName}`);
    logRef.current?.info(`URL: ${agentUrl}`);

    try {
      const startTime = Date.now();
      const response = await fetch(`${agentUrl}/`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      const duration = Date.now() - startTime;

      if (response.ok) {
        logRef.current?.ok(`Agent online (${duration}ms)`);
        await ctx.reply(
          `✅ <b>${currentAgentName}</b> is online and ready!`,
          { parse_mode: "HTML" },
        );
      } else {
        logRef.current?.warn(
          `Agent responded ${response.status} (${duration}ms)`,
        );
        await ctx.reply(
          `⚠️ <b>${currentAgentName}</b> responded but may have issues.`,
          { parse_mode: "HTML" },
        );
      }
    } catch (error) {
      logRef.current?.error(
        `Agent offline: ${formatError(error)}`,
      );
      await ctx.reply(
        `❌ <b>${currentAgentName}</b> is offline or unreachable.`,
        { parse_mode: "HTML" },
      );
    }
  });

  // Clear history command (available to all)
  bot.command("clear", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const sessionData = await getOrCreateSessionData(
      env.SESSIONS,
      chatId.toString(),
    );

    const { clearHistory } = await import("../utils/message-history");
    await clearHistory(env.SESSIONS, sessionData.sessionId);

    const currentAgentName = await getCurrentAgentName(
      env,
      chatId.toString(),
    );

    logRef.current?.header(`/clear from @${ctx.from?.username || "unknown"}`);
    logRef.current?.step(
      `Cleared history for session: ${sessionData.sessionId}`,
    );
    logRef.current?.ok(`Done. Agent: ${currentAgentName}`);

    await ctx.reply(
      `🗑️ Conversation history cleared!\n\n📍 Current agent: <b>${currentAgentName}</b>`,
      { parse_mode: "HTML" },
    );
  });

  // Handle voice messages — transcribe → process → reply with voice
  // Works entirely on Workers AI free tier (Whisper STT + MeloTTS TTS)
  bot.on("message:voice", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const voice = ctx.message.voice;
    const messageId = ctx.message.message_id;

    // Check if Workers AI is available
    if (!env.AI) {
      // No AI binding — can't process voice, ignore silently in groups
      if (ctx.chat.type === "private") {
        await ctx.reply("🎤 Voice messages require Workers AI. Please send text instead.");
      }
      return;
    }

    // Check duration limits
    if (!isVoiceProcessable(voice.duration)) {
      if (ctx.chat.type === "private") {
        await ctx.reply("🎤 Voice message too long (max 2 minutes). Please send a shorter one.");
      }
      return;
    }

    logRef.current?.step(`Voice message received (${voice.duration}s)`);

    try {
      // Show "typing" while we process (NOT "record_voice" — we don't know
      // yet if TTS will be available for the response language)
      await ctx.api.sendChatAction(chatId, "typing");
    } catch {
      /* ignore */
    }

    try {
      // 1. Download voice file from Telegram
      const audioBase64 = await downloadVoiceFile(
        ctx.api,
        voice.file_id,
        env.TELEGRAM_BOT_TOKEN!,
      );
      if (!audioBase64) {
        logRef.current?.warn("Failed to download voice file");
        if (ctx.chat.type === "private") {
          await ctx.reply("❌ Couldn't download voice message. Please try again.");
        }
        return;
      }

      logRef.current?.step("Transcribing with Whisper...");

      // 2. Transcribe with Whisper
      const transcription = await transcribeVoice(env.AI, audioBase64);
      if (!transcription) {
        logRef.current?.warn("Whisper returned empty transcription");
        if (ctx.chat.type === "private") {
          await ctx.reply("🎤 Couldn't understand the voice message. Please try again or send text.");
        }
        return;
      }

      logRef.current?.info(`Transcribed: "${transcription.substring(0, 80)}..."`);

      // 3. Process transcribed text through normal message pipeline
      // Show typing while AI generates response
      try {
        await ctx.api.sendChatAction(chatId, "typing");
      } catch {
        /* ignore */
      }

      // Both DMs and groups get voice responses when TTS is available
      if (ctx.chat.type === "private") {
        // In DMs: agent pipeline → voice response
        await handleVoiceDM(ctx, env, transcription, messageId, logRef.current);
      } else {
        // In groups: moderation + proactive pipeline → voice response if triggered
        await handleVoiceGroup(ctx, env, transcription, messageId, logRef.current);
      }
    } catch (error) {
      console.error("[TelegramBot] voice handler error:", error);
      logRef.current?.error(`Voice handler failed: ${formatError(error)}`);
      try {
        // Show error in both DMs and groups (since we respond to voice everywhere)
        await ctx.reply("❌ Error processing voice message. Please try again.");
      } catch {
        /* ignore */
      }
    }
  });

  // Handle all text messages
  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    // Show typing indicator
    try {
      await ctx.api.sendChatAction(chatId, "typing");
    } catch {
      /* ignore typing indicator errors */
    }

    try {
      // Handle message forwarding to agent (pass logger)
      await handleMessage(ctx, env, ctx.message.text, logRef.current);
    } catch (error) {
      console.error("[TelegramBot] handleMessage error:", error);
      logRef.current?.error(
        `handleMessage failed: ${formatError(error)}`,
      );
      try {
        await ctx.reply(
          "❌ Sorry, I encountered an error processing your message. Please try again.",
        );
      } catch {
        /* ignore reply errors */
      }
    }
  });

  // Handle errors
  bot.catch((err: unknown) => {
    console.error("[TelegramBot] Bot error:", err);
    logRef.current?.error(
      `Bot error: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
}

// ============================================================================
// VOICE DM HANDLER
// ============================================================================

/**
 * Handle a voice message in DMs: get agent response, then synthesize as voice.
 *
 * Flow: transcribed text → agent pipeline → response text → MeloTTS → send voice
 * Falls back to text reply if TTS fails.
 */
async function handleVoiceDM(
  ctx: import("grammy").Context,
  env: TelegramBotEnv,
  transcription: string,
  replyToMessageId: number,
  tgLog?: TelegramLog,
): Promise<void> {
  const chatId = ctx.chat!.id;

  // Show transcription as a quoted reply so user sees what was understood
  try {
    await ctx.reply(`🎤 _"${transcription}"_`, {
      parse_mode: "Markdown",
      reply_parameters: { message_id: replyToMessageId },
    });
  } catch {
    // Fallback without markdown
    await ctx.reply(`🎤 "${transcription}"`, {
      reply_parameters: { message_id: replyToMessageId },
    });
  }

  // Get agent response via the normal pipeline
  const { getCurrentAgentInfo } = await import("./agent-handler");
  const { streamAgentResponse } = await import("../utils/agent-client");
  const {
    getMessageHistory,
    addToHistory,
    historyToModelMessages,
    getAgentSystemPromptAsync,
  } = await import("../utils/message-history");

  const {
    url: agentUrl,
    name: agentName,
    id: agentId,
    sessionId,
  } = await getCurrentAgentInfo(env, chatId.toString());

  const history = await getMessageHistory(env.SESSIONS, sessionId);
  const historyMessages = historyToModelMessages(history, agentId);
  const systemPrompt = await getAgentSystemPromptAsync(
    env.SESSIONS,
    agentName,
    history,
  );

  await addToHistory(env.SESSIONS, sessionId, "user", transcription);

  const allMessages = [
    { role: "system" as const, content: systemPrompt },
    ...historyMessages,
    { role: "user" as const, content: transcription },
  ];

  // Collect full response (no streaming to Telegram — we need the full text for TTS)
  let fullResponse = "";
  const useServiceBinding = !!env.AGENT_SERVICE && agentUrl === env.AGENT_URL;

  tgLog?.step("Generating agent response for voice...");

  try {
    await ctx.api.sendChatAction(chatId, "typing");
  } catch {
    /* ignore */
  }

  await streamAgentResponse(
    agentUrl,
    sessionId,
    allMessages,
    async (chunk: string) => {
      fullResponse += chunk;
    },
    useServiceBinding ? env.AGENT_SERVICE : undefined,
    tgLog,
  );

  if (!fullResponse.trim()) {
    await ctx.reply("🤷 I couldn't generate a response. Please try again.");
    return;
  }

  await addToHistory(env.SESSIONS, sessionId, "assistant", fullResponse, agentId, agentName);

  tgLog?.step(`Agent responded (${fullResponse.length} chars), checking TTS...`);

  // Detect language and check TTS support
  // MeloTTS supports: EN, ES, FR, ZH, JA, KO — NOT Russian or Arabic
  const ttsLang = detectLanguageForTTS(fullResponse);

  if (isTTSSupported(ttsLang) && env.AI) {
    // Language is supported — show voice indicator ONLY now (not earlier)
    try {
      await ctx.api.sendChatAction(chatId, "record_voice");
    } catch {
      /* ignore */
    }

    tgLog?.step(`Synthesizing voice (lang: ${ttsLang})...`);
    const audioBuffer = await synthesizeSpeech(env.AI, fullResponse, ttsLang);

    if (audioBuffer && audioBuffer.byteLength > 0) {
      const sent = await sendVoiceResponse(ctx.api, chatId, audioBuffer, replyToMessageId);
      if (sent) {
        tgLog?.ok(`Voice response sent (lang: ${ttsLang}, ${audioBuffer.byteLength} bytes)`);
        return;
      }
      tgLog?.warn(`Voice send failed (${audioBuffer.byteLength} bytes), falling back to text`);
    } else {
      tgLog?.warn("TTS synthesis returned empty audio, falling back to text");
    }
  } else {
    tgLog?.info(`TTS not available for detected language (${ttsLang ?? "unsupported"}), sending text`);
  }

  // Fallback: send as text (TTS failed, unsupported language, or no AI)
  try {
    const { escapeMarkdown, sendLongMessage } = await import("../utils/helpers");
    const escapedAgentName = escapeMarkdown(agentName);
    const signedResponse = `🤖 *${escapedAgentName}*\n\n${fullResponse}`;
    await sendLongMessage(ctx, signedResponse, async (part) => {
      await ctx.reply(part, {
        parse_mode: "Markdown",
        reply_parameters: { message_id: replyToMessageId },
      });
    });
  } catch {
    // Final fallback without markdown
    await ctx.reply(`🤖 ${agentName}\n\n${fullResponse}`, {
      reply_parameters: { message_id: replyToMessageId },
    });
  }
}

// ============================================================================
// VOICE GROUP HANDLER
// ============================================================================

/**
 * Handle a voice message in groups: moderation → always reply with voice.
 *
 * Voice messages in groups are a special trigger — the bot ALWAYS comments
 * on them (unlike text messages which go through proactive filtering).
 * This makes voice a unique engagement mechanic in the community.
 *
 * Flow:
 *   1. Moderation check on transcribed text
 *   2. Index message into chat memory
 *   3. Owner task detection (if owner + mention/reply)
 *   4. Generate a comment/response to the voice message
 *   5. TTS → voice reply (fallback to text if TTS unavailable)
 */
async function handleVoiceGroup(
  ctx: import("grammy").Context,
  env: TelegramBotEnv,
  transcription: string,
  replyToMessageId: number,
  tgLog?: TelegramLog,
): Promise<void> {
  const chatId = ctx.chat!.id;
  const userId = ctx.from?.id;
  const username = ctx.from?.username;

  // ── Moderation (same as handleMessage for groups) ──
  if (userId) {
    try {
      const { getModerationSettings } = await import("../utils/moderation-storage");
      const { quickModerateMessage, moderateMessage } = await import("../utils/spam-detector");
      const { executeModeration } = await import("./moderation-actions");

      const settings = await getModerationSettings(env.SESSIONS, chatId);
      if (settings?.enabled) {
        let result = await quickModerateMessage(transcription, chatId, userId, settings, env);
        if (!result && transcription.length > 30) {
          result = await moderateMessage(transcription, chatId, userId, settings, env);
        }
        if (result && result.action !== "none") {
          tgLog?.info(`Voice moderation: ${result.action} (${result.category})`);
          await executeModeration(ctx, env, settings, result, replyToMessageId, userId, username, transcription);
          if (result.action === "delete" || result.action === "ban") return;
        }
      }
    } catch (error) {
      tgLog?.error(`Voice moderation error: ${error}`);
    }
  }

  // ── Index into chat memory ──
  if (userId && transcription.length >= 10) {
    const { indexMessage } = await import("../utils/chat-memory");
    const firstName = ctx.from?.first_name;
    // Awaited to ensure indexing completes before Worker terminates.
    await indexMessage(
      env, chatId, replyToMessageId, userId,
      firstName || username || `user_${userId}`,
      transcription,
      ctx.message?.reply_to_message?.message_id,
    );
  }

  // ── Owner task detection in group (if mentioned / reply) ──
  const { isOwner } = await import("../utils/owner");
  const userIsOwner = await isOwner(env, userId);
  if (userIsOwner) {
    try {
      const botUser = ctx.me.username || "bot";
      const mentionPattern = new RegExp(`@${botUser}\\b`, "i");
      const isMentioned = mentionPattern.test(transcription);
      const isReplyToBot = ctx.message?.reply_to_message?.from?.id === ctx.me.id;

      if (isMentioned || isReplyToBot) {
        const { detectTask, handleOwnerTask } = await import("./task-handler");
        const cleanMessage = transcription.replace(mentionPattern, "").trim();
        const groupTask = detectTask(cleanMessage);
        if (groupTask.type !== "none") {
          tgLog?.decision(`Voice: owner group task detected: ${groupTask.type}`);
          const handled = await handleOwnerTask(ctx, env, groupTask, tgLog);
          if (handled) return;
        }
      }
    } catch (error) {
      tgLog?.error(`Voice group task error: ${error}`);
    }
  }

  // ── Always generate a response to voice messages ──
  // Voice in group = automatic engagement (no proactive filtering)
  tgLog?.decision(`Voice group: always-reply mode — generating comment`);

  const { generateProactiveResponse } = await import("../utils/proactive-responder");
  const { getProactiveSettings, recordResponse } = await import("../utils/proactive-storage");

  try {
    // Show "typing" while generating (not "record_voice" — TTS may not be available)
    await ctx.api.sendChatAction(chatId, "typing");
  } catch { /* ignore */ }

  // Use proactive settings for personality/tone, but skip the "should respond?" check
  const proactiveSettings = await getProactiveSettings(env.SESSIONS, chatId);
  const senderName = ctx.from?.first_name || ctx.from?.username;

  let responseText: string | null = null;

  if (proactiveSettings) {
    // Has proactive settings — use the configured personality
    responseText = await generateProactiveResponse(
      env,
      proactiveSettings,
      transcription,
      "voice_message", // treat as a dedicated trigger
      senderName,
      chatId,
    );
  }

  // Fallback: generate via Workers AI directly if no proactive settings or generation failed
  if (!responseText && env.AI) {
    try {
      const result = (await env.AI.run(
        "@cf/meta/llama-3.1-8b-instruct-fp8" as keyof AiModels,
        {
          messages: [
            {
              role: "system",
              content: "You are a friendly community chat bot. Someone sent a voice message in the group. "
                + "Reply with a short, natural comment (1-2 sentences). Be casual and engaging. "
                + "Match the language of the message.",
            },
            {
              role: "user",
              content: `[Voice message from ${senderName || "someone"}]: "${transcription}"`,
            },
          ],
          max_tokens: 150,
        } as any,
      )) as { response?: string };
      responseText = result.response?.trim() || null;
    } catch (error) {
      tgLog?.error(`Voice group: AI fallback failed: ${error}`);
    }
  }

  if (!responseText) {
    tgLog?.warn("Voice group: couldn't generate response");
    return;
  }

  // Record response for rate-limit tracking
  if (proactiveSettings) {
    await recordResponse(env.SESSIONS, proactiveSettings).catch(() => {});
  }

  tgLog?.step(`Voice group response: "${responseText.substring(0, 60)}..." (${responseText.length} chars)`);

  // ── Try TTS → voice reply ──
  const ttsLang = detectLanguageForTTS(responseText);

  if (isTTSSupported(ttsLang) && env.AI) {
    // Now we know TTS is available — show "recording voice" indicator
    try {
      await ctx.api.sendChatAction(chatId, "record_voice");
    } catch { /* ignore */ }

    tgLog?.step(`Voice group: synthesizing (lang: ${ttsLang})...`);
    const audioBuffer = await synthesizeSpeech(env.AI, responseText, ttsLang);
    if (audioBuffer && audioBuffer.byteLength > 0) {
      const sent = await sendVoiceResponse(ctx.api, chatId, audioBuffer, replyToMessageId);
      if (sent) {
        tgLog?.ok(`Voice group response sent as voice (lang: ${ttsLang}, ${audioBuffer.byteLength} bytes)`);
        return;
      }
      tgLog?.warn(`Voice group: send failed (${audioBuffer.byteLength} bytes), falling back to text`);
    } else {
      tgLog?.warn("Voice group: TTS returned empty audio, falling back to text");
    }
  } else {
    tgLog?.info(`Voice group: TTS unsupported for lang (${ttsLang ?? "unknown"}), sending text`);
  }

  // ── Fallback: text reply ──
  try {
    await ctx.reply(responseText, {
      reply_parameters: { message_id: replyToMessageId },
    });
    tgLog?.ok("Voice group: text fallback sent");
  } catch {
    await ctx.api.sendMessage(chatId, responseText);
  }
}
