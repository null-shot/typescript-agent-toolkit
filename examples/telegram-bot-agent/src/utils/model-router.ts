/**
 * Model Router
 *
 * Maps task types to the optimal Workers AI model.
 * Different tasks have different cost/quality trade-offs:
 *
 * - moderation:  cheap + fast (every message)     → DistilBERT
 * - support:     medium (answers with KB context)  → Llama 8B
 * - content:     premium (public-facing posts)     → Llama 70B
 * - embedding:   cheap (indexing + search)         → BGE-M3
 * - stt:         speech-to-text (voice messages)   → Whisper
 * - tts:         text-to-speech (voice replies)    → MeloTTS
 */

/** Task types that map to different model tiers */
export type TaskType =
  | "moderation"
  | "support"
  | "content"
  | "embedding"
  | "stt"
  | "tts";

/** Model name type — must be a valid Workers AI model key */
type AiModelName = keyof AiModels;

/** Default model mapping — optimised for the 10k Neurons/day free tier */
const MODEL_MAP: Record<TaskType, AiModelName> = {
  moderation: "@cf/huggingface/distilbert-sst-2-int8",
  support: "@cf/meta/llama-3.1-8b-instruct-fp8",
  content: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  embedding: "@cf/baai/bge-m3",
  stt: "@cf/openai/whisper" as AiModelName,
  tts: "@cf/myshell-ai/melotts" as AiModelName,
};

/**
 * Get the Workers AI model identifier for a given task type.
 */
export function getModel(task: TaskType): AiModelName {
  return MODEL_MAP[task];
}

/**
 * Approximate Neuron cost per request (for budget tracking).
 * These are rough estimates for typical request sizes.
 */
export const NEURON_ESTIMATES: Record<TaskType, number> = {
  moderation: 3, // DistilBERT classification
  support: 15, // ~500 input + ~300 output tokens (8B)
  content: 150, // ~500 input + ~500 output tokens (70B)
  embedding: 1, // ~200 tokens BGE-M3
  stt: 10, // ~30s Whisper transcription
  tts: 5, // ~100 chars MeloTTS synthesis
};
