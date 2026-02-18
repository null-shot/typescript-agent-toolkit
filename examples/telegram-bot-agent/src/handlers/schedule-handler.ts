/**
 * Schedule Handler - Scheduled posts via Kanban tasks
 *
 * Commands:
 * - /schedule - Schedule a post for later (creates kanban task)
 * - /scheduled - View scheduled posts (kanban queued tasks with runAt)
 * - /cancelpost - Cancel a scheduled post (deletes kanban task)
 *
 * All scheduling is unified through the Kanban system.
 * Cron picks up queued tasks with schedule.runAt via processKanbanScheduledTasks.
 */

import { Bot, Context, InlineKeyboard } from "grammy";
import { getPostableBotChats, type BotChat } from "../utils/bot-chats-storage";
import {
  createTask,
  getKanbanBoard,
  deleteTask,
  getTask,
} from "../utils/kanban-storage";
import {
  formatScheduledTime,
  parseScheduleTime,
} from "../types/scheduled-post";
import {
  type PendingSchedule,
  getPendingSchedule,
  setPendingSchedule,
  clearPendingSchedule,
} from "../utils/pending-state";
import { loggers } from "../utils/logger";

const log = loggers.cron;

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  SESSIONS: KVNamespace;
  AGENT_URL?: string;
}

/**
 * Setup schedule handlers
 */
export function setupScheduleHandlers(bot: Bot, env: Env): void {
  // /schedule command - Start scheduling flow
  bot.command("schedule", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const chats = await getPostableBotChats(env.SESSIONS);

    if (chats.length === 0) {
      await ctx.reply(
        "📅 <b>Schedule Post</b>\n\n" +
          "No channels or groups available.\n" +
          "Add the bot to a channel/group as admin — it will appear here automatically.",
        { parse_mode: "HTML" },
      );
      return;
    }

    // Check for inline arguments: /schedule "Chat Title" 10m Hello world
    const args = ctx.message?.text?.split(" ").slice(1).join(" ").trim();

    if (args) {
      // Try to parse quick schedule format: /schedule ChatTitle 10m Message text
      const quickMatch = args.match(
        /^(.+?)\s+(\d+[mhd]|tomorrow\s+\d{1,2}:\d{2}|\d{1,2}:\d{2})\s+(.+)$/i,
      );
      if (quickMatch) {
        const [, chatArg, timeArg, text] = quickMatch;
        const target = chats.find(
          (c) =>
            c.title.toLowerCase() === chatArg.toLowerCase() ||
            c.username?.toLowerCase() ===
              chatArg.replace(/^@/, "").toLowerCase(),
        );

        if (target) {
          const scheduledTime = parseScheduleTime(timeArg);
          if (scheduledTime) {
            await createScheduleTask(env, userId, target, text, scheduledTime);

            await ctx.reply(
              `✅ <b>Post scheduled!</b>\n\n` +
                `📢 Target: ${target.title}\n` +
                `🕐 Time: ${formatScheduledTime(scheduledTime.getTime())}\n` +
                `📝 Text: <i>${text.substring(0, 100)}${text.length > 100 ? "..." : ""}</i>\n\n` +
                `Use /scheduled to view all scheduled posts.`,
              { parse_mode: "HTML" },
            );
            return;
          }
        }
      }
    }

    // Start interactive flow
    await setPendingSchedule(env.SESSIONS, userId, { step: "channel" });

    // Show chat selection (channels + groups from auto-tracked bot chats)
    const keyboard = new InlineKeyboard();
    for (const chat of chats) {
      const icon = chat.type === "channel" ? "📢" : "💬";
      keyboard
        .text(`${icon} ${chat.title}`, `sched_channel:${chat.chatId}`)
        .row();
    }
    keyboard.text("❌ Cancel", "sched_channel:cancel");

    await ctx.reply(
      "📅 <b>Schedule Post</b>\n\n" +
        "Step 1/3: Select a target\n\n" +
        "<i>Quick format: /schedule ChatTitle 10m Your message</i>",
      { parse_mode: "HTML", reply_markup: keyboard },
    );
  });

  // Handle channel/chat selection
  bot.callbackQuery(/^sched_channel:(.+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const chatIdStr = ctx.match[1];

    if (chatIdStr === "cancel") {
      await clearPendingSchedule(env.SESSIONS, userId);
      await ctx.answerCallbackQuery("Cancelled");
      await ctx.deleteMessage();
      return;
    }

    const targetChatId = parseInt(chatIdStr, 10);
    const chats = await getPostableBotChats(env.SESSIONS);
    const target = chats.find((c) => c.chatId === targetChatId);

    if (!target) {
      await ctx.answerCallbackQuery("Chat not found");
      return;
    }

    // Store target info and move to text step
    await setPendingSchedule(env.SESSIONS, userId, {
      step: "text",
      channelId: String(target.chatId),
      channelChatId: target.chatId,
      channelTitle: target.title,
    });

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `📅 <b>Schedule Post</b>\n\n` +
        `📢 Target: <b>${target.title}</b>\n\n` +
        `Step 2/3: Send me the text for your post.\n\n` +
        `<i>Send /cancel to abort.</i>`,
      { parse_mode: "HTML" },
    );
  });

  // /scheduled command - View scheduled posts from kanban
  bot.command("scheduled", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const board = await getKanbanBoard(env.SESSIONS);
    // Find queued tasks with schedule.runAt (one-shot scheduled posts)
    const scheduled = board.queued.filter(
      (t) => t.schedule?.runAt && t.action === "write_post",
    );

    if (scheduled.length === 0) {
      await ctx.reply(
        "📅 <b>Scheduled Posts</b>\n\n" +
          "No posts scheduled.\n\n" +
          "Use /schedule to schedule a post.",
        { parse_mode: "HTML" },
      );
      return;
    }

    let message = "📅 <b>Scheduled Posts</b>\n\n";

    for (const task of scheduled.slice(0, 10)) {
      const time = formatScheduledTime(
        new Date(task.schedule!.runAt!).getTime(),
      );
      const content = task.approval?.content || task.description;
      const preview =
        content.substring(0, 50) + (content.length > 50 ? "..." : "");
      message += `🕐 <b>${time}</b>\n`;
      message += `📢 ${task.approval?.targetChatTitle || task.chatTitle || "?"}\n`;
      message += `📝 <i>${preview}</i>\n`;
      message += `🆔 <code>${task.id}</code>\n\n`;
    }

    if (scheduled.length > 10) {
      message += `<i>...and ${scheduled.length - 10} more</i>\n\n`;
    }

    message += `Total: ${scheduled.length} pending post(s)\n`;
    message += `\nUse /cancelpost [id] to cancel a post.`;

    await ctx.reply(message, { parse_mode: "HTML" });
  });

  // /cancelpost command
  bot.command("cancelpost", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const postId = ctx.message?.text?.split(" ")[1]?.trim();

    if (!postId) {
      // Show list of scheduled posts to cancel
      const board = await getKanbanBoard(env.SESSIONS);
      const scheduled = board.queued.filter(
        (t) => t.schedule?.runAt && t.action === "write_post",
      );

      if (scheduled.length === 0) {
        await ctx.reply("No scheduled posts to cancel.");
        return;
      }

      const keyboard = new InlineKeyboard();
      for (const task of scheduled.slice(0, 5)) {
        const time = formatScheduledTime(
          new Date(task.schedule!.runAt!).getTime(),
        );
        const target = task.approval?.targetChatTitle || task.chatTitle || "?";
        const label = `${time} - ${target}`;
        keyboard
          .text(`🗑️ ${label.substring(0, 30)}`, `cancel_post:${task.id}`)
          .row();
      }
      keyboard.text("❌ Close", "cancel_post:close");

      await ctx.reply("Select a post to cancel:", { reply_markup: keyboard });
      return;
    }

    // Cancel specific task
    const deleted = await deleteTask(env.SESSIONS, postId);

    if (deleted) {
      await ctx.reply(`✅ Scheduled post cancelled.`);
    } else {
      await ctx.reply(`❌ Post not found or already processed.`);
    }
  });

  // Handle cancel post callback
  bot.callbackQuery(/^cancel_post:(.+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const postId = ctx.match[1];

    if (postId === "close") {
      await ctx.answerCallbackQuery();
      await ctx.deleteMessage();
      return;
    }

    const deleted = await deleteTask(env.SESSIONS, postId);

    if (deleted) {
      await ctx.answerCallbackQuery("Post cancelled!");
      await ctx.editMessageText(
        `✅ Post cancelled.\n\nUse /scheduled to see remaining posts.`,
      );
    } else {
      await ctx.answerCallbackQuery("Post not found");
    }
  });

  // Handle text input for scheduling (DM only — skip groups to avoid extra KV reads)
  bot.on("message:text", async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();
    if (ctx.chat?.type !== "private") return next();

    const pending = await getPendingSchedule(env.SESSIONS, userId);
    if (!pending) return next();

    const text = ctx.message.text;

    if (text === "/cancel") {
      await clearPendingSchedule(env.SESSIONS, userId);
      await ctx.reply("❌ Scheduling cancelled.");
      return;
    }

    // Don't intercept commands
    if (text.startsWith("/")) return next();

    if (pending.step === "text") {
      // Got the text, now ask for time
      pending.text = text;
      pending.step = "time";
      await setPendingSchedule(env.SESSIONS, userId, pending);

      const keyboard = new InlineKeyboard()
        .text("⏱️ 10 min", "sched_time:10m")
        .text("⏱️ 30 min", "sched_time:30m")
        .text("⏱️ 1 hour", "sched_time:1h")
        .row()
        .text("⏱️ 3 hours", "sched_time:3h")
        .text("⏱️ Tomorrow 10:00", "sched_time:tomorrow 10:00")
        .row()
        .text("❌ Cancel", "sched_time:cancel");

      await ctx.reply(
        `📅 <b>Schedule Post</b>\n\n` +
          `📢 Target: <b>${pending.channelTitle}</b>\n` +
          `📝 Text: <i>${text.substring(0, 100)}${text.length > 100 ? "..." : ""}</i>\n\n` +
          `Step 3/3: When to post?\n\n` +
          `Select a preset or send custom time:\n` +
          `• "30m" - in 30 minutes\n` +
          `• "2h" - in 2 hours\n` +
          `• "15:30" - at 15:30\n` +
          `• "tomorrow 10:00" - tomorrow at 10:00`,
        { parse_mode: "HTML", reply_markup: keyboard },
      );
    } else if (pending.step === "time") {
      // Parse custom time input
      const scheduledTime = parseScheduleTime(text);

      if (!scheduledTime) {
        await ctx.reply(
          "⚠️ Couldn't understand that time format.\n\n" +
            "Try: '30m', '2h', '15:30', or 'tomorrow 10:00'",
        );
        return;
      }

      // Create kanban task
      const target: BotChat = {
        chatId: pending.channelChatId!,
        title: pending.channelTitle!,
        type: "channel",
        role: "administrator",
        canPost: true,
        updatedAt: Date.now(),
      };

      const task = await createScheduleTask(
        env,
        userId,
        target,
        pending.text!,
        scheduledTime,
      );
      await clearPendingSchedule(env.SESSIONS, userId);

      await ctx.reply(
        `✅ <b>Post scheduled!</b>\n\n` +
          `📢 Target: ${pending.channelTitle}\n` +
          `🕐 Time: ${formatScheduledTime(scheduledTime.getTime())}\n` +
          `📝 Text: <i>${pending.text!.substring(0, 100)}${pending.text!.length > 100 ? "..." : ""}</i>\n\n` +
          `🆔 Task ID: <code>${task.id}</code>\n\n` +
          `Use /scheduled to view all or /cancelpost to cancel.`,
        { parse_mode: "HTML" },
      );
    }
  });

  // Handle time preset selection
  bot.callbackQuery(/^sched_time:(.+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const timeArg = ctx.match[1];

    if (timeArg === "cancel") {
      await clearPendingSchedule(env.SESSIONS, userId);
      await ctx.answerCallbackQuery("Cancelled");
      await ctx.deleteMessage();
      return;
    }

    const pending = await getPendingSchedule(env.SESSIONS, userId);
    if (!pending || pending.step !== "time") {
      await ctx.answerCallbackQuery("Session expired");
      await ctx.deleteMessage();
      return;
    }

    const scheduledTime = parseScheduleTime(timeArg);
    if (!scheduledTime) {
      await ctx.answerCallbackQuery("Invalid time");
      return;
    }

    // Create kanban task
    const target: BotChat = {
      chatId: pending.channelChatId!,
      title: pending.channelTitle!,
      type: "channel",
      role: "administrator",
      canPost: true,
      updatedAt: Date.now(),
    };

    const task = await createScheduleTask(
      env,
      userId,
      target,
      pending.text!,
      scheduledTime,
    );
    await clearPendingSchedule(env.SESSIONS, userId);

    await ctx.answerCallbackQuery("Scheduled!");
    await ctx.editMessageText(
      `✅ <b>Post scheduled!</b>\n\n` +
        `📢 Target: ${pending.channelTitle}\n` +
        `🕐 Time: ${formatScheduledTime(scheduledTime.getTime())}\n` +
        `📝 Text: <i>${pending.text!.substring(0, 100)}${pending.text!.length > 100 ? "..." : ""}</i>\n\n` +
        `🆔 Task ID: <code>${task.id}</code>\n\n` +
        `Use /scheduled to view all or /cancelpost to cancel.`,
      { parse_mode: "HTML" },
    );
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Create a kanban task for a scheduled post.
 * The cron processor (processKanbanScheduledTasks) will pick it up.
 */
async function createScheduleTask(
  env: Env,
  userId: number,
  target: BotChat,
  text: string,
  scheduledTime: Date,
) {
  return createTask(env.SESSIONS, {
    kind: "one-shot",
    status: "queued",
    source: "owner",
    action: "write_post",
    title: `Scheduled post: ${target.title}`,
    description: text.substring(0, 200),
    chatId: target.chatId,
    chatTitle: target.title,
    createdBy: userId,
    schedule: {
      runAt: scheduledTime.toISOString(),
    },
    approval: {
      content: text,
      targetChatId: target.chatId,
      targetChatTitle: target.title,
      requestedAt: new Date().toISOString(),
    },
  });
}
