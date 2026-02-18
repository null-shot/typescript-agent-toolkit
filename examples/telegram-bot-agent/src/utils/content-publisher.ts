/**
 * Content Publisher
 *
 * Maps ContentBlock types to the correct Telegram Bot API method.
 * Uses Grammy Api for typed, reliable delivery.
 */

import type { Api } from "grammy";
import { InputFile } from "grammy";
import type { ContentBlock } from "../types/content";
import { generateImage } from "./image-generator";
import { loggers } from "./logger";

const log = loggers.message;

/**
 * Publish a ContentBlock to a Telegram chat.
 * Returns the message_id of the sent message.
 *
 * @param api - Grammy Api instance
 * @param chatId - Target chat ID
 * @param content - Content to publish
 * @param ai - Optional Workers AI binding (needed for image generation)
 */
export async function publishContent(
  api: Api,
  chatId: number | string,
  content: ContentBlock,
  ai?: Ai,
): Promise<number> {
  switch (content.type) {
    case "text": {
      const msg = await api.sendMessage(chatId, content.text, {
        parse_mode: content.parseMode,
      });
      return msg.message_id;
    }

    case "photo": {
      let photoSource: string | InputFile;

      if (content.imageBase64) {
        // Pre-generated image (from approval flow) — fastest path
        const binaryString = atob(content.imageBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        photoSource = new InputFile(bytes, "generated.png");
      } else if (content.url) {
        photoSource = content.url;
      } else if (content.imagePrompt && ai) {
        // Generate image on-the-fly via Workers AI (fallback)
        const imageData = await generateImage(ai, content.imagePrompt);
        if (imageData) {
          photoSource = new InputFile(
            new Uint8Array(imageData),
            "generated.png",
          );
        } else {
          // Fallback: send as text if image generation failed
          log.warn("Image generation failed, falling back to text");
          const fallbackText = content.caption || content.imagePrompt;
          const msg = await api.sendMessage(chatId, fallbackText);
          return msg.message_id;
        }
      } else {
        // No image source — send caption as text
        const msg = await api.sendMessage(
          chatId,
          content.caption || "(No image available)",
        );
        return msg.message_id;
      }

      const msg = await api.sendPhoto(chatId, photoSource, {
        caption: content.caption,
        parse_mode: content.parseMode,
      });
      return msg.message_id;
    }

    case "poll": {
      const msg = await api.sendPoll(
        chatId,
        content.question,
        content.options,
        {
          is_anonymous: content.isAnonymous ?? true,
          allows_multiple_answers: content.allowsMultipleAnswers ?? false,
        },
      );
      return msg.message_id;
    }

    case "animation": {
      const msg = await api.sendAnimation(chatId, content.url, {
        caption: content.caption,
      });
      return msg.message_id;
    }

    case "media_group": {
      const media = content.media.map((item, i) => ({
        type: item.type as "photo" | "video",
        media: item.url,
        ...(i === 0 && item.caption ? { caption: item.caption } : {}),
      }));

      const msgs = await api.sendMediaGroup(chatId, media as any);
      return msgs[0].message_id;
    }

    case "document": {
      const msg = await api.sendDocument(chatId, content.url, {
        caption: content.caption,
      });
      return msg.message_id;
    }

    case "voice": {
      if (!ai) {
        // No AI binding — send as text
        const msg = await api.sendMessage(
          chatId,
          content.caption || content.text,
        );
        return msg.message_id;
      }

      try {
        const { synthesizeSpeech, detectLanguageForTTS, isTTSSupported } =
          await import("./voice-handler");

        const lang = content.lang || detectLanguageForTTS(content.text);
        if (!isTTSSupported(lang)) {
          log.warn(`TTS not supported for language "${lang}", sending as text`);
          const msg = await api.sendMessage(
            chatId,
            content.caption || content.text,
          );
          return msg.message_id;
        }

        const audioBuffer = await synthesizeSpeech(ai, content.text, lang!);
        if (!audioBuffer || audioBuffer.byteLength === 0) {
          log.warn("TTS synthesis returned empty audio, sending as text");
          const msg = await api.sendMessage(
            chatId,
            content.caption || content.text,
          );
          return msg.message_id;
        }

        // Send voice only — no separate text message
        const voiceFile = new InputFile(
          new Uint8Array(audioBuffer),
          "voice.ogg",
        );
        const voiceMsg = await api.sendVoice(chatId, voiceFile);

        return voiceMsg.message_id;
      } catch (voiceError) {
        log.error("Voice publishing failed, falling back to text", voiceError);
        const msg = await api.sendMessage(
          chatId,
          content.caption || content.text,
        );
        return msg.message_id;
      }
    }

    default: {
      // Unknown type — treat content as text
      const msg = await api.sendMessage(chatId, JSON.stringify(content));
      return msg.message_id;
    }
  }
}
