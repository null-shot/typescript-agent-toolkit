/**
 * Voice Handler
 *
 * Speech-to-text (Whisper) and text-to-speech (MeloTTS) using Workers AI.
 * Enables voice-in → voice-out interaction in Telegram.
 *
 * Flow:
 *   1. User sends voice message → Telegram stores OGG/Opus file
 *   2. Bot downloads file via Telegram API → base64
 *   3. Whisper transcribes to text
 *   4. Text processed by normal message pipeline → response text
 *   5. MeloTTS converts response to audio
 *   6. Bot sends voice message back
 *
 * Both models are on Workers AI free tier (10k neurons/day).
 */

import { Api, InputFile } from "grammy";
import { loggers } from "./logger";

const log = loggers.message;

const WHISPER_MODEL = "@cf/openai/whisper" as keyof AiModels;
const MELOTTS_MODEL = "@cf/myshell-ai/melotts" as keyof AiModels;

/** Retry transient Workers AI errors (timeout, capacity, rate limit) */
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 600;

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      const retryable = /3007|3040|429|timeout|capacity/i.test(msg);
      if (!retryable || attempt === MAX_RETRIES) throw error;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      log.warn(
        `[${label}] Retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms: ${msg}`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

/** Maximum voice message duration we'll process (seconds) */
const MAX_VOICE_DURATION = 120;

/** Maximum voice file size we'll process (bytes) — Workers AI has request limits */
const MAX_VOICE_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/** Maximum response text length for TTS (chars) — MeloTTS has limits */
const MAX_TTS_TEXT_LENGTH = 1000;

/**
 * Transcribe a voice message using Whisper on Workers AI.
 *
 * @param ai - Workers AI binding
 * @param audioBase64 - Base64-encoded audio data (OGG/Opus from Telegram)
 * @param language - Optional ISO 639-1 language hint (auto-detects if omitted)
 * @returns Transcribed text, or null on failure
 */
export async function transcribeVoice(
  ai: Ai,
  audioBase64: string,
  language?: string,
): Promise<string | null> {
  try {
    // Whisper expects audio as a number array (raw bytes), NOT a base64 string.
    // Decode base64 → Uint8Array → number[] for the ai.run() binding.
    const binaryString = atob(audioBase64);
    const audioBytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      audioBytes[i] = binaryString.charCodeAt(i);
    }

    log.debug(`Transcribing ${audioBytes.length} bytes of audio`);

    const params: Record<string, unknown> = {
      audio: Array.from(audioBytes),
    };
    if (language) {
      params.language = language;
    }

    const result = await withRetry(
      () =>
        ai.run(WHISPER_MODEL, params as any) as Promise<{
          text?: string;
          vtt?: string;
        }>,
      "whisper-stt",
    );

    const text = result.text?.trim();
    if (!text) {
      log.warn("Whisper returned empty transcription");
      return null;
    }

    log.info("Voice transcribed", { length: text.length });
    return text;
  } catch (error) {
    log.error("Voice transcription failed", error);
    return null;
  }
}

/**
 * Synthesize speech from text using MeloTTS on Workers AI.
 *
 * @param ai - Workers AI binding
 * @param text - Text to convert to speech
 * @param lang - Language code ('en', 'fr', 'es', etc.)
 * @returns MP3 audio as ArrayBuffer, or null on failure
 */
export async function synthesizeSpeech(
  ai: Ai,
  text: string,
  lang: string = "en",
): Promise<ArrayBuffer | null> {
  try {
    // Truncate long text to avoid model limits
    const truncatedText =
      text.length > MAX_TTS_TEXT_LENGTH
        ? text.substring(0, MAX_TTS_TEXT_LENGTH) + "..."
        : text;

    const result = await withRetry(
      () =>
        ai.run(MELOTTS_MODEL, {
          prompt: truncatedText,
          lang,
        } as any) as Promise<{ audio?: string } | ReadableStream<Uint8Array>>,
      "melotts-tts",
    );

    // Handle different response types
    if (result instanceof ReadableStream) {
      const reader = result.getReader();
      const chunks: Uint8Array[] = [];
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value) chunks.push(value);
      }
      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      log.info("Speech synthesized (stream)", { bytes: totalLength });
      return combined.buffer as ArrayBuffer;
    }

    if (
      result &&
      typeof result === "object" &&
      "audio" in result &&
      result.audio
    ) {
      // Base64 encoded audio
      const binaryString = atob(result.audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      log.info("Speech synthesized (base64)", { bytes: bytes.length });
      return bytes.buffer as ArrayBuffer;
    }

    log.warn("MeloTTS returned unexpected result type");
    return null;
  } catch (error) {
    log.error("Speech synthesis failed", error);
    return null;
  }
}

/**
 * Download a Telegram voice file and return it as base64.
 *
 * @param api - Grammy Api instance
 * @param fileId - Telegram file_id from voice message
 * @param botToken - Bot token for file download URL
 * @returns Base64 encoded audio, or null on failure
 */
export async function downloadVoiceFile(
  api: Api,
  fileId: string,
  botToken: string,
): Promise<string | null> {
  try {
    const file = await api.getFile(fileId);
    if (!file.file_path) {
      log.warn("No file_path in Telegram getFile response");
      return null;
    }

    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
    const response = await fetch(fileUrl);

    if (!response.ok) {
      log.error("Failed to download voice file", undefined, {
        status: String(response.status),
      });
      return null;
    }

    const buffer = await response.arrayBuffer();

    if (buffer.byteLength > MAX_VOICE_FILE_SIZE) {
      log.warn("Voice file too large", {
        bytes: buffer.byteLength,
        max: MAX_VOICE_FILE_SIZE,
      });
      return null;
    }

    // Convert to base64
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    const base64 = btoa(binary);

    log.info("Voice file downloaded", { bytes: buffer.byteLength });
    return base64;
  } catch (error) {
    log.error("Failed to download voice file", error);
    return null;
  }
}

/**
 * Send a voice response message in Telegram.
 *
 * @param api - Grammy Api instance
 * @param chatId - Target chat ID
 * @param audioBuffer - MP3 audio as ArrayBuffer
 * @param replyToMessageId - Optional message to reply to
 * @returns message_id on success, null on failure
 */
export async function sendVoiceResponse(
  api: Api,
  chatId: number,
  audioBuffer: ArrayBuffer,
  replyToMessageId?: number,
): Promise<number | null> {
  const audioSize = audioBuffer.byteLength;
  if (audioSize === 0) {
    log.warn("sendVoiceResponse: empty audio buffer, skipping");
    return null;
  }

  const replyParams = replyToMessageId
    ? { reply_parameters: { message_id: replyToMessageId } }
    : {};

  // Detect format: MeloTTS returns WAV (RIFF header), Telegram sendVoice needs OGG Opus.
  // Strategy: try sendVoice first (works if OGG), fall back to sendAudio (accepts WAV/MP3).
  const bytes = new Uint8Array(audioBuffer);
  const isWav =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46; // "RIFF"

  try {
    log.debug(
      `Sending voice: ${audioSize} bytes, format: ${isWav ? "WAV" : "unknown/OGG"}`,
    );

    if (isWav) {
      // WAV is not supported by sendVoice — use sendAudio instead
      // sendAudio accepts WAV, MP3, and other formats and shows as audio message
      const file = new InputFile(bytes, "response.wav");
      const msg = await api.sendAudio(chatId, file, {
        title: "Voice Response",
        ...replyParams,
      });
      log.info("Audio response sent (WAV via sendAudio)", {
        messageId: msg.message_id,
        audioSize,
      });
      return msg.message_id;
    }

    // OGG or other format — try sendVoice (shows as voice bubble)
    const file = new InputFile(bytes, "response.ogg");
    const msg = await api.sendVoice(chatId, file, replyParams);
    log.info("Voice response sent (sendVoice)", {
      messageId: msg.message_id,
      audioSize,
    });
    return msg.message_id;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error("Failed to send voice/audio response", error, {
      chatId: String(chatId),
      audioSize: String(audioSize),
      isWav: String(isWav),
      errorMessage: errorMsg,
    });

    // Last resort: try the other method
    try {
      if (isWav) {
        const file = new InputFile(bytes, "response.ogg");
        const msg = await api.sendVoice(chatId, file, replyParams);
        return msg.message_id;
      } else {
        const file = new InputFile(bytes, "response.wav");
        const msg = await api.sendAudio(chatId, file, { ...replyParams });
        return msg.message_id;
      }
    } catch (fallbackError) {
      log.error("Fallback audio send also failed", fallbackError);
      return null;
    }
  }
}

/**
 * MeloTTS supported languages: EN, ES, FR, ZH, JA, KO
 * Russian and other languages are NOT supported.
 */
const TTS_SUPPORTED_LANGS = new Set(["en", "es", "fr", "zh", "ja", "ko"]);

/**
 * Detect language from text and check if TTS can handle it.
 * Returns the lang code if supported, or null if TTS cannot synthesize this language.
 */
export function detectLanguageForTTS(text: string): string | null {
  // Cyrillic → Russian — NOT supported by MeloTTS
  if (/[а-яА-ЯёЁ]/.test(text)) return null;
  // CJK (Chinese)
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";
  // Japanese
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return "ja";
  // Korean
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  // French accents
  if (/[àâçéèêëîïôûùüÿñæœ]/i.test(text)) return "fr";
  // Spanish
  if (/[¿¡ñáéíóú]/i.test(text)) return "es";
  // Arabic, Hebrew, Thai, etc. — NOT supported
  if (/[\u0600-\u06ff\u0590-\u05ff\u0e00-\u0e7f]/i.test(text)) return null;

  return "en";
}

/** Check if a language is supported by MeloTTS */
export function isTTSSupported(lang: string | null): lang is string {
  return lang !== null && TTS_SUPPORTED_LANGS.has(lang);
}

/** Check if voice message is within processable limits */
export function isVoiceProcessable(duration: number): boolean {
  return duration > 0 && duration <= MAX_VOICE_DURATION;
}
