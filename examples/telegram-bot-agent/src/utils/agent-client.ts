/**
 * Agent Client
 *
 * Handles communication with the agent worker
 * Supports streaming responses for real-time updates
 */

import { loggers } from "./logger";
import { formatError } from "./helpers";
import { TelegramLog } from "./telegram-logger";

const log = loggers.agent;

/**
 * Stream response from agent and call callback for each chunk
 */
export async function streamAgentResponse(
  agentUrl: string,
  sessionId: string,
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  onChunk: (chunk: string) => Promise<void>,
  agentService?: Fetcher,
  tgLog?: TelegramLog,
): Promise<void> {
  const useServiceBinding = !!agentService;
  const url = useServiceBinding
    ? `https://service-binding/agent/chat/${sessionId}`
    : `${agentUrl}/agent/chat/${sessionId}`;

  const payload = {
    id: sessionId,
    messages,
  };

  const maxRetries = 3;
  let response: Response | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        log.debug("Retrying request", { attempt, maxRetries });
        tgLog?.warn(`Retrying request (attempt ${attempt}/${maxRetries})`);
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * Math.pow(2, attempt - 2)),
        );
      }

      log.debug("Sending request", {
        url,
        attempt,
        payloadSize: JSON.stringify(payload).length,
      });
      // #region agent log
      console.log(
        "[DEBUG:streamAgent:request]",
        JSON.stringify({
          url,
          attempt,
          useServiceBinding,
          payloadSize: JSON.stringify(payload).length,
          messageCount: messages.length,
          messageRoles: messages.map((m) => m.role),
          firstMsgPreview: messages[0]?.content?.substring(0, 100),
          hypothesisId: "A,D",
        }),
      );
      // #endregion

      const requestStartTime = Date.now();

      const finalUrl =
        useServiceBinding && !url.startsWith("http")
          ? `https://service-binding${url.startsWith("/") ? "" : "/"}${url}`
          : url;

      const request = new Request(finalUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "TelegramBot/1.0",
        },
        body: JSON.stringify(payload),
      });

      if (useServiceBinding && agentService) {
        tgLog?.thought(`Fetching via service binding`);
        // Use AbortSignal to prevent service binding from hanging indefinitely
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 50_000); // 50s timeout
        const sbRequest = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          signal: controller.signal,
        });
        response = await agentService
          .fetch(sbRequest)
          .catch((error: unknown) => {
            log.error("Service binding fetch failed", error, {
              duration: Date.now() - requestStartTime,
            });
            tgLog?.error(`Service binding fetch failed: ${formatError(error)}`);
            throw error;
          })
          .finally(() => clearTimeout(timeoutId));
      } else {
        tgLog?.thought(`Fetching via HTTP: ${agentUrl}`);
        response = await fetch(request, {
          signal: AbortSignal.timeout(60000),
        }).catch((error: unknown) => {
          log.error("HTTP fetch failed", error, {
            duration: Date.now() - requestStartTime,
          });
          tgLog?.error(`HTTP fetch failed: ${formatError(error)}`);
          throw error;
        });
      }

      const requestDuration = Date.now() - requestStartTime;
      log.debug("Request completed", {
        status: response?.status,
        duration: requestDuration,
      });
      // #region agent log
      console.log(
        "[DEBUG:streamAgent:response]",
        JSON.stringify({
          status: response?.status,
          statusText: response?.statusText,
          duration: requestDuration,
          contentType: response?.headers?.get("content-type"),
          hasBody: !!response?.body,
          hypothesisId: "A,B",
        }),
      );
      // #endregion

      if (!response) {
        throw new Error("No response received");
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        log.error("Agent error response", undefined, {
          status: response.status,
          errorText: errorText.substring(0, 200),
        });
        tgLog?.error(
          `Agent HTTP ${response.status}: ${errorText.substring(0, 100)}`,
        );

        if (
          (response.status === 404 || errorText.includes("1042")) &&
          attempt < maxRetries
        ) {
          log.warn("Retryable error, will retry", {
            status: response.status,
          });
          response = null;
          continue;
        }

        throw new Error(
          `Agent request failed: ${response.status} ${response.statusText}`,
        );
      }

      tgLog?.info(`Agent HTTP ${response.status} (${requestDuration}ms)`);
      break;
    } catch (error) {
      response = null;
      if (attempt < maxRetries) {
        log.warn("Request failed, will retry", { error, attempt });
        continue;
      }
      throw error;
    }
  }

  if (!response) {
    throw new Error("Failed to get response from agent after all retries");
  }

  try {
    const reader = response.body?.getReader();
    if (!reader) {
      // #region agent log
      console.log(
        "[DEBUG:streamAgent:noBody]",
        JSON.stringify({
          hypothesisId: "B",
        }),
      );
      // #endregion
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let hasReceivedData = false;
    let detectedFormat: string | null = null;
    // #region agent log
    let rawChunkCount = 0;
    let totalRawBytes = 0;
    let firstRawChunk = "";
    // #endregion

    log.debug(`[Stream] Starting stream processing for session ${sessionId}`);

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // #region agent log
        console.log(
          "[DEBUG:streamAgent:streamDone]",
          JSON.stringify({
            rawChunkCount,
            totalRawBytes,
            hasReceivedData,
            detectedFormat,
            remainingBuffer: buffer.substring(0, 200),
            firstRawChunk: firstRawChunk.substring(0, 300),
            hypothesisId: "B,C",
          }),
        );
        // #endregion
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      hasReceivedData = true;
      // #region agent log
      rawChunkCount++;
      totalRawBytes += value?.byteLength || 0;
      if (rawChunkCount === 1) {
        firstRawChunk = buffer.substring(0, 300);
      }
      log.debug(`[Stream] Chunk ${rawChunkCount}: ${value?.byteLength} bytes`);
      // #endregion

      // Format 1: 0:"text" (AI SDK toTextStreamResponse format)
      if (buffer.match(/^\d+:"/)) {
        if (!detectedFormat) {
          detectedFormat = "AI SDK";
          tgLog?.thought(`Stream format: AI SDK (0:"text")`);
        }
        const textFormatMatch = buffer.match(/^(\d+):"(.*)"$/s);
        if (textFormatMatch) {
          const fullText = textFormatMatch[2]
            .replace(/\\"/g, '"')
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "\r")
            .replace(/\\\\/g, "\\");
          await onChunk(fullText);
          buffer = "";
          continue;
        }
      }

      // Try line-by-line parsing for SSE format
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        // Format: data: {...}
        if (line.startsWith("data: ")) {
          if (!detectedFormat) {
            detectedFormat = "SSE";
            tgLog?.thought(`Stream format: SSE (data: {...})`);
          }
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "text-delta" && data.delta) {
              await onChunk(data.delta);
            } else if (data.type === "finish") {
              return;
            }
          } catch {
            log.warn("Failed to parse SSE line", {
              line: line.substring(0, 50),
            });
          }
        }
        // Format: 0:"text" (single line)
        else if (line.match(/^\d+:"/)) {
          if (!detectedFormat) {
            detectedFormat = "AI SDK (line)";
            tgLog?.thought(`Stream format: AI SDK line-by-line`);
          }
          const match = line.match(/^(\d+):"(.*)"$/);
          if (match) {
            const text = match[2]
              .replace(/\\"/g, '"')
              .replace(/\\n/g, "\n")
              .replace(/\\r/g, "\r")
              .replace(/\\\\/g, "\\");
            if (text) {
              await onChunk(text);
            }
          }
        }
        // Plain text fallback — preserve newlines as they are significant content
        else if (!line.startsWith("data:") && !line.match(/^\d+:/)) {
          if (!detectedFormat) {
            detectedFormat = "plain text";
            tgLog?.thought(`Stream format: plain text`);
          }
          // Add newline back since split("\n") removed it
          await onChunk(line + "\n");
        }
      }

      // Handle plain text without newlines
      if (
        buffer.trim() &&
        !buffer.match(/^\d+:"/) &&
        !buffer.startsWith("data: ")
      ) {
        if (!detectedFormat) {
          detectedFormat = "plain text (no newlines)";
          tgLog?.thought(`Stream format: plain text (buffered)`);
        }
        await onChunk(buffer);
        buffer = "";
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      if (buffer.match(/^\d+:"/)) {
        const textFormatMatch = buffer.match(/^(\d+):"(.*)"$/s);
        if (textFormatMatch) {
          const fullText = textFormatMatch[2]
            .replace(/\\"/g, '"')
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "\r")
            .replace(/\\\\/g, "\\");
          await onChunk(fullText);
          hasReceivedData = true;
        }
      } else if (buffer.startsWith("data: ")) {
        try {
          const data = JSON.parse(buffer.slice(6));
          if (data.type === "text-delta" && data.delta) {
            await onChunk(data.delta);
            hasReceivedData = true;
          }
        } catch {
          log.warn("Failed to parse SSE buffer");
        }
      } else {
        await onChunk(buffer);
        hasReceivedData = true;
      }
    }

    if (!hasReceivedData) {
      log.warn("No data received from agent response");
      tgLog?.warn("No data received from agent response (empty body)");
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      tgLog?.error("Request timeout — agent took too long");
      throw new Error("Request timeout - agent took too long to respond");
    }
    throw error;
  }
}

/**
 * Send message to agent and get full response (non-streaming)
 */
export async function sendAgentMessage(
  agentUrl: string,
  sessionId: string,
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  agentService?: Fetcher,
  tgLog?: TelegramLog,
): Promise<string> {
  let fullResponse = "";
  // #region agent log
  let chunkCount = 0;
  // #endregion

  await streamAgentResponse(
    agentUrl,
    sessionId,
    messages,
    async (chunk: string) => {
      fullResponse += chunk;
      // #region agent log
      chunkCount++;
      // #endregion
    },
    agentService,
    tgLog,
  );

  // #region agent log
  console.log(
    "[DEBUG:sendAgentMessage]",
    JSON.stringify({
      sessionId,
      chunkCount,
      responseLength: fullResponse.length,
      responsePreview: fullResponse.substring(0, 300),
      hypothesisId: "B,C",
    }),
  );
  // #endregion

  return fullResponse;
}
