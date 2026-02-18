/**
 * Chat Memory Types
 *
 * Types for the semantic chat memory system backed by Vectorize + BGE-M3 embeddings.
 * Every group message is embedded and stored, enabling semantic search over chat history.
 */

/** Metadata stored alongside each vector in Vectorize */
export interface ChatMemoryMetadata {
  /** Telegram chat ID (group/supergroup) */
  chatId: number;
  /** Telegram message ID */
  messageId: number;
  /** Author's Telegram user ID */
  userId: number;
  /** Author's display name */
  userName: string;
  /** Message text (truncated to fit Vectorize metadata limits) */
  text: string;
  /** Unix timestamp (ms) */
  timestamp: number;
  /** If this was a reply, the original message ID */
  replyToMessageId?: number;
}

/** Single result from a semantic memory search */
export interface ChatMemorySearchResult {
  /** Cosine similarity score (0–1, higher = more relevant) */
  score: number;
  /** The stored metadata */
  metadata: ChatMemoryMetadata;
}
