import * as fs from "node:fs";
import * as path from "node:path";
import WebSocket, { type RawData } from "ws";
import chalk from "chalk";
import { FileWatcher } from "./file-watcher.js";
import {
  shouldIgnorePath,
  loadProjectIgnorePatterns,
  DEFAULT_NULLSHOT_IGNORE_CONTENT,
  NULLSHOT_IGNORE_FILE,
} from "./ignore-patterns.js";
import { hashContent, type FileHashMap } from "./content-hash.js";

export interface SyncOptions {
  localDir: string;
  codeboxWsUrl: string;
  jamWsUrl: string;
  userId: string;
  userName: string | null;
  sessionToken: string;
  onStatus?: (msg: string) => void;
  onError?: (err: Error) => void;
  /** Called when a remote agent starts or stops editing */
  onAgentEditingChange?: (isEditing: boolean) => void;
  /**
   * Optional hook called after initial file sync completes.
   * Use it to inject extra files (e.g. `.claude/skills/`) before the watcher
   * starts. Returning a non-empty list of paths causes them to be shown in the
   * status output.
   */
  onAfterInitialSync?: (localDir: string) => Promise<string[]>;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingFileSyncEvent {
  path: string;
  action: 'created' | 'updated' | 'deleted';
}

export class SyncEngine {
  private opts: SyncOptions;
  private codeboxWs: WebSocket | null = null;
  private jamWs: WebSocket | null = null;
  private fileWatcher: FileWatcher | null = null;
  private requestIdCounter = 0;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private recentlySentPaths: Map<string, number> = new Map();
  private remotePausedPaths: Set<string> = new Set();
  private stopped = false;
  private pendingFileSyncEvents: PendingFileSyncEvent[] = [];
  private fileSyncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private agentEditingTimer: ReturnType<typeof setTimeout> | null = null;
  private isAgentEditing = false;
  /** Extra ignore patterns loaded from .nullshotignore / .gitignore */
  private projectIgnorePatterns: string[] = [];

  constructor(opts: SyncOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    const { localDir, onStatus } = this.opts;

    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    onStatus?.(`Connecting to CodeBox...`);
    await this.connectCodebox();

    onStatus?.(`Syncing files...`);
    await this.initialSync();

    // Load project-level ignore patterns after files are on disk
    this.projectIgnorePatterns = loadProjectIgnorePatterns(localDir);

    // Write .nullshotignore so users can see what's excluded
    const ignoreFilePath = path.join(localDir, NULLSHOT_IGNORE_FILE);
    if (!fs.existsSync(ignoreFilePath)) {
      fs.writeFileSync(ignoreFilePath, DEFAULT_NULLSHOT_IGNORE_CONTENT, "utf-8");
    }

    // Allow callers to inject additional files (e.g. skill files) before the
    // watcher is started so those files are never treated as local changes.
    if (this.opts.onAfterInitialSync) {
      const injected = await this.opts.onAfterInitialSync(localDir);
      if (injected.length > 0) {
        onStatus?.(chalk.dim(`Injected ${injected.length} skill file(s) into .claude/`));
      }
    }

    onStatus?.(`Starting file watcher...`);
    this.startFileWatcher();

    onStatus?.(`Connecting to Jam session...`);
    this.connectJam();

    onStatus?.(chalk.green(`Sync active. Watching ${localDir}`));
  }

  async stop(): Promise<void> {
    this.stopped = true;

    if (this.fileSyncDebounceTimer) {
      clearTimeout(this.fileSyncDebounceTimer);
      this.fileSyncDebounceTimer = null;
    }

    if (this.agentEditingTimer) {
      clearTimeout(this.agentEditingTimer);
      this.agentEditingTimer = null;
    }

    if (this.fileWatcher) {
      await this.fileWatcher.stop();
      this.fileWatcher = null;
    }

    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Sync engine stopped"));
    }
    this.pendingRequests.clear();

    if (this.codeboxWs) {
      this.codeboxWs.close(1000, "CLI disconnecting");
      this.codeboxWs = null;
    }

    if (this.jamWs) {
      this.jamWs.close(1000, "CLI disconnecting");
      this.jamWs = null;
    }
  }

  private connectCodebox(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.codeboxWsUrl);

      ws.on("open", () => {
        this.codeboxWs = ws;
      });

      ws.on("message", (data: RawData) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleCodeboxMessage(msg);

          if (msg.type === "connected") {
            resolve();
          }
        } catch {
          // ignore parse errors
        }
      });

      ws.on("error", (err: Error) => {
        this.opts.onError?.(err);
        reject(err);
      });

      ws.on("close", (code: number, reason: Buffer) => {
        if (!this.stopped) {
          this.opts.onStatus?.(chalk.yellow(`CodeBox connection closed (${code}: ${reason}). Reconnecting in 3s...`));
          setTimeout(async () => {
            if (this.stopped) return;
            try {
              await this.connectCodebox();
              // Re-sync using hashes so we catch any remote changes that
              // occurred while the connection was down.
              await this.initialSync();
            } catch {
              // connectCodebox already schedules another retry on its close event
            }
          }, 3000);
        }
      });
    });
  }

  private connectJam(): void {
    const ws = new WebSocket(this.opts.jamWsUrl);

    ws.on("open", () => {
      this.jamWs = ws;
      this.opts.onStatus?.("Connected to Jam session");
    });

    ws.on("message", (data: RawData) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "session_status" && msg.payload?.sessionActive) {
          this.opts.onStatus?.(chalk.yellow("Agent session active - file changes from agents will sync"));
        }

        if (msg.type === "message_stopped") {
          this.opts.onStatus?.("Agent stopped");
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.on("error", (err: Error) => {
      this.opts.onError?.(err);
    });

    ws.on("close", (code: number) => {
      if (code === 4001) {
        this.opts.onStatus?.(chalk.red("Another CLI session connected. This session has been disconnected."));
        this.stop();
        return;
      }

      if (!this.stopped) {
        this.opts.onStatus?.(chalk.yellow("Jam connection lost. Reconnecting in 3s..."));
        setTimeout(() => {
          if (!this.stopped) this.connectJam();
        }, 3000);
      }
    });
  }

  /**
   * Walk the local directory and build a map of { relativePath → hash }.
   * Skips files that match the ignore list.
   */
  private buildLocalHashes(): FileHashMap {
    const hashes: FileHashMap = {};
    const base = this.opts.localDir;

    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        const rel = "/" + path.relative(base, abs).replace(/\\/g, "/");
        if (shouldIgnorePath(rel, this.projectIgnorePatterns)) continue;

        if (entry.isDirectory()) {
          walk(abs);
        } else if (entry.isFile()) {
          try {
            const content = fs.readFileSync(abs, "utf-8");
            hashes[rel] = hashContent(content);
          } catch {
            // skip unreadable files (e.g. binary)
          }
        }
      }
    };

    walk(base);
    return hashes;
  }

  private async initialSync(): Promise<void> {
    // Build hashes of whatever is already on disk from a previous session.
    // On first connect this will be empty; on reconnect it avoids re-downloading
    // files that haven't changed on the remote side.
    const localHashes = this.buildLocalHashes();
    const hasExistingFiles = Object.keys(localHashes).length > 0;

    if (hasExistingFiles) {
      this.opts.onStatus?.(chalk.dim(`Resuming — ${Object.keys(localHashes).length} local file(s) cached`));
    }

    const response = await this.sendCodeboxRequest("cli:sync_init", {
      localHashes,
    });

    if (!response.success) {
      throw new Error(`Initial sync failed: ${response.error || "Unknown error"}`);
    }

    const files = response.files as Array<{ path: string; content: string }>;
    let written = 0;
    let skipped = 0;

    for (const file of files) {
      if (shouldIgnorePath(file.path, this.projectIgnorePatterns)) {
        skipped++;
        continue;
      }

      const localPath = path.join(this.opts.localDir, file.path);
      const dir = path.dirname(localPath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Mark as remotely-paused to prevent echo back to server
      this.remotePausedPaths.add(file.path);
      fs.writeFileSync(localPath, file.content, "utf-8");
      setTimeout(() => this.remotePausedPaths.delete(file.path), 500);
      written++;
    }

    const unchanged = response.unchanged as number | undefined;
    const parts: string[] = [`Downloaded ${written} file${written !== 1 ? "s" : ""}`];
    if (unchanged) parts.push(chalk.dim(`${unchanged} unchanged`));
    if (skipped > 0) parts.push(chalk.dim(`${skipped} ignored`));
    this.opts.onStatus?.(parts.join(chalk.dim(" · ")));
  }

  private startFileWatcher(): void {
    this.fileWatcher = new FileWatcher(
      this.opts.localDir,
      (change) => {
        if (this.remotePausedPaths.has(change.relativePath)) return;

        if (change.type === "add" || change.type === "change") {
          const content = fs.readFileSync(change.absolutePath, "utf-8");
          this.recentlySentPaths.set(change.relativePath, Date.now());
          const isNew = change.type === "add";
          this.sendCodeboxRequest("cli:write_file", {
            path: change.relativePath,
            content,
          }).then(() => {
            this.queueFileSyncEvent(change.relativePath, isNew ? "created" : "updated");
          }).catch((err) => {
            this.opts.onError?.(new Error(`Failed to sync ${change.relativePath}: ${err.message}`));
          });
          this.opts.onStatus?.(chalk.dim(`↑ ${change.relativePath}`));
        } else if (change.type === "unlink") {
          this.recentlySentPaths.set(change.relativePath, Date.now());
          this.sendCodeboxRequest("cli:delete_file", {
            path: change.relativePath,
          }).then(() => {
            this.queueFileSyncEvent(change.relativePath, "deleted");
          }).catch((err) => {
            this.opts.onError?.(new Error(`Failed to delete ${change.relativePath}: ${err.message}`));
          });
          this.opts.onStatus?.(chalk.dim(`↑ ${chalk.red("deleted")} ${change.relativePath}`));
        }
      },
      300,
      this.projectIgnorePatterns,
    );

    this.fileWatcher.start();
  }

  private queueFileSyncEvent(filePath: string, action: 'created' | 'updated' | 'deleted'): void {
    // Deduplicate: if the same path already queued with same action, skip
    const exists = this.pendingFileSyncEvents.find(
      (e) => e.path === filePath && e.action === action
    );
    if (!exists) {
      this.pendingFileSyncEvents.push({ path: filePath, action });
    }

    if (this.fileSyncDebounceTimer) {
      clearTimeout(this.fileSyncDebounceTimer);
    }

    // Flush after 2s of inactivity so rapid edits are batched into one message
    this.fileSyncDebounceTimer = setTimeout(() => {
      this.flushFileSyncEvents();
    }, 2000);
  }

  private flushFileSyncEvents(): void {
    this.fileSyncDebounceTimer = null;
    if (this.pendingFileSyncEvents.length === 0) return;
    if (!this.jamWs || this.jamWs.readyState !== WebSocket.OPEN) {
      // Jam WS not ready yet, try again in 1s
      this.fileSyncDebounceTimer = setTimeout(() => this.flushFileSyncEvents(), 1000);
      return;
    }

    const events = this.pendingFileSyncEvents.splice(0);
    this.jamWs.send(
      JSON.stringify({
        type: "cli:file_sync",
        data: {
          files: events,
          userName: this.opts.userName,
          userId: this.opts.userId,
        },
      })
    );
  }

  /** Send a stop-all-agents command to the Jam room via the Jam WebSocket */
  stopRemoteAgents(roomId: string, userDisplayName: string): void {
    if (!this.jamWs || this.jamWs.readyState !== WebSocket.OPEN) {
      this.opts.onError?.(new Error("Jam WebSocket not connected"));
      return;
    }
    this.jamWs.send(
      JSON.stringify({
        type: "stop_all",
        data: {
          roomId,
          reason: "manual_stop",
          userDisplayName,
        },
      })
    );
  }

  private markAgentEditing(): void {
    if (!this.isAgentEditing) {
      this.isAgentEditing = true;
      this.opts.onAgentEditingChange?.(true);
    }
    // Reset inactivity timer — if no more agent edits for 5s, clear the flag
    if (this.agentEditingTimer) clearTimeout(this.agentEditingTimer);
    this.agentEditingTimer = setTimeout(() => {
      this.isAgentEditing = false;
      this.opts.onAgentEditingChange?.(false);
      this.agentEditingTimer = null;
    }, 5000);
  }

  private handleCodeboxMessage(msg: Record<string, any>): void {
    // Handle responses to our requests
    if (msg.requestId && this.pendingRequests.has(msg.requestId)) {
      const pending = this.pendingRequests.get(msg.requestId)!;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(msg.requestId);
      pending.resolve(msg);
      return;
    }

    // Handle file change broadcasts from other sources (agent or web)
    if (msg.type === "file:created" || msg.type === "file:updated") {
      const filePath = msg.path as string;
      if (!filePath) return;
      if (shouldIgnorePath(filePath, this.projectIgnorePatterns)) return;

      // Skip echoed changes (ones we just sent)
      const sentAt = this.recentlySentPaths.get(filePath);
      if (sentAt && Date.now() - sentAt < 2000) {
        this.recentlySentPaths.delete(filePath);
        return;
      }

      // Track when an agent is actively editing
      if (msg.source === "agent") {
        this.markAgentEditing();
      }

      // Fetch the file content and write locally
      this.sendCodeboxRequest("cli:read_file", { path: filePath })
        .then((response) => {
          if (response.success && response.content !== undefined) {
            const localPath = path.join(this.opts.localDir, filePath);
            const dir = path.dirname(localPath);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }
            this.remotePausedPaths.add(filePath);
            fs.writeFileSync(localPath, response.content as string, "utf-8");
            setTimeout(() => this.remotePausedPaths.delete(filePath), 500);
            this.opts.onStatus?.(chalk.dim(`↓ ${filePath}`));
          }
        })
        .catch(() => {});
    }

    if (msg.type === "file:deleted") {
      const filePath = msg.path as string;
      if (!filePath) return;
      if (shouldIgnorePath(filePath, this.projectIgnorePatterns)) return;

      const sentAt = this.recentlySentPaths.get(filePath);
      if (sentAt && Date.now() - sentAt < 2000) {
        this.recentlySentPaths.delete(filePath);
        return;
      }

      if (msg.source === "agent") {
        this.markAgentEditing();
      }

      const localPath = path.join(this.opts.localDir, filePath);
      if (fs.existsSync(localPath)) {
        this.remotePausedPaths.add(filePath);
        fs.unlinkSync(localPath);
        setTimeout(() => this.remotePausedPaths.delete(filePath), 500);
        this.opts.onStatus?.(chalk.dim(`↓ ${chalk.red("deleted")} ${filePath}`));
      }
    }

    if (msg.type === "cli:connected" && msg.userId !== this.opts.userId) {
      this.opts.onStatus?.(chalk.yellow("Another CLI user connected - this session will be disconnected."));
    }
  }

  private sendCodeboxRequest(type: string, payload: Record<string, any>): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      if (!this.codeboxWs || this.codeboxWs.readyState !== WebSocket.OPEN) {
        reject(new Error("CodeBox WebSocket not connected"));
        return;
      }

      const requestId = `req_${++this.requestIdCounter}`;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request ${type} timed out`));
      }, 30_000);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      this.codeboxWs.send(
        JSON.stringify({
          type,
          requestId,
          ...payload,
        })
      );
    });
  }
}
