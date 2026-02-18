/**
 * Chat Memory — Semantic search over group chat history
 *
 * Uses Cloudflare Workers AI (BGE-M3) for embeddings and Vectorize for storage.
 * Every group message is indexed; the bot can later search by meaning to cite
 * participants, recall past decisions, and provide contextual answers.
 *
 * All functions are graceful — if AI or Vectorize bindings are missing,
 * they silently return without breaking the bot.
 */

import type { TelegramBotEnv } from "../types/env";
import type {
  ChatMemoryMetadata,
  ChatMemorySearchResult,
} from "../types/chat-memory";
import { loggers } from "./logger";

const log = loggers.message;

/** BGE-M3 model — multilingual, 1024 dimensions, ~1 neuron per 1k tokens */
const EMBEDDING_MODEL = "@cf/baai/bge-m3";

/** Max text length stored in metadata (Vectorize limit: 10 KB per vector) */
const MAX_TEXT_LENGTH = 800;

/** Min message length worth indexing */
const MIN_TEXT_LENGTH = 10;

// ─── Embedding ─────────────────────────────────────────────────────

/**
 * Generate an embedding vector for the given text.
 * Returns null if AI binding is not available.
 */
async function getEmbedding(
  env: TelegramBotEnv,
  text: string,
): Promise<number[] | null> {
  if (!env.AI) return null;

  try {
    const result = (await env.AI.run(EMBEDDING_MODEL, {
      text: [text],
    })) as { data: number[][] };

    return result.data?.[0] ?? null;
  } catch (error) {
    log.error("Embedding generation failed", error);
    return null;
  }
}

// ─── Indexing ──────────────────────────────────────────────────────

/**
 * Index a chat message into Vectorize for later semantic search.
 * Safe to call in a fire-and-forget manner (e.g., via waitUntil).
 *
 * Skips silently if:
 * - AI or CHAT_MEMORY bindings are not configured
 * - Text is too short (< 10 chars)
 */
export async function indexMessage(
  env: TelegramBotEnv,
  chatId: number,
  messageId: number,
  userId: number,
  userName: string,
  text: string,
  replyToMessageId?: number,
): Promise<void> {
  if (!env.AI || !env.CHAT_MEMORY) {
    log.warn(
      `Chat memory skip: bindings missing (AI=${!!env.AI}, CHAT_MEMORY=${!!env.CHAT_MEMORY})`,
    );
    return;
  }
  if (text.length < MIN_TEXT_LENGTH) return;

  try {
    const embedding = await getEmbedding(env, text);
    if (!embedding) {
      log.warn(`Chat memory skip: embedding generation returned null`);
      return;
    }

    const metadata: ChatMemoryMetadata = {
      chatId,
      messageId,
      userId,
      userName,
      text: text.substring(0, MAX_TEXT_LENGTH),
      timestamp: Date.now(),
      ...(replyToMessageId ? { replyToMessageId } : {}),
    };

    const vectorId = `${chatId}_${messageId}`;

    await env.CHAT_MEMORY.upsert([
      {
        id: vectorId,
        values: embedding,
        metadata: metadata as unknown as Record<
          string,
          VectorizeVectorMetadata
        >,
      },
    ]);

    log.ok(
      `Chat memory indexed: chat=${chatId} msg=${messageId} user=@${userName} (${text.length} chars)`,
    );
  } catch (error) {
    // Non-critical — don't break message processing
    log.error("Chat memory indexing failed", error);
  }
}

// ─── Search ───────────────────────────────────────────────────────

/**
 * Search chat memory for messages semantically similar to the query.
 * Returns an empty array if bindings are not configured.
 *
 * @param env - Environment with AI and CHAT_MEMORY bindings
 * @param chatId - Restrict search to this chat
 * @param query - Natural language query
 * @param topK - Number of results to return (default: 5)
 */
export async function searchMemory(
  env: TelegramBotEnv,
  chatId: number,
  query: string,
  topK = 5,
): Promise<ChatMemorySearchResult[]> {
  if (!env.AI || !env.CHAT_MEMORY) {
    log.warn(
      `Chat memory search skip: bindings missing (AI=${!!env.AI}, CHAT_MEMORY=${!!env.CHAT_MEMORY})`,
    );
    return [];
  }

  try {
    const queryEmbedding = await getEmbedding(env, query);
    if (!queryEmbedding) {
      log.warn(`Chat memory search skip: query embedding returned null`);
      return [];
    }

    const results = await env.CHAT_MEMORY.query(queryEmbedding, {
      topK,
      filter: { chatId },
      returnMetadata: "all",
    });

    const matches = (results.matches ?? [])
      .filter((m) => m.metadata)
      .map((m) => ({
        score: m.score,
        metadata: m.metadata as unknown as ChatMemoryMetadata,
      }));

    log.ok(
      `Chat memory search: chat=${chatId} query="${query.substring(0, 50)}..." → ${matches.length} results`,
    );

    return matches;
  } catch (error) {
    log.error("Chat memory search failed", error);
    return [];
  }
}

// ─── Formatting ───────────────────────────────────────────────────

/**
 * Format search results into a context string for the AI system prompt.
 * Each result is shown as: [@UserName, date]: message text
 */
export function formatMemoryContext(results: ChatMemorySearchResult[]): string {
  if (results.length === 0) return "";

  const lines = results.map((r) => {
    const date = new Date(r.metadata.timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    return `[@${r.metadata.userName}, ${date}]: ${r.metadata.text}`;
  });

  return `\n\nRelevant chat history:\n${lines.join("\n")}`;
}
