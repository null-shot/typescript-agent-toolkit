/**
 * Bot Chats Storage
 *
 * Tracks all chats (groups + channels) where the bot is a member/admin.
 * Populated automatically via `my_chat_member` Telegram updates.
 *
 * Key: `bot_chats` → global list
 * Key: `bot_chats:owner:{userId}` → chats added by a specific user (who added bot)
 */

export interface BotChat {
  chatId: number;
  title: string;
  type: "group" | "supergroup" | "channel";
  username?: string;
  /** Bot's role in this chat */
  role:
    | "member"
    | "administrator"
    | "creator"
    | "restricted"
    | "left"
    | "kicked";
  /** Can the bot post messages? */
  canPost: boolean;
  /** Who added the bot (Telegram user_id), if known */
  addedBy?: number;
  /** When the bot joined / status changed */
  updatedAt: number;
}

const GLOBAL_KEY = "bot_chats";
const OWNER_KEY = (userId: number) => `bot_chats:owner:${userId}`;

// ─── Global list ────────────────────────────────────────────────

/**
 * Get ALL chats where the bot is present.
 */
export async function getAllBotChats(kv: KVNamespace): Promise<BotChat[]> {
  const data = await kv.get(GLOBAL_KEY, "json");
  return (data as BotChat[]) || [];
}

/**
 * Get chats where the bot can post (role = admin/member + canPost).
 */
export async function getPostableBotChats(kv: KVNamespace): Promise<BotChat[]> {
  const all = await getAllBotChats(kv);
  return all.filter(
    (c) => c.canPost && (c.role === "administrator" || c.role === "creator"),
  );
}

/**
 * Get only channels where the bot is admin.
 */
export async function getBotChannels(kv: KVNamespace): Promise<BotChat[]> {
  const all = await getPostableBotChats(kv);
  return all.filter((c) => c.type === "channel");
}

/**
 * Get only groups where the bot is admin.
 */
export async function getBotGroups(kv: KVNamespace): Promise<BotChat[]> {
  const all = await getPostableBotChats(kv);
  return all.filter((c) => c.type === "group" || c.type === "supergroup");
}

/**
 * Upsert a bot chat entry (called on my_chat_member updates).
 */
export async function upsertBotChat(
  kv: KVNamespace,
  chat: BotChat,
): Promise<void> {
  const all = await getAllBotChats(kv);
  const idx = all.findIndex((c) => c.chatId === chat.chatId);

  if (idx >= 0) {
    all[idx] = chat;
  } else {
    all.push(chat);
  }

  // Remove chats where bot was kicked/left
  const active = all.filter((c) => c.role !== "left" && c.role !== "kicked");

  await kv.put(GLOBAL_KEY, JSON.stringify(active));

  // Also track per-owner if known
  if (chat.addedBy && chat.role !== "left" && chat.role !== "kicked") {
    await addToOwnerList(kv, chat.addedBy, chat);
  }
}

/**
 * Remove a bot chat entry (bot was removed from chat).
 */
export async function removeBotChat(
  kv: KVNamespace,
  chatId: number,
): Promise<void> {
  const all = await getAllBotChats(kv);
  const filtered = all.filter((c) => c.chatId !== chatId);
  await kv.put(GLOBAL_KEY, JSON.stringify(filtered));
}

/**
 * Remove a stale bot chat entry when Telegram returns "chat not found".
 *
 * This is called automatically when posting fails because the bot
 * was removed, the channel was deleted, or the bot token changed.
 * Returns true if the entry was found and removed.
 */
export async function removeStaleBotChat(
  kv: KVNamespace,
  chatId: number,
): Promise<boolean> {
  const all = await getAllBotChats(kv);
  const before = all.length;
  const filtered = all.filter((c) => c.chatId !== chatId);
  if (filtered.length < before) {
    await kv.put(GLOBAL_KEY, JSON.stringify(filtered));
    return true;
  }
  return false;
}

/**
 * Lazily register a chat if not already tracked.
 *
 * Used by both core-handlers (channel_post) and message-handler (group messages).
 * Returns true if the chat was newly registered, false if already known.
 */
export async function ensureChatRegistered(
  kv: KVNamespace,
  chatId: number,
  chatTitle: string,
  chatType: "group" | "supergroup" | "channel",
  username?: string,
  addedBy?: number,
): Promise<boolean> {
  const allChats = await getAllBotChats(kv);
  if (allChats.some((c) => c.chatId === chatId)) return false;

  await upsertBotChat(kv, {
    chatId,
    title: chatTitle,
    type: chatType,
    username,
    role: "administrator", // Assume admin since we're receiving messages
    canPost: true,
    addedBy,
    updatedAt: Date.now(),
  });
  return true;
}

// ─── Per-owner list ─────────────────────────────────────────────

/**
 * Get chats where the bot was added by a specific user.
 */
export async function getOwnerBotChats(
  kv: KVNamespace,
  userId: number,
): Promise<BotChat[]> {
  const data = await kv.get(OWNER_KEY(userId), "json");
  return (data as BotChat[]) || [];
}

async function addToOwnerList(
  kv: KVNamespace,
  userId: number,
  chat: BotChat,
): Promise<void> {
  const chats = await getOwnerBotChats(kv, userId);
  const idx = chats.findIndex((c) => c.chatId === chat.chatId);

  if (idx >= 0) {
    chats[idx] = chat;
  } else {
    chats.push(chat);
  }

  await kv.put(OWNER_KEY(userId), JSON.stringify(chats));
}

/**
 * Remove from owner list when bot leaves.
 */
export async function removeFromOwnerList(
  kv: KVNamespace,
  userId: number,
  chatId: number,
): Promise<void> {
  const chats = await getOwnerBotChats(kv, userId);
  const filtered = chats.filter((c) => c.chatId !== chatId);
  await kv.put(OWNER_KEY(userId), JSON.stringify(filtered));
}
