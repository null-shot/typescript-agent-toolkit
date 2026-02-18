/**
 * Kanban Cron Processing
 *
 * Extracted from index.ts so both telegram-bot-agent and single-worker
 * can share the same cron logic.
 */

import {
  getScheduledDueTasks,
  getRecurringTasks,
  updateTask,
  recordTaskRun,
  addTaskLog,
  incrementTaskStat,
  findActiveTask,
} from "./kanban-storage";
import { cronMatchesNow, shouldRunAgain } from "./cron-matcher";
import { sendAgentMessage } from "./agent-client";
import { getKnowledgeBasePrompt } from "./knowledge-base";
import { loggers } from "./logger";
import { formatError } from "./helpers";
import { getTelegramApi } from "./telegram-api";
import { removeStaleBotChat } from "./bot-chats-storage";
import {
  RECURRING_POST_PROMPT,
  IMAGE_POST_PROMPT,
  MULTIFORMAT_POST_PROMPT,
  parseFormatHints,
  getPromptForFormat,
  getPromptForFormatAsync,
} from "./prompts";
import { parseContentBlock, truncateToLimit } from "../types/content";
import { publishContent } from "./content-publisher";
import {
  addPublishedPost,
  getPublishedHistory,
  formatHistoryForPrompt,
} from "./published-history";
import type { KanbanBoard } from "../types/kanban";

const log = loggers.cron;

/** Minimal env shape needed by cron processor */
export interface CronEnv {
  TELEGRAM_BOT_TOKEN: string;
  AGENT_URL?: string;
  SESSIONS: KVNamespace;
  AGENT_SERVICE?: Fetcher;
  AI?: Ai;
}

/**
 * Process kanban one-shot scheduled tasks.
 * Finds queued tasks with schedule.runAt <= now and publishes them.
 */
export async function processKanbanScheduledTasks(
  env: CronEnv,
  board?: KanbanBoard,
): Promise<void> {
  try {
    const dueTasks = await getScheduledDueTasks(env.SESSIONS, board);
    if (dueTasks.length === 0) return;

    log.info("Processing kanban scheduled tasks", { count: dueTasks.length });

    for (const task of dueTasks) {
      try {
        const content = task.approval?.editedContent || task.approval?.content;
        const targetChatId = task.approval?.targetChatId;

        if (!content || !targetChatId) {
          await updateTask(env.SESSIONS, task.id, { status: "failed" });
          await addTaskLog(
            env.SESSIONS,
            task.id,
            "Missing content or target",
            "error",
          );
          continue;
        }

        try {
          const contentBlock = parseContentBlock(content);

          // Pre-generate image if needed (same as recurring tasks)
          if (
            contentBlock.type === "photo" &&
            contentBlock.imagePrompt &&
            !contentBlock.url &&
            !contentBlock.imageBase64 &&
            env.AI
          ) {
            try {
              const { generateImage } = await import("./image-generator");
              const imageData = await generateImage(
                env.AI,
                contentBlock.imagePrompt,
              );
              if (imageData) {
                const bytes = new Uint8Array(imageData);
                let binary = "";
                for (let i = 0; i < bytes.length; i++) {
                  binary += String.fromCharCode(bytes[i]!);
                }
                contentBlock.imageBase64 = btoa(binary);
                log.info("Image pre-generated for scheduled post", {
                  taskId: task.id,
                });
              }
            } catch {
              // Non-fatal — publishContent will retry or fallback to text
            }
          }

          const api = getTelegramApi(env.TELEGRAM_BOT_TOKEN);
          await publishContent(api, targetChatId, contentBlock, env.AI);

          await updateTask(env.SESSIONS, task.id, { status: "done" });
          await recordTaskRun(env.SESSIONS, task.id);
          await addTaskLog(
            env.SESSIONS,
            task.id,
            `Published ${contentBlock.type} to ${task.approval?.targetChatTitle || targetChatId}`,
            "post",
          );

          // Update content task stats if exists
          try {
            const contentTask = await findActiveTask(
              env.SESSIONS,
              targetChatId,
              "content",
            );
            if (contentTask) {
              await incrementTaskStat(
                env.SESSIONS,
                contentTask.id,
                "postsPublished",
              );
            }
          } catch {
            /* non-critical */
          }

          log.info("Kanban scheduled post published", { taskId: task.id });
        } catch (publishError) {
          const errMsg = formatError(publishError);
          await updateTask(env.SESSIONS, task.id, { status: "failed" });
          await addTaskLog(
            env.SESSIONS,
            task.id,
            `Publish failed: ${errMsg}`,
            "error",
          );

          // Auto-cleanup stale chat entries
          if (
            errMsg.includes("chat not found") ||
            errMsg.includes("bot was kicked") ||
            errMsg.includes("bot is not a member")
          ) {
            await removeStaleBotChat(env.SESSIONS, targetChatId).catch(
              () => {},
            );
            log.warn(`Removed stale chat ${targetChatId} from bot_chats`);
          }

          log.error("Kanban scheduled post failed", publishError, {
            taskId: task.id,
          });
        }
      } catch (error) {
        await updateTask(env.SESSIONS, task.id, { status: "failed" });
        log.error("Error processing kanban scheduled task", error, {
          taskId: task.id,
        });
      }
    }
  } catch (error) {
    log.error("processKanbanScheduledTasks error", error);
  }
}

/**
 * Process kanban recurring tasks.
 * Finds in-progress recurring tasks whose cron expression matches now,
 * generates fresh AI content, and publishes.
 */
export async function processKanbanRecurringTasks(
  env: CronEnv,
  board?: KanbanBoard,
): Promise<void> {
  try {
    const recurringTasks = await getRecurringTasks(env.SESSIONS, board);
    if (recurringTasks.length === 0) return;

    const MAX_CONSECUTIVE_FAILURES = 5;

    for (const task of recurringTasks) {
      try {
        const cron = task.schedule?.cron;
        if (!cron) continue;

        // Check if cron pattern matches the current minute
        if (!cronMatchesNow(cron, task.schedule?.timezone)) continue;

        // Guard against double-execution within the same minute
        if (!shouldRunAgain(task.lastRunAt)) continue;

        // Circuit breaker: auto-pause after too many consecutive failures
        if ((task.consecutiveFailures ?? 0) >= MAX_CONSECUTIVE_FAILURES) {
          await updateTask(env.SESSIONS, task.id, { status: "failed" });
          await addTaskLog(
            env.SESSIONS,
            task.id,
            `Auto-paused after ${MAX_CONSECUTIVE_FAILURES} consecutive failures. Use /tasks to review.`,
            "error",
          );
          log.warn("Recurring task auto-paused", {
            taskId: task.id,
            failures: task.consecutiveFailures,
          });
          continue;
        }

        const targetChatId = task.approval?.targetChatId;
        if (!targetChatId) {
          await addTaskLog(
            env.SESSIONS,
            task.id,
            "Skipped: no target chat configured",
            "warning",
          );
          continue;
        }

        log.info("Recurring task triggered", {
          taskId: task.id,
          cron,
          action: task.action,
        });

        // Extract topic: prefer dedicated topic field, then approval.content,
        // then parse description for backward compatibility with old tasks
        const topic = (
          task.approval?.topic ||
          task.approval?.content ||
          task.description.replace(
            /^Generate and publish a post about:\s*/i,
            "",
          )
        ).trim();

        let content: string | undefined;

        if (!topic) {
          log.warn("Recurring task has no topic, skipping", {
            taskId: task.id,
          });
          await addTaskLog(
            env.SESSIONS,
            task.id,
            "Skipped: no topic found for content generation",
            "error",
          );
          continue;
        }

        if (task.action === "write_post" || topic) {
          // Generate fresh content via AI
          // Fallback chain: AGENT_SERVICE → AGENT_URL → Workers AI (70B)
          const agentUrl = env.AGENT_URL || "";
          const sessionId = `cron-recurring-${task.id}`;
          const useServiceBinding = !!env.AGENT_SERVICE;
          const hasAgent = !!agentUrl || useServiceBinding;

          // Load Knowledge Base for context
          const kbPrompt = await getKnowledgeBasePrompt(env.SESSIONS);

          // Parse format hints from topic (e.g. "+poll", "+audio")
          const { cleanTopic: recurringTopic, format: recurringFormat } =
            parseFormatHints(topic);
          const imagesEnabled =
            (await env.SESSIONS?.get("setting:image_with_posts")) !== "false";
          const basePrompt = await getPromptForFormatAsync(
            recurringFormat,
            !!env.AI,
            imagesEnabled,
            env.SESSIONS,
          );

          // Load published history so the AI can avoid repeating itself
          const publishedHistory = await getPublishedHistory(
            env.SESSIONS,
            task.id,
          );
          const historyPrompt = formatHistoryForPrompt(
            publishedHistory,
            recurringFormat === "auto" ? undefined : recurringFormat,
          );

          const uniquenessHint =
            recurringFormat === "poll"
              ? `\n\nThis is poll #${task.runCount + 1} in a recurring series. The topic may contain example polls — treat them as inspiration for theme and style ONLY. Invent a completely NEW question with NEW options. Never repeat a previous poll.`
              : recurringFormat === "voice"
                ? `\n\nThis is voice message #${task.runCount + 1} in a recurring series. Continue and develop the narrative — build on what was said before.`
                : `\n\nThis is post #${task.runCount + 1} in a recurring series. Each post MUST be completely different from all previous ones.`;

          const contentMessages = [
            {
              role: "system" as const,
              content:
                basePrompt +
                recurringTopic +
                kbPrompt +
                uniquenessHint +
                historyPrompt,
            },
            {
              role: "user" as const,
              content:
                recurringFormat === "poll"
                  ? `Create a new, original poll inspired by this theme: ${recurringTopic}`
                  : `Write a new post about: ${topic}`,
            },
          ];

          // Try Agent first
          if (hasAgent) {
            try {
              content = await sendAgentMessage(
                agentUrl,
                sessionId,
                contentMessages,
                useServiceBinding ? env.AGENT_SERVICE : undefined,
              );
            } catch (error) {
              log.error(
                "Agent content generation failed, trying Workers AI",
                error,
                {
                  taskId: task.id,
                },
              );
            }
          }

          // Fallback to Workers AI if agent failed or unavailable
          if ((!content || !content.trim()) && env.AI) {
            try {
              log.info("Generating content via Workers AI (70B)", {
                taskId: task.id,
              });
              const result = (await env.AI.run(
                "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as keyof AiModels,
                { messages: contentMessages } as any,
              )) as { response?: string };
              content = result.response ?? undefined;
            } catch (aiError) {
              log.error("Workers AI content generation failed", aiError, {
                taskId: task.id,
              });
            }
          }

          if (!content || !content.trim()) {
            await addTaskLog(
              env.SESSIONS,
              task.id,
              `AI generation failed: all providers exhausted`,
              "error",
            );
            log.error("All content generation methods failed", undefined, {
              taskId: task.id,
            });
            continue; // Skip this run, try next time
          }

          if (!content || content.trim().length === 0) {
            await addTaskLog(
              env.SESSIONS,
              task.id,
              "AI returned empty content, skipping",
              "warning",
            );
            continue;
          }

          content = content.trim();

          // If AI returned plain text instead of JSON, wrap as the expected format.
          const contentLooksLikeJson =
            /^\s*\{/.test(content) && content.includes('"type"');
          if (!contentLooksLikeJson && env.AI) {
            const caption =
              content.length > 500 ? truncateToLimit(content, 400) : content;

            if (recurringFormat === "voice") {
              content = JSON.stringify({
                type: "voice",
                text: content,
                caption,
              });
              log.info("Wrapped plain-text as voice post", { taskId: task.id });
            } else if (recurringFormat === "auto" && imagesEnabled) {
              // Extract keywords from generated content for a specific image prompt
              const keyWords = content
                .replace(/[^\p{L}\p{N}\s]/gu, " ")
                .split(/\s+/)
                .filter((w) => w.length > 4)
                .slice(0, 8)
                .join(", ");
              const imagePromptText = `Flat vector editorial illustration. Topic: ${recurringTopic.slice(0, 120)}. Key concepts: ${keyWords}. Minimal clean design, warm tones, no text in image.`;

              content = JSON.stringify({
                type: "photo",
                imagePrompt: imagePromptText,
                caption,
              });
              log.info("Wrapped plain-text AI response as image post", {
                taskId: task.id,
              });
            }
          }
        } else {
          // Fallback: use the original approved content (no AI regeneration)
          content = task.approval?.editedContent || task.approval?.content;
          if (!content) {
            await addTaskLog(
              env.SESSIONS,
              task.id,
              "No content available for recurring post",
              "error",
            );
            continue;
          }
        }

        // Publish — try multiformat if content looks like JSON, else plain text
        try {
          const contentBlock = parseContentBlock(content);

          // Pre-generate image if needed (avoids timeout during publish)
          if (
            contentBlock.type === "photo" &&
            contentBlock.imagePrompt &&
            !contentBlock.url &&
            !contentBlock.imageBase64 &&
            env.AI
          ) {
            try {
              const { generateImage } = await import("./image-generator");
              const imageData = await generateImage(
                env.AI,
                contentBlock.imagePrompt,
              );
              if (imageData) {
                const bytes = new Uint8Array(imageData);
                let binary = "";
                for (let i = 0; i < bytes.length; i++) {
                  binary += String.fromCharCode(bytes[i]!);
                }
                contentBlock.imageBase64 = btoa(binary);
                log.info("Image pre-generated for recurring post", {
                  taskId: task.id,
                });
              }
            } catch {
              // Non-fatal — publishContent will retry or fallback to text
            }
          }

          const api = getTelegramApi(env.TELEGRAM_BOT_TOKEN);
          await publishContent(api, targetChatId, contentBlock, env.AI);

          // Save to published history so future runs can avoid repetition
          await addPublishedPost(
            env.SESSIONS,
            task.id,
            contentBlock.type,
            content,
          );

          // Reset consecutive failure counter on success
          await updateTask(env.SESSIONS, task.id, {
            consecutiveFailures: 0,
          });
          await recordTaskRun(env.SESSIONS, task.id);
          await addTaskLog(
            env.SESSIONS,
            task.id,
            `Published ${contentBlock.type} post #${task.runCount + 1} to ${task.approval?.targetChatTitle || targetChatId}`,
            "post",
          );

          // Update content task stats if exists
          try {
            const contentTask = await findActiveTask(
              env.SESSIONS,
              targetChatId,
              "content",
            );
            if (contentTask) {
              await incrementTaskStat(
                env.SESSIONS,
                contentTask.id,
                "postsPublished",
              );
            }
          } catch {
            /* non-critical */
          }

          log.info("Recurring post published", {
            taskId: task.id,
            type: contentBlock.type,
            runCount: task.runCount + 1,
          });
        } catch (publishError) {
          const errMsg = formatError(publishError);

          // Increment consecutive failure counter
          await updateTask(env.SESSIONS, task.id, {
            consecutiveFailures: (task.consecutiveFailures ?? 0) + 1,
          });
          await addTaskLog(
            env.SESSIONS,
            task.id,
            `Publish failed: ${errMsg}`,
            "error",
          );

          // Auto-cleanup stale chat entries and stop recurring on permanent failure
          if (
            errMsg.includes("chat not found") ||
            errMsg.includes("bot was kicked") ||
            errMsg.includes("bot is not a member")
          ) {
            await removeStaleBotChat(env.SESSIONS, targetChatId).catch(
              () => {},
            );
            await updateTask(env.SESSIONS, task.id, { status: "failed" });
            await addTaskLog(
              env.SESSIONS,
              task.id,
              `Chat unreachable — task stopped. Re-add the bot as admin.`,
              "error",
            );
            log.warn(
              `Stopped recurring task ${task.id}: stale chat ${targetChatId}`,
            );
          }

          log.error("Recurring post publish failed", publishError, {
            taskId: task.id,
          });
        }
      } catch (error) {
        // Increment consecutive failure counter on exception too
        try {
          await updateTask(env.SESSIONS, task.id, {
            consecutiveFailures: (task.consecutiveFailures ?? 0) + 1,
          });
        } catch {
          /* best effort */
        }
        log.error("Error processing recurring task", error, {
          taskId: task.id,
        });
        await addTaskLog(
          env.SESSIONS,
          task.id,
          `Error: ${formatError(error)}`,
          "error",
        );
      }
    }
  } catch (error) {
    log.error("processKanbanRecurringTasks error", error);
  }
}
