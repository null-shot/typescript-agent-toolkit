/**
 * Kanban Task Storage — Single-Key Architecture
 *
 * All tasks stored in one KV key for efficiency (1 read instead of N+1).
 *
 * Key:
 *   kanban:board  → JSON array of KanbanTask objects
 *
 * Legacy fallback:
 *   kanban:tasks       → JSON array of task IDs (old index)
 *   kanban:task:{id}   → JSON KanbanTask object (old per-task keys)
 */

import {
  validateTransition,
  type KanbanTask,
  type KanbanBoard,
  type KanbanStatus,
  type TaskKind,
  type TaskStats,
  type TaskLogEntry,
  type TaskSource,
  type TaskAction,
  type TaskApproval,
  type TaskEscalation,
} from "../types/kanban";

const BOARD_KEY = "kanban:board";
const LEGACY_INDEX_KEY = "kanban:tasks";
const LEGACY_TASK_KEY = (id: string) => `kanban:task:${id}`;
const MAX_LOGS_PER_TASK = 100;

/**
 * Mutex guard for the board key.
 * Prevents concurrent read-modify-write within a single Worker invocation.
 */
let boardLock: Promise<void> = Promise.resolve();

async function withBoardLock<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = boardLock;
  boardLock = next;
  await previous;
  try {
    return await fn();
  } finally {
    release!();
  }
}

// ─── Internal: Raw task array read/write ────────────────────────────

async function loadAllTasks(kv: KVNamespace): Promise<KanbanTask[]> {
  const raw = await kv.get(BOARD_KEY);
  if (raw) {
    const tasks = JSON.parse(raw) as KanbanTask[];
    for (const t of tasks) {
      if (!t.source) t.source = "owner";
    }
    return tasks;
  }

  // Fallback: migrate from legacy N+1 format
  const legacyIndex = await kv.get(LEGACY_INDEX_KEY);
  if (!legacyIndex) return [];

  const ids = JSON.parse(legacyIndex) as string[];
  const tasks = (
    await Promise.all(
      ids.map(async (id) => {
        const r = await kv.get(LEGACY_TASK_KEY(id));
        if (!r) return null;
        const task = JSON.parse(r) as KanbanTask;
        if (!task.source) task.source = "owner";
        return task;
      }),
    )
  ).filter(Boolean) as KanbanTask[];

  // Persist in new format and clean up legacy keys
  await kv.put(BOARD_KEY, JSON.stringify(tasks));
  await kv.delete(LEGACY_INDEX_KEY);
  for (const id of ids) {
    await kv.delete(LEGACY_TASK_KEY(id));
  }
  console.log(`[kanban] Migrated ${tasks.length} tasks from legacy N+1 to single-key`);

  return tasks;
}

async function saveAllTasks(kv: KVNamespace, tasks: KanbanTask[]): Promise<void> {
  await kv.put(BOARD_KEY, JSON.stringify(tasks));
}

function findTaskById(tasks: KanbanTask[], id: string): KanbanTask | undefined {
  return tasks.find((t) => t.id === id);
}

// ─── Board helpers ──────────────────────────────────────────────────

function buildBoard(tasks: KanbanTask[]): KanbanBoard {
  const board: KanbanBoard = {
    queued: [],
    inProgress: [],
    awaitingApproval: [],
    done: [],
    failed: [],
    totalTasks: tasks.length,
  };

  for (const task of tasks) {
    switch (task.status) {
      case "queued":
        board.queued.push(task);
        break;
      case "in-progress":
        board.inProgress.push(task);
        break;
      case "awaiting-approval":
        board.awaitingApproval.push(task);
        break;
      case "done":
        board.done.push(task);
        break;
      case "failed":
        board.failed.push(task);
        break;
    }
  }

  board.queued.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  board.awaitingApproval.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  board.inProgress.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  board.done.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  board.failed.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  return board;
}

// ─── Read ───────────────────────────────────────────────────────────

/**
 * Get the full Kanban board (all tasks grouped by status).
 * Single KV read.
 */
export async function getKanbanBoard(kv: KVNamespace): Promise<KanbanBoard> {
  const tasks = await loadAllTasks(kv);
  return buildBoard(tasks);
}

/**
 * Get a single task by ID
 */
export async function getTask(
  kv: KVNamespace,
  id: string,
): Promise<KanbanTask | null> {
  const tasks = await loadAllTasks(kv);
  return findTaskById(tasks, id) ?? null;
}

// ─── Write ──────────────────────────────────────────────────────────

/**
 * Create a new Kanban task
 */
export async function createTask(
  kv: KVNamespace,
  task: Omit<
    KanbanTask,
    "id" | "createdAt" | "updatedAt" | "runCount" | "stats" | "logs"
  > &
    Partial<Pick<KanbanTask, "stats" | "logs" | "runCount">>,
): Promise<KanbanTask> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const newTask: KanbanTask = {
    id,
    kind: task.kind,
    status: task.status,
    source: task.source || "owner",
    action: task.action,
    title: task.title,
    description: task.description,
    schedule: task.schedule,
    stats: task.stats || {},
    logs: task.logs || [],
    chatId: task.chatId,
    chatTitle: task.chatTitle,
    role: task.role,
    createdBy: task.createdBy,
    approval: task.approval,
    escalation: task.escalation,
    createdAt: now,
    updatedAt: now,
    lastRunAt: undefined,
    runCount: task.runCount || 0,
  };

  await withBoardLock(async () => {
    const tasks = await loadAllTasks(kv);
    tasks.push(newTask);
    await saveAllTasks(kv, tasks);
  });

  return newTask;
}

/**
 * Update an existing task
 */
export async function updateTask(
  kv: KVNamespace,
  id: string,
  updates: Partial<
    Pick<
      KanbanTask,
      | "kind"
      | "status"
      | "title"
      | "description"
      | "schedule"
      | "stats"
      | "logs"
      | "lastRunAt"
      | "runCount"
      | "chatId"
      | "chatTitle"
      | "approval"
      | "escalation"
      | "action"
      | "source"
      | "consecutiveFailures"
    >
  >,
): Promise<KanbanTask | null> {
  return withBoardLock(async () => {
    const tasks = await loadAllTasks(kv);
    const task = findTaskById(tasks, id);
    if (!task) return null;

    if (updates.status && updates.status !== task.status) {
      if (!validateTransition(task.status, updates.status)) {
        throw new Error(
          `Invalid task transition: ${task.status} → ${updates.status} (task ${id})`,
        );
      }
    }

    Object.assign(task, updates, { updatedAt: new Date().toISOString() });
    await saveAllTasks(kv, tasks);
    return task;
  });
}

/**
 * Delete a task
 */
export async function deleteTask(
  kv: KVNamespace,
  id: string,
): Promise<boolean> {
  return withBoardLock(async () => {
    const tasks = await loadAllTasks(kv);
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx === -1) return false;

    tasks.splice(idx, 1);
    await saveAllTasks(kv, tasks);
    return true;
  });
}

/**
 * Move a task to a different status
 */
export async function moveTask(
  kv: KVNamespace,
  id: string,
  newStatus: KanbanStatus,
): Promise<KanbanTask | null> {
  return updateTask(kv, id, { status: newStatus });
}

// ─── Approval Workflow ──────────────────────────────────────────────

/**
 * Create a task that needs owner approval (e.g., post publishing).
 */
export async function createApprovalTask(
  kv: KVNamespace,
  opts: {
    title: string;
    description: string;
    action: TaskAction;
    content: string;
    topic?: string;
    targetChatId?: number;
    targetChatTitle?: string;
    chatId?: number;
    chatTitle?: string;
    role?: KanbanTask["role"];
    createdBy?: number;
    source?: TaskSource;
  },
): Promise<KanbanTask> {
  return createTask(kv, {
    kind: "one-shot",
    status: "awaiting-approval",
    source: opts.source || "owner",
    action: opts.action,
    title: opts.title,
    description: opts.description,
    chatId: opts.chatId,
    chatTitle: opts.chatTitle,
    role: opts.role,
    createdBy: opts.createdBy,
    approval: {
      content: opts.content,
      topic: opts.topic,
      targetChatId: opts.targetChatId,
      targetChatTitle: opts.targetChatTitle,
      requestedAt: new Date().toISOString(),
    },
  });
}

/**
 * Reject a task — moves it to failed.
 */
export async function rejectTask(
  kv: KVNamespace,
  id: string,
): Promise<KanbanTask | null> {
  return withBoardLock(async () => {
    const tasks = await loadAllTasks(kv);
    const task = findTaskById(tasks, id);
    if (!task?.approval) return null;

    const approval: KanbanTask["approval"] = {
      ...task.approval,
      respondedAt: new Date().toISOString(),
      decision: "rejected",
    };

    Object.assign(task, {
      status: "failed",
      approval,
      updatedAt: new Date().toISOString(),
    });
    await saveAllTasks(kv, tasks);
    return task;
  });
}

// ─── Escalation ─────────────────────────────────────────────────────

/**
 * Create an escalation task — bot couldn't handle something and needs owner input.
 */
export async function createEscalation(
  kv: KVNamespace,
  opts: {
    reason: string;
    userId?: number;
    username?: string;
    originalMessage?: string;
    chatId?: number;
    chatTitle?: string;
  },
): Promise<KanbanTask> {
  return createTask(kv, {
    kind: "one-shot",
    status: "queued",
    source: "bot-escalation",
    action: "custom",
    title: `Escalation: ${opts.reason.substring(0, 60)}`,
    description: opts.reason,
    chatId: opts.chatId,
    chatTitle: opts.chatTitle,
    escalation: {
      reason: opts.reason,
      userId: opts.userId,
      username: opts.username,
      originalMessage: opts.originalMessage,
      chatId: opts.chatId,
      chatTitle: opts.chatTitle,
    },
  });
}

/**
 * Get all pending escalations (for owner notification).
 */
export async function getPendingEscalations(
  kv: KVNamespace,
): Promise<KanbanTask[]> {
  const board = await getKanbanBoard(kv);
  return board.queued.filter((t) => t.source === "bot-escalation");
}

/**
 * Get all tasks awaiting approval (for owner notification).
 */
export async function getPendingApprovals(
  kv: KVNamespace,
): Promise<KanbanTask[]> {
  const board = await getKanbanBoard(kv);
  return board.awaitingApproval;
}

// ─── Stats & Logs ───────────────────────────────────────────────────

/**
 * Increment a stat counter on a task
 */
export async function incrementTaskStat(
  kv: KVNamespace,
  id: string,
  statKey: string,
  amount = 1,
): Promise<KanbanTask | null> {
  return withBoardLock(async () => {
    const tasks = await loadAllTasks(kv);
    const task = findTaskById(tasks, id);
    if (!task) return null;

    task.stats[statKey] = (task.stats[statKey] || 0) + amount;
    task.updatedAt = new Date().toISOString();

    await saveAllTasks(kv, tasks);
    return task;
  });
}

/**
 * Add a log entry to a task
 */
export async function addTaskLog(
  kv: KVNamespace,
  id: string,
  message: string,
  category?: string,
): Promise<KanbanTask | null> {
  return withBoardLock(async () => {
    const tasks = await loadAllTasks(kv);
    const task = findTaskById(tasks, id);
    if (!task) return null;

    const entry: TaskLogEntry = {
      time: new Date().toISOString(),
      message,
      category,
    };

    task.logs.push(entry);
    if (task.logs.length > MAX_LOGS_PER_TASK) {
      task.logs = task.logs.slice(-MAX_LOGS_PER_TASK);
    }
    task.updatedAt = new Date().toISOString();

    await saveAllTasks(kv, tasks);
    return task;
  });
}

/**
 * Record a task execution (increment runCount, update lastRunAt)
 */
export async function recordTaskRun(
  kv: KVNamespace,
  id: string,
): Promise<KanbanTask | null> {
  return withBoardLock(async () => {
    const tasks = await loadAllTasks(kv);
    const task = findTaskById(tasks, id);
    if (!task) return null;

    task.runCount++;
    task.lastRunAt = new Date().toISOString();
    task.updatedAt = new Date().toISOString();

    await saveAllTasks(kv, tasks);
    return task;
  });
}

// ─── Queries ────────────────────────────────────────────────────────

/**
 * Find active persistent task for a chat + role (used to link moderation/proactive)
 */
export async function findActiveTask(
  kv: KVNamespace,
  chatId: number,
  role: string,
): Promise<KanbanTask | null> {
  const board = await getKanbanBoard(kv);
  const active = board.inProgress.find(
    (t) => t.chatId === chatId && t.role === role && t.kind === "persistent",
  );
  return active || null;
}

/**
 * Find or create a persistent task for a chat + role
 */
export async function ensurePersistentTask(
  kv: KVNamespace,
  chatId: number,
  chatTitle: string,
  role: string,
  title: string,
  description: string,
  createdBy?: number,
): Promise<KanbanTask> {
  const existing = await findActiveTask(kv, chatId, role);
  if (existing) return existing;

  const roleActionMap: Record<string, KanbanTask["action"]> = {
    moderator: "moderate",
    support: "support",
    content: "write_post",
  };
  const action = roleActionMap[role] || "custom";

  return createTask(kv, {
    kind: "persistent",
    status: "in-progress",
    source: "owner",
    action,
    title,
    description,
    chatId,
    chatTitle,
    role: role as KanbanTask["role"],
    createdBy,
  });
}

/**
 * Deactivate a persistent task for a chat + role (move to "done").
 * Returns true if a task was found and deactivated.
 */
export async function deactivatePersistentTask(
  kv: KVNamespace,
  chatId: number,
  role: string,
): Promise<boolean> {
  const task = await findActiveTask(kv, chatId, role);
  if (!task) return false;

  await updateTask(kv, task.id, { status: "done" });
  await addTaskLog(kv, task.id, `Deactivated by owner`, "lifecycle");
  return true;
}

/**
 * Get aggregate stats across all active tasks for analytics.
 */
export async function getAggregateStats(kv: KVNamespace): Promise<{
  totalTasks: number;
  activeTaskCount: number;
  queuedCount: number;
  awaitingApprovalCount: number;
  doneCount: number;
  failedCount: number;
  escalationCount: number;
  statsSummary: TaskStats;
}> {
  const board = await getKanbanBoard(kv);
  const activeTasks = board.inProgress;
  const statsSummary: TaskStats = {};

  for (const task of activeTasks) {
    for (const [key, value] of Object.entries(task.stats)) {
      statsSummary[key] = (statsSummary[key] || 0) + value;
    }
  }

  const escalationCount = board.queued.filter(
    (t) => t.source === "bot-escalation",
  ).length;

  return {
    totalTasks: board.totalTasks,
    activeTaskCount: activeTasks.length,
    queuedCount: board.queued.length,
    awaitingApprovalCount: board.awaitingApproval.length,
    doneCount: board.done.length,
    failedCount: board.failed.length,
    escalationCount,
    statsSummary,
  };
}

/**
 * Remove stale tasks (cleanup).
 *
 * Removes:
 * - done/failed tasks older than maxAgeDays (default 30)
 * - orphaned escalations (queued, bot-escalation) older than escalationMaxDays (default 7)
 * - stale awaiting-approval tasks older than escalationMaxDays (default 7)
 */
export async function cleanupOldTasks(
  kv: KVNamespace,
  maxAgeDays = 30,
  escalationMaxDays = 7,
): Promise<number> {
  return withBoardLock(async () => {
    const tasks = await loadAllTasks(kv);
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const escalationCutoff = Date.now() - escalationMaxDays * 24 * 60 * 60 * 1000;

    const before = tasks.length;
    const kept = tasks.filter((task) => {
      if (
        (task.status === "done" || task.status === "failed") &&
        new Date(task.updatedAt).getTime() < cutoff
      ) {
        return false;
      }
      if (
        task.status === "queued" &&
        task.source === "bot-escalation" &&
        new Date(task.createdAt).getTime() < escalationCutoff
      ) {
        return false;
      }
      if (
        task.status === "awaiting-approval" &&
        new Date(task.createdAt).getTime() < escalationCutoff
      ) {
        return false;
      }
      return true;
    });

    const removed = before - kept.length;
    if (removed > 0) {
      await saveAllTasks(kv, kept);
    }
    return removed;
  });
}

// ─── Scheduling Queries ─────────────────────────────────────────────

/**
 * Check if there are any tasks at all (single read with cache).
 * Use this to short-circuit cron processing when the board is empty.
 */
export async function hasAnyTasks(kv: KVNamespace): Promise<boolean> {
  const raw = await kv.get(BOARD_KEY, { cacheTtl: 60 });
  if (raw) {
    const tasks = JSON.parse(raw) as KanbanTask[];
    return tasks.length > 0;
  }
  // Check legacy key too
  const legacy = await kv.get(LEGACY_INDEX_KEY, { cacheTtl: 60 });
  if (!legacy) return false;
  const ids = JSON.parse(legacy) as string[];
  return ids.length > 0;
}

/**
 * Get all queued tasks whose schedule.runAt is in the past (due for execution).
 * Accepts an optional pre-loaded board to avoid duplicate KV reads.
 */
export async function getScheduledDueTasks(
  kv: KVNamespace,
  board?: KanbanBoard,
): Promise<KanbanTask[]> {
  const b = board || (await getKanbanBoard(kv));
  const now = Date.now();

  return b.queued.filter((t) => {
    if (!t.schedule?.runAt) return false;
    return new Date(t.schedule.runAt).getTime() <= now;
  });
}

/**
 * Get all in-progress recurring tasks (kind=recurring, status=in-progress, has schedule.cron).
 * Accepts an optional pre-loaded board to avoid duplicate KV reads.
 */
export async function getRecurringTasks(
  kv: KVNamespace,
  board?: KanbanBoard,
): Promise<KanbanTask[]> {
  const b = board || (await getKanbanBoard(kv));

  return b.inProgress.filter((t) => t.kind === "recurring" && t.schedule?.cron);
}
