/**
 * Image Generator
 *
 * Generates images using Cloudflare Workers AI (FLUX-1 Schnell).
 * FLUX-1 Schnell is the most cost-effective option:
 * ~20 neurons per 1024x1024 image = ~500 images/day on free tier.
 *
 * Returns raw PNG bytes that can be sent via Grammy's InputFile.
 */

import { loggers } from "./logger";

const log = loggers.message;

/** Default image generation model — cheapest, good enough for memes */
const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";

/** Retry transient Workers AI errors (timeout, capacity, rate limit) */
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  retries = 2,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!/3007|3040|429|timeout|capacity/i.test(msg) || i === retries)
        throw e;
      const delay = 600 * Math.pow(2, i);
      log.warn(`[${label}] Retry ${i + 1}/${retries} in ${delay}ms: ${msg}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

/**
 * Generate an image from a text prompt using Workers AI.
 *
 * @param ai - Workers AI binding
 * @param prompt - Text description of the image to generate
 * @returns PNG image as ArrayBuffer, or null on failure
 */
export async function generateImage(
  ai: Ai,
  prompt: string,
): Promise<ArrayBuffer | null> {
  try {
    log.debug(`Generating image: "${prompt.substring(0, 80)}"`);

    const result = await withRetry(
      () => ai.run(IMAGE_MODEL, { prompt, num_steps: 4 }),
      "flux-image",
    );

    // ai.run() can return different types depending on the runtime:
    // - ReadableStream (most common in Workers)
    // - ArrayBuffer (some models / older runtimes)
    // - { image: "<base64>" } (REST API style / some Workers AI versions)

    // Handle ReadableStream (stream of raw image bytes)
    if (result instanceof ReadableStream) {
      const reader = result.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }

      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      log.debug(`Image generated (stream): ${combined.length} bytes`);
      return combined.buffer;
    }

    // Handle ArrayBuffer directly
    if (result instanceof ArrayBuffer) {
      log.debug(`Image generated (buffer): ${result.byteLength} bytes`);
      return result;
    }

    // Handle { image: "<base64>" } response (REST API / some ai.run versions)
    if (result && typeof result === "object" && "image" in result) {
      const base64 = (result as { image: string }).image;
      if (base64 && typeof base64 === "string") {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        log.debug(`Image generated (base64): ${bytes.length} bytes`);
        return bytes.buffer as ArrayBuffer;
      }
    }

    log.warn("Unexpected image generation result type", {
      type: typeof result,
      isNull: result === null,
      keys:
        result && typeof result === "object"
          ? Object.keys(result).join(",")
          : "N/A",
    });
    return null;
  } catch (error) {
    log.error("Image generation failed", error);
    return null;
  }
}
