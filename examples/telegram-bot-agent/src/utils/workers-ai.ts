/**
 * Workers AI Client
 *
 * Direct interface to Cloudflare Workers AI for on-device inference.
 * Used for tasks that don't need the full agent worker:
 * - Moderation (DistilBERT classification)
 * - Support answers (Llama 8B)
 * - Content generation (Llama 70B)
 * - Embeddings (BGE-M3)
 *
 * All functions return null if the AI binding is not available,
 * enabling graceful fallback to external providers.
 */

import { loggers } from "./logger";
import { getModel, type TaskType } from "./model-router";

const log = loggers.message;

// ─── Retry Helper ─────────────────────────────────────────────────

/**
 * Workers AI can return transient errors:
 *  - 3007: Timeout (model didn't respond in time)
 *  - 3040: Out of capacity (no GPU available)
 *  - 429:  Rate limited
 *
 * Retry with exponential backoff to handle these gracefully.
 */
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

/**
 * Retry a Workers AI call with exponential backoff.
 * Exported so other modules can wrap their direct env.AI.run() calls.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const errMsg = error instanceof Error ? error.message : String(error);
      const isRetryable =
        errMsg.includes("3007") ||
        errMsg.includes("3040") ||
        errMsg.includes("429") ||
        errMsg.includes("timeout") ||
        errMsg.includes("capacity");

      if (!isRetryable || attempt === MAX_RETRIES) {
        throw error;
      }

      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      log.warn(
        `[${label}] Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES}): ${errMsg}`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ─── Text Generation ──────────────────────────────────────────────

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Generate text using a Workers AI LLM model.
 * Automatically selects the right model for the task type.
 *
 * @returns Generated text, or null if AI is unavailable
 */
export async function generateText(
  ai: Ai,
  task: TaskType,
  messages: AiMessage[],
): Promise<string | null> {
  try {
    const model = getModel(task);
    const result = await withRetry(
      () =>
        ai.run(model as any, { messages }) as Promise<{ response?: string }>,
      `generateText:${task}`,
    );
    return result.response ?? null;
  } catch (error) {
    log.error("Workers AI text generation failed", error);
    return null;
  }
}

// ─── Classification ───────────────────────────────────────────────

export interface ClassificationResult {
  label: string;
  score: number;
}

/**
 * Classify text using DistilBERT (sentiment analysis).
 * Can be used for quick spam/toxicity screening.
 *
 * @returns Classification result, or null if AI is unavailable
 */
export async function classify(
  ai: Ai,
  text: string,
): Promise<ClassificationResult[] | null> {
  try {
    const model = getModel("moderation");
    const result = await withRetry(
      () => ai.run(model as any, { text }) as Promise<ClassificationResult[]>,
      "classify",
    );
    return result;
  } catch (error) {
    log.error("Workers AI classification failed", error);
    return null;
  }
}

// ─── Embeddings ───────────────────────────────────────────────────

/**
 * Generate embeddings for one or more texts using BGE-M3.
 *
 * @returns Array of embedding vectors, or null if AI is unavailable
 */
export async function embed(
  ai: Ai,
  texts: string[],
): Promise<number[][] | null> {
  try {
    const model = getModel("embedding");
    const result = await withRetry(
      () =>
        ai.run(model as any, { text: texts }) as Promise<{ data: number[][] }>,
      "embed",
    );
    return result.data ?? null;
  } catch (error) {
    log.error("Workers AI embedding failed", error);
    return null;
  }
}
