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
  codeboxHttpBaseUrl: string;
  jamWsUrl: string;
  roomId: string;
  branchName: string;
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

interface CodeboxFileEntry {
  path: string;
  type: "file" | "directory";
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
  private recentlySentPaths: Map<string, number> = new Map();
  /**
   * Hashes of files written from remote. When chokidar fires a change event
   * for a file we just downloaded, we compare the current content hash against
   * this map and skip the upload if they match — avoiding the echo-back bug
   * that a fixed 500ms timeout cannot reliably prevent.
   */
  private remoteWrittenHashes: Map<string, string> = new Map();
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

    onStatus?.(`Starting file watcher...`);
    this.startFileWatcher();

    // Inject skill files in the background so they don't delay sync startup.
    // Chokidar ignores .claude/ by default so these files won't be uploaded.
    if (this.opts.onAfterInitialSync) {
      this.opts.onAfterInitialSync(localDir)
        .then((injected) => {
          if (injected.length > 0) {
            onStatus?.(chalk.dim(`Injected ${injected.length} skill file(s) into .claude/`));
          }
        })
        .catch(() => {
          // skills injection is best-effort, never block or crash
        });
    }

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

    const listing = await this.codeboxJsonRequest<{
      success: boolean;
      files?: CodeboxFileEntry[];
      error?: string;
    }>("GET", "/files?path=%2F&recursive=true");

    if (!listing.success) {
      throw new Error(`Initial sync failed: ${listing.error || "Unknown error"}`);
    }

    const fileEntries = (listing.files ?? []).filter((entry) => entry.type === "file");
    let written = 0;
    let skipped = 0;
    let unchanged = 0;

    for (const entry of fileEntries) {
      if (shouldIgnorePath(entry.path, this.projectIgnorePatterns)) {
        skipped++;
        continue;
      }

      const file = await this.codeboxJsonRequest<{
        success: boolean;
        path: string;
        content?: string;
        error?: string;
      }>(
        "GET",
        `/file?path=${encodeURIComponent(entry.path)}&raw=true`,
      );

      if (!file.success || typeof file.content !== "string") {
        throw new Error(`Failed to read ${entry.path}: ${file.error || "Unknown error"}`);
      }

      if (localHashes[entry.path] === hashContent(file.content)) {
        unchanged++;
        continue;
      }

      const localPath = path.join(this.opts.localDir, entry.path);
      const dir = path.dirname(localPath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Record the hash so the file watcher knows not to echo this write back
      this.remoteWrittenHashes.set(entry.path, hashContent(file.content));
      fs.writeFileSync(localPath, file.content, "utf-8");
      written++;
    }

    const parts: string[] = [`Downloaded ${written} file${written !== 1 ? "s" : ""}`];
    if (unchanged) parts.push(chalk.dim(`${unchanged} unchanged`));
    if (skipped > 0) parts.push(chalk.dim(`${skipped} ignored`));
    this.opts.onStatus?.(parts.join(chalk.dim(" · ")));
  }

  private startFileWatcher(): void {
    this.fileWatcher = new FileWatcher(
      this.opts.localDir,
      (change) => {
        // Guard against chokidar passing through ignored paths — glob patterns
        // using ** do not match hidden directories (e.g. .claude, .cursor)
        // in micromatch without the dot option, so enforce ignore rules here too.
        if (shouldIgnorePath(change.relativePath, this.projectIgnorePatterns)) {
          return;
        }

        if (change.type === "add" || change.type === "change") {
          const content = fs.readFileSync(change.absolutePath, "utf-8");

          // If this file was just written from remote and the content hasn't
          // changed since, suppress the echo upload.
          const remoteHash = this.remoteWrittenHashes.get(change.relativePath);
          if (remoteHash !== undefined) {
            if (remoteHash === hashContent(content)) {
              // Content is identical to what we wrote — this is chokidar
              // reporting our own download. Delete the record and skip.
              this.remoteWrittenHashes.delete(change.relativePath);
              return;
            }
            // Hash differs — the user actually edited the file after we wrote it.
            this.remoteWrittenHashes.delete(change.relativePath);
          }

          this.recentlySentPaths.set(change.relativePath, Date.now());
          const isNew = change.type === "add";
          this.writeRemoteFile(change.relativePath, content).then(() => {
            this.queueFileSyncEvent(change.relativePath, isNew ? "created" : "updated");
          }).catch((err) => {
            this.opts.onError?.(new Error(`Failed to sync ${change.relativePath}: ${err.message}`));
          });
          this.opts.onStatus?.(chalk.dim(`↑ ${change.relativePath}`));
        } else if (change.type === "unlink") {
          // Suppress echo for remote-initiated deletions
          const remoteHash = this.remoteWrittenHashes.get(change.relativePath);
          if (remoteHash === "__deleted__") {
            this.remoteWrittenHashes.delete(change.relativePath);
            return;
          }

          this.recentlySentPaths.set(change.relativePath, Date.now());
          this.deleteRemoteFile(change.relativePath).then(() => {
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

      const writeContent = (content: string) => {
        const localPath = path.join(this.opts.localDir, filePath);
        const dir = path.dirname(localPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        // Record the hash before writing so the watcher suppresses the echo
        this.remoteWrittenHashes.set(filePath, hashContent(content));
        fs.writeFileSync(localPath, content, "utf-8");
        this.opts.onStatus?.(chalk.dim(`↓ ${filePath}`));
      };

      // If the broadcast already includes content (zero extra round-trip), use it directly.
      // Otherwise fall back to an explicit cli:read_file request.
      if (typeof msg.content === "string") {
        writeContent(msg.content);
      } else {
        this.readRemoteFile(filePath)
          .then((response) => {
            if (response.success && response.content !== undefined) {
              writeContent(response.content);
            }
          })
          .catch(() => {});
      }
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
        // Suppress the unlink echo: store a sentinel hash so the watcher skips it
        this.remoteWrittenHashes.set(filePath, "__deleted__");
        fs.unlinkSync(localPath);
        this.opts.onStatus?.(chalk.dim(`↓ ${chalk.red("deleted")} ${filePath}`));
      }
    }

    if (msg.type === "cli:connected" && msg.userId !== this.opts.userId) {
      this.opts.onStatus?.(chalk.yellow("Another CLI user connected - this session will be disconnected."));
    }
  }

  private codeboxEndpoint(pathname: string): string {
    const branch = encodeURIComponent(this.opts.branchName);
    return `${this.opts.codeboxHttpBaseUrl}/code/${encodeURIComponent(this.opts.roomId)}/${branch}${pathname}`;
  }

  private async codeboxJsonRequest<T>(method: string, pathname: string, body?: unknown): Promise<T> {
    const init: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
      },
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(this.codeboxEndpoint(pathname), init);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `CodeBox request failed (${response.status})`);
    }

    return response.json() as Promise<T>;
  }

  private readRemoteFile(filePath: string): Promise<{ success: boolean; content?: string; error?: string }> {
    return this.codeboxJsonRequest(
      "GET",
      `/file?path=${encodeURIComponent(filePath)}&raw=true`,
    );
  }

  private async writeRemoteFile(filePath: string, content: string): Promise<void> {
    const result = await this.codeboxJsonRequest<{ success: boolean; error?: string }>(
      "PUT",
      `/file?path=${encodeURIComponent(filePath)}`,
      { content },
    );
    if (!result.success) {
      throw new Error(result.error || `Failed to write ${filePath}`);
    }
  }

  private async deleteRemoteFile(filePath: string): Promise<void> {
    const result = await this.codeboxJsonRequest<{ success: boolean; error?: string }>(
      "DELETE",
      `/file?path=${encodeURIComponent(filePath)}`,
    );
    if (!result.success) {
      throw new Error(result.error || `Failed to delete ${filePath}`);
    }
  }
}
