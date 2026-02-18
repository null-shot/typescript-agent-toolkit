/**
 * Setup Wizard Handler
 *
 * Commands:
 * - /setup - Initial setup wizard with role templates + role selection
 * - /roles - View/change active roles
 * - /profile - View full bot configuration
 *
 * Flow:
 * 1. /setup → Show role templates (presets)
 * 2. User picks a template OR "Custom"
 * 3. Template auto-configures roles, capabilities, prompt
 * 4. "Custom" falls through to manual role toggles
 * 5. "Complete Setup" finalises everything
 */

import { Bot, Context, InlineKeyboard } from "grammy";
import type { BotRole, BotProfile } from "../types/bot-profile";
import { ROLE_PRESETS, getAllRoles, hasRole } from "../types/bot-profile";
import {
  getOrCreateProfile,
  saveBotProfile,
  getBotProfile,
  addRole,
  removeRole,
  completeSetup,
} from "../utils/profile-storage";
import {
  getOrCreateProactiveSettings,
  setSystemPrompt,
  enableProactiveMode,
} from "../utils/proactive-storage";
import {
  getOrCreateSettings,
  toggleModeration,
} from "../utils/moderation-storage";
import {
  ROLE_TEMPLATES,
  getTemplate,
  type RoleTemplate,
} from "../types/role-templates";
import { loggers } from "../utils/logger";

const log = loggers.bot;

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  SESSIONS: KVNamespace;
}

/**
 * Setup wizard handlers
 */
export function setupSetupHandlers(bot: Bot, env: Env): void {
  // /setup command - Start setup wizard (now shows templates first)
  bot.command("setup", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    await showTemplateSelection(ctx);
  });

  // ── Template selection callback ──────────────────────────────────
  bot.callbackQuery(/^setup_tpl:(.+)$/, async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const templateId = ctx.match[1];

    if (templateId === "custom") {
      // Fall through to manual role toggle screen
      await ctx.answerCallbackQuery("Custom mode");
      await showRoleToggleSetup(ctx, env, chatId);
      return;
    }

    const template = getTemplate(templateId);
    if (!template) {
      await ctx.answerCallbackQuery("Template not found");
      return;
    }

    await ctx.answerCallbackQuery(`Applying ${template.title}...`);

    // Apply template: set roles, configure features, set prompt
    await applyTemplate(
      env,
      chatId,
      ctx.chat?.title || ctx.from?.first_name || "Chat",
      template,
    );

    // Show confirmation with what was configured
    const capList: string[] = [];
    if (template.capabilities.moderation) capList.push("🛡️ Moderation");
    if (template.capabilities.posting) capList.push("📢 Posting");
    if (template.capabilities.proactive) capList.push("🎧 Proactive responses");

    const promptPreview =
      template.systemPrompt.substring(0, 120) +
      (template.systemPrompt.length > 120 ? "..." : "");

    const keyboard = new InlineKeyboard()
      .text("✏️ Edit Roles", "setup_edit_roles")
      .text("📝 Change Prompt", "setup_edit_prompt")
      .row()
      .text("✅ Looks Good!", "setup_confirm_template");

    await ctx.editMessageText(
      `${template.emoji} <b>${template.title}</b>\n\n` +
        `✅ <b>Applied!</b>\n\n` +
        (capList.length > 0
          ? `<b>Capabilities:</b>\n${capList.join("\n")}\n\n`
          : "") +
        `<b>System prompt:</b>\n<i>${promptPreview}</i>\n\n` +
        `You can edit roles or prompt, or confirm to finish.`,
      { parse_mode: "HTML", reply_markup: keyboard },
    );
  });

  // ── Confirm template setup ──────────────────────────────────────
  bot.callbackQuery("setup_confirm_template", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    await completeSetup(env.SESSIONS, chatId);
    await ctx.answerCallbackQuery("Setup complete! 🎉");

    const profile = await getBotProfile(env.SESSIONS, chatId);
    const summary = profile
      ? profile.roles
          .map((r) => `${ROLE_PRESETS[r].emoji} ${ROLE_PRESETS[r].title}`)
          .join("\n")
      : "No roles";

    await ctx.editMessageText(
      `✅ <b>Setup Complete!</b>\n\n` +
        `<b>Active Roles:</b>\n${summary}\n\n` +
        `<i>Use /roles to change roles, /prompt to edit prompt, or /profile for full config.</i>`,
      { parse_mode: "HTML" },
    );

    log.info("Setup completed via template", { chatId, roles: profile?.roles });
  });

  // ── Edit roles from template confirmation ────────────────────────
  bot.callbackQuery("setup_edit_roles", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    await ctx.answerCallbackQuery();
    await showRoleToggleSetup(ctx, env, chatId);
  });

  // ── Edit prompt placeholder — tell user to use /prompt ──────────
  bot.callbackQuery("setup_edit_prompt", async (ctx) => {
    await ctx.answerCallbackQuery(
      "Use /prompt in a group chat to customise the system prompt",
    );
  });

  // ── Handle role toggle in setup ─────────────────────────────────
  bot.callbackQuery(/^setup_toggle:(\w+)$/, async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const roleId = ctx.match[1] as BotRole;
    const profile = await getBotProfile(env.SESSIONS, chatId);

    if (!profile) {
      await ctx.answerCallbackQuery("Please run /setup first");
      return;
    }

    // Toggle role
    if (hasRole(profile, roleId)) {
      await removeRole(env.SESSIONS, chatId, roleId);
      await ctx.answerCallbackQuery(`${ROLE_PRESETS[roleId].title} disabled`);
    } else {
      await addRole(env.SESSIONS, chatId, roleId);
      await ctx.answerCallbackQuery(`${ROLE_PRESETS[roleId].title} enabled`);
    }

    // Update keyboard
    const updatedProfile = await getBotProfile(env.SESSIONS, chatId);
    if (!updatedProfile) return;

    const keyboard = buildRoleToggleKeyboard(updatedProfile);
    keyboard.text("✨ Complete Setup", "setup_complete").row();

    try {
      await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
    } catch {
      // Message might not have changed
    }
  });

  // Complete setup (manual role selection)
  bot.callbackQuery("setup_complete", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const profile = await getBotProfile(env.SESSIONS, chatId);
    if (!profile) {
      await ctx.answerCallbackQuery("Please run /setup first");
      return;
    }

    if (profile.roles.length === 0) {
      await ctx.answerCallbackQuery("Please select at least one role!");
      return;
    }

    // Configure features based on roles
    await configureRoleFeatures(env, profile);

    // Mark setup complete
    await completeSetup(env.SESSIONS, chatId);

    await ctx.answerCallbackQuery("Setup complete! 🎉");

    // Build summary
    const enabledRoles = profile.roles
      .map((r) => `${ROLE_PRESETS[r].emoji} ${ROLE_PRESETS[r].title}`)
      .join("\n");

    const features = profile.roles
      .flatMap((r) => ROLE_PRESETS[r].features.slice(0, 2))
      .map((f) => `• ${f}`)
      .join("\n");

    await ctx.editMessageText(
      `✅ <b>Setup Complete!</b>\n\n` +
        `<b>Active Roles:</b>\n${enabledRoles}\n\n` +
        `<b>Enabled Features:</b>\n${features}\n\n` +
        `<i>Use /roles to change roles or /profile for full config.</i>`,
      { parse_mode: "HTML" },
    );

    log.info("Setup completed", { chatId, roles: profile.roles });
  });

  // /roles command - View/change roles
  bot.command("roles", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const profile = await getBotProfile(env.SESSIONS, chatId);

    if (!profile) {
      await ctx.reply("No profile found. Use /setup to configure the bot.");
      return;
    }

    const keyboard = new InlineKeyboard();

    for (const role of getAllRoles()) {
      const isSelected = hasRole(profile, role.id);
      const icon = isSelected ? "✅" : "⬜";
      keyboard
        .text(`${icon} ${role.emoji} ${role.title}`, `roles_toggle:${role.id}`)
        .row();
    }

    const currentRoles =
      profile.roles.length > 0
        ? profile.roles
            .map((r) => `${ROLE_PRESETS[r].emoji} ${ROLE_PRESETS[r].title}`)
            .join(", ")
        : "None";

    await ctx.reply(
      `⚙️ <b>Bot Roles</b>\n\n` +
        `Current: ${currentRoles}\n\n` +
        `Tap to toggle roles:`,
      { parse_mode: "HTML", reply_markup: keyboard },
    );
  });

  // Handle roles toggle (similar to setup but without complete button)
  bot.callbackQuery(/^roles_toggle:(\w+)$/, async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const roleId = ctx.match[1] as BotRole;
    const profile = await getBotProfile(env.SESSIONS, chatId);

    if (!profile) {
      await ctx.answerCallbackQuery("Profile not found");
      return;
    }

    // Toggle role
    let updatedProfile: BotProfile;
    if (hasRole(profile, roleId)) {
      updatedProfile = await removeRole(env.SESSIONS, chatId, roleId);
      await ctx.answerCallbackQuery(`${ROLE_PRESETS[roleId].title} disabled`);
    } else {
      updatedProfile = await addRole(env.SESSIONS, chatId, roleId);
      await ctx.answerCallbackQuery(`${ROLE_PRESETS[roleId].title} enabled`);
    }

    // Reconfigure features
    await configureRoleFeatures(env, updatedProfile);

    // Update keyboard
    const keyboard = new InlineKeyboard();

    for (const role of getAllRoles()) {
      const isSelected = hasRole(updatedProfile, role.id);
      const icon = isSelected ? "✅" : "⬜";
      keyboard
        .text(`${icon} ${role.emoji} ${role.title}`, `roles_toggle:${role.id}`)
        .row();
    }

    const currentRoles =
      updatedProfile.roles.length > 0
        ? updatedProfile.roles
            .map((r) => `${ROLE_PRESETS[r].emoji} ${ROLE_PRESETS[r].title}`)
            .join(", ")
        : "None";

    try {
      await ctx.editMessageText(
        `⚙️ <b>Bot Roles</b>\n\n` +
          `Current: ${currentRoles}\n\n` +
          `Tap to toggle roles:`,
        { parse_mode: "HTML", reply_markup: keyboard },
      );
    } catch {
      // Message might not have changed
    }
  });

  // /profile command - Full profile view
  bot.command("profile", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const profile = await getBotProfile(env.SESSIONS, chatId);

    if (!profile) {
      await ctx.reply("No profile found. Use /setup to configure the bot.");
      return;
    }

    // Build detailed profile view
    let message = `📋 <b>Bot Profile</b>\n\n`;

    message += `<b>Chat:</b> ${profile.chatTitle}\n`;
    message += `<b>Setup:</b> ${profile.setupComplete ? "✅ Complete" : "⚠️ Incomplete"}\n\n`;

    message += `<b>Active Roles:</b>\n`;
    if (profile.roles.length === 0) {
      message += `<i>No roles configured</i>\n`;
    } else {
      for (const roleId of profile.roles) {
        const role = ROLE_PRESETS[roleId];
        message += `${role.emoji} <b>${role.title}</b>\n`;
        message += `   ${role.features.slice(0, 2).join(", ")}\n`;
      }
    }

    message += `\n<b>Commands by Role:</b>\n`;

    if (hasRole(profile, "content")) {
      message += `📢 /channels, /post, /generate, /schedule\n`;
    }
    if (hasRole(profile, "moderator")) {
      message += `🛡️ /moderate, /modstats, /whitelist\n`;
    }
    if (hasRole(profile, "support")) {
      message += `🎧 /proactive, /prompt\n`;
    }

    message += `\n<i>Use /roles to change roles or /setup to reconfigure.</i>`;

    const keyboard = new InlineKeyboard()
      .text("⚙️ Edit Roles", "profile_edit_roles")
      .text("🔄 Reset", "profile_reset");

    await ctx.reply(message, { parse_mode: "HTML", reply_markup: keyboard });
  });

  // Edit roles from profile
  bot.callbackQuery("profile_edit_roles", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const profile = await getBotProfile(env.SESSIONS, chatId);
    if (!profile) {
      await ctx.answerCallbackQuery("Profile not found");
      return;
    }

    const keyboard = new InlineKeyboard();

    for (const role of getAllRoles()) {
      const isSelected = hasRole(profile, role.id);
      const icon = isSelected ? "✅" : "⬜";
      keyboard
        .text(`${icon} ${role.emoji} ${role.title}`, `roles_toggle:${role.id}`)
        .row();
    }

    keyboard.text("« Back", "profile_back");

    const currentRoles =
      profile.roles.length > 0
        ? profile.roles
            .map((r) => `${ROLE_PRESETS[r].emoji} ${ROLE_PRESETS[r].title}`)
            .join(", ")
        : "None";

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `⚙️ <b>Edit Roles</b>\n\n` +
        `Current: ${currentRoles}\n\n` +
        `Tap to toggle roles:`,
      { parse_mode: "HTML", reply_markup: keyboard },
    );
  });

  // Back to profile
  bot.callbackQuery("profile_back", async (ctx) => {
    // Just acknowledge and delete - user can run /profile again
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage();
  });

  // Reset profile
  bot.callbackQuery("profile_reset", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const keyboard = new InlineKeyboard()
      .text("⚠️ Yes, Reset", "profile_confirm_reset")
      .text("❌ Cancel", "profile_back");

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `⚠️ <b>Reset Profile?</b>\n\n` +
        `This will remove all roles and settings.\n` +
        `You'll need to run /setup again.`,
      { parse_mode: "HTML", reply_markup: keyboard },
    );
  });

  // Confirm reset
  bot.callbackQuery("profile_confirm_reset", async (ctx) => {
    const chatId = ctx.chat?.id;
    const chatTitle = ctx.chat?.title || ctx.from?.first_name || "Chat";
    if (!chatId) return;

    // Reset profile
    const profile = await getOrCreateProfile(env.SESSIONS, chatId, chatTitle);
    profile.roles = [];
    profile.setupComplete = false;
    await saveBotProfile(env.SESSIONS, profile);

    await ctx.answerCallbackQuery("Profile reset!");
    await ctx.editMessageText(
      `🔄 <b>Profile Reset</b>\n\n` +
        `All roles have been removed.\n` +
        `Use /setup to configure the bot again.`,
      { parse_mode: "HTML" },
    );

    log.info("Profile reset", { chatId });
  });
}

// ─── Template Selection UI ──────────────────────────────────────────

async function showTemplateSelection(ctx: Context): Promise<void> {
  const keyboard = new InlineKeyboard();

  for (const tpl of ROLE_TEMPLATES) {
    keyboard.text(`${tpl.emoji} ${tpl.title}`, `setup_tpl:${tpl.id}`).row();
  }

  // Build template descriptions
  const descriptions = ROLE_TEMPLATES.filter((t) => t.id !== "custom")
    .map((t) => `${t.emoji} <b>${t.title}</b>\n<i>${t.description}</i>`)
    .join("\n\n");

  await ctx.reply(
    `🚀 <b>Bot Setup Wizard</b>\n\n` +
      `Choose a template to get started quickly:\n\n` +
      descriptions +
      `\n\n⚙️ <b>Custom</b>\n<i>Configure everything from scratch</i>\n\n` +
      `<i>Pick a template — you can always tweak later.</i>`,
    { parse_mode: "HTML", reply_markup: keyboard },
  );
}

// ─── Role Toggle UI (for manual/custom setup) ──────────────────────

async function showRoleToggleSetup(
  ctx: Context,
  env: Env,
  chatId: number,
): Promise<void> {
  const chatTitle = ctx.chat?.title || ctx.from?.first_name || "Chat";
  const profile = await getOrCreateProfile(env.SESSIONS, chatId, chatTitle);

  const keyboard = buildRoleToggleKeyboard(profile);
  keyboard.text("✨ Complete Setup", "setup_complete").row();

  const text =
    `⚙️ <b>Custom Setup</b>\n\n` +
    `<b>Select roles:</b>\n` +
    `Each role enables different features.\n\n` +
    getAllRoles()
      .map((r) => `${r.emoji} <b>${r.title}</b>\n<i>${r.description}</i>`)
      .join("\n\n") +
    `\n\n<i>Tap to toggle roles, then press Complete.</i>`;

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } else {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  }
}

function buildRoleToggleKeyboard(profile: BotProfile): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const role of getAllRoles()) {
    const isSelected = hasRole(profile, role.id);
    const icon = isSelected ? "✅" : "⬜";
    keyboard
      .text(`${icon} ${role.emoji} ${role.title}`, `setup_toggle:${role.id}`)
      .row();
  }
  return keyboard;
}

// ─── Apply a role template ──────────────────────────────────────────

async function applyTemplate(
  env: Env,
  chatId: number,
  chatTitle: string,
  template: RoleTemplate,
): Promise<void> {
  const profile = await getOrCreateProfile(env.SESSIONS, chatId, chatTitle);

  // Set roles based on template
  const rolesToSet: BotRole[] = [template.role];
  if (template.capabilities.moderation && !rolesToSet.includes("moderator")) {
    rolesToSet.push("moderator");
  }
  if (template.capabilities.posting && !rolesToSet.includes("content")) {
    rolesToSet.push("content");
  }
  // Support role is implicit if proactive is enabled
  if (template.capabilities.proactive && !rolesToSet.includes("support")) {
    rolesToSet.push("support");
  }

  profile.roles = rolesToSet;
  await saveBotProfile(env.SESSIONS, profile);

  // Configure features
  await configureRoleFeatures(env, profile);

  // Set system prompt (apply to proactive settings for the chat)
  if (template.systemPrompt) {
    await setSystemPrompt(
      env.SESSIONS,
      chatId,
      chatTitle,
      template.systemPrompt,
    );
  }

  // Enable proactive mode if template says so
  if (template.capabilities.proactive && template.proactiveMode) {
    await enableProactiveMode(
      env.SESSIONS,
      chatId,
      chatTitle,
      template.proactiveMode,
    );
  }

  log.info("Template applied", {
    chatId,
    template: template.id,
    roles: rolesToSet,
  });
}

// ─── Configure features based on roles ──────────────────────────────

async function configureRoleFeatures(
  env: Env,
  profile: BotProfile,
): Promise<void> {
  const chatId = profile.chatId;

  // Content Manager role
  if (hasRole(profile, "content")) {
    // Content features are always available, no specific config needed
    log.debug("Content role enabled", { chatId });
  }

  // Moderator role
  if (hasRole(profile, "moderator")) {
    // Enable moderation with default settings
    const settings = await getOrCreateSettings(
      env.SESSIONS,
      chatId,
      profile.chatTitle,
    );
    if (!settings.enabled) {
      await toggleModeration(env.SESSIONS, chatId, true);
    }
    log.debug("Moderator role enabled", { chatId });
  } else {
    // Disable moderation if role removed
    await toggleModeration(env.SESSIONS, chatId, false);
  }

  // Support role
  if (hasRole(profile, "support")) {
    // Enable proactive mode with default prompt
    const proactiveSettings = await getOrCreateProactiveSettings(
      env.SESSIONS,
      chatId,
      profile.chatTitle,
    );
    if (!proactiveSettings.enabled) {
      await enableProactiveMode(
        env.SESSIONS,
        chatId,
        profile.chatTitle,
        "support",
      );
    }
    // Set default support prompt
    await setSystemPrompt(
      env.SESSIONS,
      chatId,
      profile.chatTitle,
      ROLE_PRESETS.support.defaultPrompt,
    );
    log.debug("Support role enabled", { chatId });
  }
}
