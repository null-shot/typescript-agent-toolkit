/**
 * Pending State Management
 * Stores temporary user state in KV instead of in-memory Maps
 * (Cloudflare Workers are stateless - Maps don't persist between requests)
 */

import type { PostStyle } from "../prompts/post-styles";

// TTL for pending states (5 minutes)
const PENDING_TTL = 300;

// Key prefixes
const PENDING_POST_KEY = (userId: number) => `pending_post:${userId}`;
const PENDING_GENERATION_KEY = (userId: number) => `pending_gen:${userId}`;
const PENDING_SCHEDULE_KEY = (userId: number) => `pending_sched:${userId}`;

// ============ Pending Post State ============

export interface PendingPost {
  channelId: string;
  text?: string;
}

export async function getPendingPost(
  kv: KVNamespace,
  userId: number,
): Promise<PendingPost | null> {
  const data = await kv.get(PENDING_POST_KEY(userId));
  return data ? JSON.parse(data) : null;
}

export async function setPendingPost(
  kv: KVNamespace,
  userId: number,
  state: PendingPost,
): Promise<void> {
  await kv.put(PENDING_POST_KEY(userId), JSON.stringify(state), {
    expirationTtl: PENDING_TTL,
  });
}

export async function clearPendingPost(
  kv: KVNamespace,
  userId: number,
): Promise<void> {
  await kv.delete(PENDING_POST_KEY(userId));
}

// ============ Pending Generation State ============

export interface PendingGenerationTarget {
  chatId: number;
  title: string;
  type: "channel" | "group" | "supergroup";
  username?: string;
}

export interface PendingGeneration {
  topic: string;
  style?: PostStyle;
  channelId?: string;
  generatedText?: string;
  /** Multi-select flow: which step the user is on */
  step?: "select_targets" | "enter_topic" | "preview" | "editing";
  /** Multi-select flow: selected target chats */
  selectedTargets?: PendingGenerationTarget[];
}

export async function getPendingGeneration(
  kv: KVNamespace,
  userId: number,
): Promise<PendingGeneration | null> {
  const data = await kv.get(PENDING_GENERATION_KEY(userId));
  return data ? JSON.parse(data) : null;
}

export async function setPendingGeneration(
  kv: KVNamespace,
  userId: number,
  state: PendingGeneration,
): Promise<void> {
  await kv.put(PENDING_GENERATION_KEY(userId), JSON.stringify(state), {
    expirationTtl: PENDING_TTL,
  });
}

export async function clearPendingGeneration(
  kv: KVNamespace,
  userId: number,
): Promise<void> {
  await kv.delete(PENDING_GENERATION_KEY(userId));
}

// ============ Pending Schedule State ============

export interface PendingSchedule {
  channelId?: string;
  channelChatId?: number;
  channelTitle?: string;
  text?: string;
  scheduledAt?: number;
  step: "channel" | "text" | "time" | "confirm";
}

export async function getPendingSchedule(
  kv: KVNamespace,
  userId: number,
): Promise<PendingSchedule | null> {
  const data = await kv.get(PENDING_SCHEDULE_KEY(userId));
  return data ? JSON.parse(data) : null;
}

export async function setPendingSchedule(
  kv: KVNamespace,
  userId: number,
  state: PendingSchedule,
): Promise<void> {
  await kv.put(PENDING_SCHEDULE_KEY(userId), JSON.stringify(state), {
    expirationTtl: PENDING_TTL,
  });
}

export async function clearPendingSchedule(
  kv: KVNamespace,
  userId: number,
): Promise<void> {
  await kv.delete(PENDING_SCHEDULE_KEY(userId));
}

// ============ Flood Detection State ============
//
// ⚠️ KNOWN LIMITATION: KV is eventually consistent (up to 60s propagation delay).
// Under rapid spam (many messages per second), concurrent requests may read stale
// data and each see count=1, causing flood detection to MISS fast bursts.
//
// This implementation works as a best-effort deterrent for moderate flooding
// but CANNOT reliably detect sub-second spam bursts.
//
// TODO: For reliable flood detection, migrate to Durable Objects which provide
// strong consistency, or use a per-isolate in-memory counter as a first-pass
// check before the KV fallback.

const FLOOD_KEY = (chatId: number, userId: number) =>
  `flood:${chatId}:${userId}`;
const FLOOD_TTL = 60; // 1 minute window

export interface FloodData {
  timestamps: number[];
}

export async function getFloodData(
  kv: KVNamespace,
  chatId: number,
  userId: number,
): Promise<FloodData> {
  const data = await kv.get(FLOOD_KEY(chatId, userId));
  return data ? JSON.parse(data) : { timestamps: [] };
}

export async function addFloodTimestamp(
  kv: KVNamespace,
  chatId: number,
  userId: number,
): Promise<number> {
  const now = Date.now();
  const minute = 60 * 1000;

  const data = await getFloodData(kv, chatId, userId);

  // Remove old timestamps (older than 1 minute)
  data.timestamps = data.timestamps.filter((t) => now - t < minute);

  // Add current timestamp
  data.timestamps.push(now);

  await kv.put(FLOOD_KEY(chatId, userId), JSON.stringify(data), {
    expirationTtl: FLOOD_TTL,
  });

  return data.timestamps.length;
}

export async function clearFloodData(
  kv: KVNamespace,
  chatId: number,
  userId: number,
): Promise<void> {
  await kv.delete(FLOOD_KEY(chatId, userId));
}

/**
 * Check if user is flooding (returns true if exceeds threshold)
 *
 * ⚠️ Best-effort only due to KV eventual consistency.
 * See comment at the top of this section.
 */
export async function checkFloodKV(
  kv: KVNamespace,
  chatId: number,
  userId: number,
  threshold: number,
): Promise<boolean> {
  const count = await addFloodTimestamp(kv, chatId, userId);
  return count > threshold;
}

// ============ Pending Prompt State (for proactive mode setup) ============

export interface PendingPrompt {
  chatId: number;
}

export async function getPendingPromptState(
  kv: KVNamespace,
  key: string,
): Promise<PendingPrompt | null> {
  const data = await kv.get(key);
  return data ? JSON.parse(data) : null;
}

export async function setPendingPromptState(
  kv: KVNamespace,
  key: string,
  state: PendingPrompt,
): Promise<void> {
  await kv.put(key, JSON.stringify(state), {
    expirationTtl: PENDING_TTL,
  });
}

export async function clearPendingPromptState(
	kv: KVNamespace,
	key: string,
): Promise<void> {
	await kv.delete(key);
}


