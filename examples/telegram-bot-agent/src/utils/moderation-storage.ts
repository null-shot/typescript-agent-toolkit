/**
 * Moderation Storage Utilities
 * Uses KV to store moderation settings and logs
 */

import type {
  ModerationSettings,
  ModerationLog,
  UserWarning,
} from "../types/moderation";
import { getDefaultSettings } from "../types/moderation";

const SETTINGS_KEY = (chatId: number) => `mod_settings:${chatId}`;
const LOGS_KEY = (chatId: number) => `mod_logs:${chatId}`;
const WARNINGS_KEY = (chatId: number, userId: number) =>
  `mod_warnings:${chatId}:${userId}`;
const USER_CHATS_KEY = (userId: number) => `mod_user_chats:${userId}`; // Chats user manages

// ============ Settings ============

/**
 * Get moderation settings for a chat
 */
export async function getModerationSettings(
  kv: KVNamespace,
  chatId: number,
): Promise<ModerationSettings | null> {
  const data = await kv.get(SETTINGS_KEY(chatId));
  if (!data) return null;
  const settings = JSON.parse(data) as ModerationSettings;

  // Auto-migrate: bump flood threshold if it was the old aggressive default (5)
  if (settings.floodThreshold <= 5) {
    settings.floodThreshold = 15;
  }
  // Auto-migrate: change flood action from "mute" to "warn" (old default)
  if (settings.floodAction === "mute") {
    settings.floodAction = "warn";
  }

  return settings;
}

/**
 * Get or create moderation settings
 */
export async function getOrCreateSettings(
  kv: KVNamespace,
  chatId: number,
  chatTitle: string,
): Promise<ModerationSettings> {
  const existing = await getModerationSettings(kv, chatId);
  if (existing) return existing;

  const settings = getDefaultSettings(chatId, chatTitle);
  await saveModerationSettings(kv, settings);
  return settings;
}

/**
 * Save moderation settings
 */
export async function saveModerationSettings(
  kv: KVNamespace,
  settings: ModerationSettings,
): Promise<void> {
  settings.updatedAt = Date.now();
  await kv.put(SETTINGS_KEY(settings.chatId), JSON.stringify(settings));
}

/**
 * Enable/disable moderation for a chat
 */
export async function toggleModeration(
  kv: KVNamespace,
  chatId: number,
  enabled: boolean,
): Promise<ModerationSettings | null> {
  const settings = await getModerationSettings(kv, chatId);
  if (!settings) return null;

  settings.enabled = enabled;
  await saveModerationSettings(kv, settings);
  return settings;
}

/**
 * Delete moderation settings (when bot removed from chat)
 */
export async function deleteModerationSettings(
  kv: KVNamespace,
  chatId: number,
): Promise<void> {
  await kv.delete(SETTINGS_KEY(chatId));
  await kv.delete(LOGS_KEY(chatId));
}

// ============ User Chat Management ============

/**
 * Get all chats a user manages (for /moderate command)
 */
export async function getUserManagedChats(
  kv: KVNamespace,
  userId: number,
): Promise<{ chatId: number; chatTitle: string }[]> {
  const data = await kv.get(USER_CHATS_KEY(userId));
  if (!data) return [];
  return JSON.parse(data);
}

/**
 * Add a chat to user's managed list
 */
export async function addUserManagedChat(
  kv: KVNamespace,
  userId: number,
  chatId: number,
  chatTitle: string,
): Promise<void> {
  const chats = await getUserManagedChats(kv, userId);
  if (!chats.some((c) => c.chatId === chatId)) {
    chats.push({ chatId, chatTitle });
    await kv.put(USER_CHATS_KEY(userId), JSON.stringify(chats));
  }
}

/**
 * Remove a chat from user's managed list
 */
export async function removeUserManagedChat(
  kv: KVNamespace,
  userId: number,
  chatId: number,
): Promise<void> {
  const chats = await getUserManagedChats(kv, userId);
  const filtered = chats.filter((c) => c.chatId !== chatId);
  await kv.put(USER_CHATS_KEY(userId), JSON.stringify(filtered));
}

// ============ Logs ============

/**
 * Add moderation log entry
 */
export async function addModerationLog(
  kv: KVNamespace,
  log: ModerationLog,
): Promise<void> {
  const logsData = await kv.get(LOGS_KEY(log.chatId));
  const logs: ModerationLog[] = logsData ? JSON.parse(logsData) : [];

  // Keep only last 100 logs
  logs.unshift(log);
  if (logs.length > 100) {
    logs.length = 100;
  }

  await kv.put(LOGS_KEY(log.chatId), JSON.stringify(logs));
}

/**
 * Get moderation logs for a chat
 */
export async function getModerationLogs(
  kv: KVNamespace,
  chatId: number,
  limit: number = 20,
): Promise<ModerationLog[]> {
  const data = await kv.get(LOGS_KEY(chatId));
  if (!data) return [];

  const logs = JSON.parse(data) as ModerationLog[];
  return logs.slice(0, limit);
}

/**
 * Get moderation stats for a chat
 */
export async function getModerationStats(
  kv: KVNamespace,
  chatId: number,
): Promise<{
  total: number;
  byCategory: Record<string, number>;
  byAction: Record<string, number>;
  last24h: number;
}> {
  const logs = await getModerationLogs(kv, chatId, 100);
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const stats = {
    total: logs.length,
    byCategory: {} as Record<string, number>,
    byAction: {} as Record<string, number>,
    last24h: 0,
  };

  for (const log of logs) {
    // By category
    const cat = log.result.category;
    stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;

    // By action
    const action = log.actionTaken;
    stats.byAction[action] = (stats.byAction[action] || 0) + 1;

    // Last 24h
    if (now - log.timestamp < day) {
      stats.last24h++;
    }
  }

  return stats;
}

// ============ Warnings ============

/**
 * Get user warnings for a chat
 */
export async function getUserWarnings(
  kv: KVNamespace,
  chatId: number,
  userId: number,
): Promise<UserWarning | null> {
  const data = await kv.get(WARNINGS_KEY(chatId, userId));
  if (!data) return null;
  return JSON.parse(data) as UserWarning;
}

/**
 * Add warning to user
 */
export async function addUserWarning(
  kv: KVNamespace,
  chatId: number,
  userId: number,
  reason: string,
): Promise<UserWarning> {
  const existing = await getUserWarnings(kv, chatId, userId);

  const warning: UserWarning = existing || {
    chatId,
    userId,
    count: 0,
    lastWarning: 0,
    reasons: [],
  };

  warning.count++;
  warning.lastWarning = Date.now();
  warning.reasons.push(reason);

  // Keep only last 10 reasons
  if (warning.reasons.length > 10) {
    warning.reasons = warning.reasons.slice(-10);
  }

  await kv.put(WARNINGS_KEY(chatId, userId), JSON.stringify(warning));
  return warning;
}

/**
 * Clear user warnings
 */
export async function clearUserWarnings(
  kv: KVNamespace,
  chatId: number,
  userId: number,
): Promise<void> {
  await kv.delete(WARNINGS_KEY(chatId, userId));
}

// ============ Flood Detection ============
// Note: Flood detection moved to utils/pending-state.ts for KV-based storage
// Re-export for backwards compatibility

import { checkFloodKV, clearFloodData } from "./pending-state";

/**
 * Check if user is flooding (too many messages)
 * Now uses KV storage for persistence across Workers instances
 */
export async function checkFlood(
  kv: KVNamespace,
  chatId: number,
  userId: number,
  threshold: number,
): Promise<boolean> {
  return checkFloodKV(kv, chatId, userId, threshold);
}

/**
 * Clear flood cache for a user (after action)
 */
export async function clearFloodCache(
  kv: KVNamespace,
  chatId: number,
  userId: number,
): Promise<void> {
  await clearFloodData(kv, chatId, userId);
}
