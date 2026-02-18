/**
 * Proactive Mode Storage Utilities
 */

import type { ProactiveSettings, ProactiveMode } from "../types/proactive";
import { getDefaultProactiveSettings, MODE_PRESETS } from "../types/proactive";

const PROACTIVE_KEY = (chatId: number) => `proactive:${chatId}`;

/**
 * Get proactive settings for a chat
 */
export async function getProactiveSettings(
  kv: KVNamespace,
  chatId: number,
): Promise<ProactiveSettings | null> {
  const data = await kv.get(PROACTIVE_KEY(chatId));
  if (!data) return null;
  return JSON.parse(data) as ProactiveSettings;
}

/**
 * Get or create proactive settings
 */
export async function getOrCreateProactiveSettings(
  kv: KVNamespace,
  chatId: number,
  chatTitle: string,
): Promise<ProactiveSettings> {
  const existing = await getProactiveSettings(kv, chatId);
  if (existing) return existing;

  const settings = getDefaultProactiveSettings(chatId, chatTitle);
  await saveProactiveSettings(kv, settings);
  return settings;
}

/**
 * Save proactive settings
 */
export async function saveProactiveSettings(
  kv: KVNamespace,
  settings: ProactiveSettings,
): Promise<void> {
  settings.updatedAt = Date.now();
  await kv.put(PROACTIVE_KEY(settings.chatId), JSON.stringify(settings));
}

/**
 * Enable proactive mode with a preset
 */
export async function enableProactiveMode(
  kv: KVNamespace,
  chatId: number,
  chatTitle: string,
  mode: ProactiveMode,
): Promise<ProactiveSettings> {
  const settings = await getOrCreateProactiveSettings(kv, chatId, chatTitle);

  settings.enabled = mode !== "off";
  settings.mode = mode;

  // Apply preset prompt if not custom
  if (mode !== "custom" && mode !== "off") {
    settings.systemPrompt = MODE_PRESETS[mode].prompt;
  }

  await saveProactiveSettings(kv, settings);
  return settings;
}

/**
 * Disable proactive mode
 */
export async function disableProactiveMode(
  kv: KVNamespace,
  chatId: number,
): Promise<void> {
  const settings = await getProactiveSettings(kv, chatId);
  if (settings) {
    settings.enabled = false;
    settings.mode = "off";
    await saveProactiveSettings(kv, settings);
  }
}

/**
 * Set custom system prompt
 */
export async function setSystemPrompt(
  kv: KVNamespace,
  chatId: number,
  chatTitle: string,
  prompt: string,
): Promise<ProactiveSettings> {
  const settings = await getOrCreateProactiveSettings(kv, chatId, chatTitle);
  settings.systemPrompt = prompt;
  settings.mode = "custom";
  await saveProactiveSettings(kv, settings);
  return settings;
}

/**
 * Set project context
 */
export async function setProjectContext(
  kv: KVNamespace,
  chatId: number,
  chatTitle: string,
  context: string,
): Promise<ProactiveSettings> {
  const settings = await getOrCreateProactiveSettings(kv, chatId, chatTitle);
  settings.projectContext = context;
  await saveProactiveSettings(kv, settings);
  return settings;
}

/**
 * Add trigger keyword
 */
export async function addTriggerKeyword(
  kv: KVNamespace,
  chatId: number,
  chatTitle: string,
  keyword: string,
): Promise<ProactiveSettings> {
  const settings = await getOrCreateProactiveSettings(kv, chatId, chatTitle);
  const lowerKeyword = keyword.toLowerCase().trim();

  if (!settings.triggerKeywords.includes(lowerKeyword)) {
    settings.triggerKeywords.push(lowerKeyword);
    await saveProactiveSettings(kv, settings);
  }

  return settings;
}

/**
 * Remove trigger keyword
 */
export async function removeTriggerKeyword(
  kv: KVNamespace,
  chatId: number,
  keyword: string,
): Promise<boolean> {
  const settings = await getProactiveSettings(kv, chatId);
  if (!settings) return false;

  const lowerKeyword = keyword.toLowerCase().trim();
  const index = settings.triggerKeywords.indexOf(lowerKeyword);

  if (index > -1) {
    settings.triggerKeywords.splice(index, 1);
    await saveProactiveSettings(kv, settings);
    return true;
  }

  return false;
}

/**
 * Check if bot can respond (rate limiting)
 * NOTE: This function is read-only — it does NOT mutate settings.
 * Counter resets happen in recordResponse() which persists to KV.
 */
export async function canRespond(
  kv: KVNamespace,
  settings: ProactiveSettings,
): Promise<{ allowed: boolean; reason?: string }> {
  const now = Date.now();

  // Check cooldown
  const timeSinceLastResponse = now - settings.lastResponseTime;
  if (timeSinceLastResponse < settings.cooldownSeconds * 1000) {
    const waitSeconds = Math.ceil(
      (settings.cooldownSeconds * 1000 - timeSinceLastResponse) / 1000,
    );
    return { allowed: false, reason: `Cooldown: ${waitSeconds}s remaining` };
  }

  // Check hourly limit (account for hour rollover without mutating)
  const hourMs = 60 * 60 * 1000;
  const hourRolledOver = now - settings.hourStartTime > hourMs;
  const effectiveCount = hourRolledOver ? 0 : settings.responsesThisHour;

  if (effectiveCount >= settings.maxResponsesPerHour) {
    return {
      allowed: false,
      reason: `Hourly limit reached (${settings.maxResponsesPerHour})`,
    };
  }

  return { allowed: true };
}

/**
 * Record a response (update rate limiting counters)
 */
export async function recordResponse(
  kv: KVNamespace,
  settings: ProactiveSettings,
): Promise<void> {
  const now = Date.now();

  // Reset hourly counter if needed
  const hourMs = 60 * 60 * 1000;
  if (now - settings.hourStartTime > hourMs) {
    settings.responsesThisHour = 0;
    settings.hourStartTime = now;
  }

  settings.responsesThisHour++;
  settings.lastResponseTime = now;

  await saveProactiveSettings(kv, settings);
}

/**
 * Update trigger settings
 */
export async function updateTriggerSettings(
  kv: KVNamespace,
  chatId: number,
  updates: Partial<
    Pick<
      ProactiveSettings,
      | "respondToMentions"
      | "respondToReplies"
      | "respondToQuestions"
      | "responseProbability"
      | "cooldownSeconds"
      | "maxResponsesPerHour"
    >
  >,
): Promise<ProactiveSettings | null> {
  const settings = await getProactiveSettings(kv, chatId);
  if (!settings) return null;

  Object.assign(settings, updates);
  await saveProactiveSettings(kv, settings);

  return settings;
}
