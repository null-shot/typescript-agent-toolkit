/**
 * Kanban Task Board Types
 *
 * Persistent task management with Kanban-style columns:
 * - queued: Tasks waiting to be executed
 * - in-progress: Active/ongoing tasks (e.g., moderation, community engagement)
 * - awaiting-approval: Tasks needing owner confirmation before execution
 * - done: Completed or executed tasks
 * - failed: Tasks that failed
 *
 * Task kinds:
 * - one-shot: Execute once (e.g., "write a post tomorrow at 10am")
 * - recurring: Execute on schedule (e.g., "daily science fact post")
 * - persistent: Always running, accumulates stats (e.g., "moderate group")
 *
 * Task sources:
 * - owner: Created directly by the bot owner
 * - bot-escalation: Bot created this task because it couldn't handle something
 * - bot-auto: Bot created this task automatically (e.g., persistent moderation tracker)
 */

import type { BotRole } from "./bot-profile";

export type KanbanStatus =
  | "queued"
  | "in-progress"
  | "awaiting-approval"
  | "done"
  | "failed";

export type TaskKind = "one-shot" | "recurring" | "persistent";

export type TaskSource = "owner" | "bot-escalation" | "bot-auto";

/**
 * Predefined task action types for structured task creation.
 */
export type TaskAction =
  | "write_post"
  | "moderate"
  | "engage"
  | "support"
  | "custom";

export interface TaskSchedule {
  /** Cron expression for recurring tasks (e.g., "0 10 * * *" = every day at 10am) */
  cron?: string;
  /** ISO date string for one-shot scheduled tasks */
  runAt?: string;
  /** Timezone (default: UTC) */
  timezone?: string;
}

export interface TaskStats {
  [key: string]: number;
}

export interface TaskLogEntry {
  time: string;
  message: string;
  /** Optional category (e.g., "spam", "hate", "flood") */
  category?: string;
}

/**
 * Approval info — attached to tasks that need owner confirmation.
 */
export interface TaskApproval {
  /** What needs to be approved (e.g., generated post content) */
  content?: string;
  /**
   * Topic/instructions for AI content generation (recurring posts).
   * Separated from `content` which holds the actual generated text.
   * Backward compat: if absent, falls back to parsing `content` or `description`.
   */
  topic?: string;
  /** Target chat/channel for the action */
  targetChatId?: number;
  targetChatTitle?: string;
  /** When approval was requested */
  requestedAt: string;
  /** When owner responded */
  respondedAt?: string;
  /** Owner's decision */
  decision?: "approved" | "rejected" | "edited";
  /** If edited, the new content */
  editedContent?: string;
}

// ─── State Machine ─────────────────────────────────────────────────

/**
 * Valid status transitions for Kanban tasks.
 *
 * Prevents invalid moves like done → queued or failed → in-progress.
 * Any transition not listed here is rejected by `validateTransition()`.
 */
export const VALID_TRANSITIONS: Record<KanbanStatus, KanbanStatus[]> = {
  queued: ["in-progress", "done", "failed"],
  "in-progress": ["done", "failed", "awaiting-approval"],
  "awaiting-approval": ["queued", "in-progress", "done", "failed"],
  done: [], // terminal state — no further transitions
  failed: [], // terminal state — no further transitions
};

/**
 * Check whether a status transition is allowed.
 */
export function validateTransition(
  from: KanbanStatus,
  to: KanbanStatus,
): boolean {
  if (from === to) return true; // no-op is always allowed
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * Escalation info — attached to tasks created by bot for owner attention.
 */
export interface TaskEscalation {
  /** Why the bot is escalating */
  reason: string;
  /** The user who triggered the escalation */
  userId?: number;
  username?: string;
  /** Original message that caused escalation */
  originalMessage?: string;
  /** Chat where it happened */
  chatId?: number;
  chatTitle?: string;
}

export interface KanbanTask {
  id: string;
  /** Task kind */
  kind: TaskKind;
  /** Current status */
  status: KanbanStatus;
  /** How the task was created */
  source: TaskSource;
  /** Task action type (structured) */
  action?: TaskAction;
  /** Short title */
  title: string;
  /** Longer description */
  description: string;
  /** Scheduling info */
  schedule?: TaskSchedule;
  /** Accumulated stats for persistent/recurring tasks */
  stats: TaskStats;
  /** Recent log entries (last N) */
  logs: TaskLogEntry[];
  /** Target chat ID (group or channel) */
  chatId?: number;
  /** Chat title for display */
  chatTitle?: string;
  /** Associated bot role */
  role?: BotRole;
  /** Who created this task (Telegram user ID) */
  createdBy?: number;
  /** Approval info (for awaiting-approval tasks) */
  approval?: TaskApproval;
  /** Escalation info (for bot-escalation tasks) */
  escalation?: TaskEscalation;
  /** ISO timestamps */
  createdAt: string;
  updatedAt: string;
  /** Last execution time (ISO) */
  lastRunAt?: string;
  /** Number of times executed */
  runCount: number;
  /** Consecutive failure count (for recurring tasks circuit breaker) */
  consecutiveFailures?: number;
}

/**
 * Summary of all tasks for the dashboard
 */
export interface KanbanBoard {
  queued: KanbanTask[];
  inProgress: KanbanTask[];
  awaitingApproval: KanbanTask[];
  done: KanbanTask[];
  failed: KanbanTask[];
  totalTasks: number;
}
