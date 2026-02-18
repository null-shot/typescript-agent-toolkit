/**
 * Owner / Admin Detection Utility
 *
 * Two-level access model:
 * - Owner: The bot operator. Can create tasks, configure capabilities,
 *   manage channels, and use all admin commands.
 * - User: Everyone else. Interacts with the bot in the role the owner assigned
 *   (support, community assistant, etc.). Cannot change settings or create tasks.
 *
 * Owner resolution (in order):
 * 1. OWNER_ID env var — if set, always wins (explicit production config)
 * 2. KV key "owner:id" — auto-claimed by the first user to /start in DM
 */

import type { TelegramBotEnv } from "../types/env";

const OWNER_KV_KEY = "owner:id";

/**
 * Check if a Telegram user ID matches the bot owner.
 * Checks OWNER_ID env first, then KV auto-claim.
 */
export async function isOwner(
  env: TelegramBotEnv,
  userId: number | undefined,
): Promise<boolean> {
  if (!userId) return false;
  const ownerId = await getOwnerId(env);
  if (!ownerId) return false;
  return userId === ownerId;
}

/**
 * Get the owner's Telegram user ID.
 * Checks OWNER_ID env first, then KV.
 */
export async function getOwnerId(
  env: TelegramBotEnv,
): Promise<number | undefined> {
  // 1. Check env var
  if (env.OWNER_ID) {
    const id = parseInt(env.OWNER_ID, 10);
    if (!isNaN(id)) return id;
  }

  // 2. Check KV
  const stored = await env.SESSIONS.get(OWNER_KV_KEY);
  if (stored) {
    const id = parseInt(stored, 10);
    if (!isNaN(id)) return id;
  }

  return undefined;
}

/**
 * Auto-claim ownership: if no owner is set, the given user becomes the owner.
 * Only works if OWNER_ID env is not set AND no owner is stored in KV.
 *
 * Returns true if the user was claimed as owner (or already is owner).
 */
export async function claimOwnerIfUnset(
  env: TelegramBotEnv,
  userId: number,
): Promise<boolean> {
  // If env var is set, auto-claim is disabled
  if (env.OWNER_ID) {
    const envId = parseInt(env.OWNER_ID, 10);
    return !isNaN(envId) && envId === userId;
  }

  // Check if already claimed
  const stored = await env.SESSIONS.get(OWNER_KV_KEY);
  if (stored) {
    return parseInt(stored, 10) === userId;
  }

  // Claim!
  await env.SESSIONS.put(OWNER_KV_KEY, userId.toString());
  return true;
}

/**
 * Transfer ownership to a new user (owner-only action).
 */
export async function transferOwnership(
  env: TelegramBotEnv,
  newOwnerId: number,
): Promise<void> {
  await env.SESSIONS.put(OWNER_KV_KEY, newOwnerId.toString());
}

/**
 * List of commands only the owner can use.
 * Used for filtering in the message handler and command registration.
 */
export const OWNER_ONLY_COMMANDS = new Set([
  // Setup & configuration
  "setup",
  "roles",
  "profile",
  // Dashboard access
  "pin",
  // Moderation
  "moderate",
  "modstats",
  "whitelist",
  // Proactive mode
  "proactive",
  "prompt",
  // Content publishing
  "channels",
  "addchannel",
  "removechannel",
  "post",
  "generate",
  "quickpost",
  "schedule",
  "scheduled",
  "cancelpost",
  // Task management
  "tasks",
  "board",
  "stats",
  // Admin
  "loghere",
  "logstop",
  "mychats",
  "scan",
  "setowner",
  // Agent selection
  "agent",
  "agents",
]);
