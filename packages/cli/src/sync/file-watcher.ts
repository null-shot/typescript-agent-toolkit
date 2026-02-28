import { watch, type FSWatcher } from "chokidar";
import * as path from "node:path";
import { buildChokidarIgnorePatterns } from "./ignore-patterns.js";

export type FileChangeType = "add" | "change" | "unlink";

export interface FileChange {
  type: FileChangeType;
  relativePath: string;
  absolutePath: string;
}

export type FileChangeHandler = (change: FileChange) => void;

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private rootDir: string;
  private handler: FileChangeHandler;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private debounceMs: number;
  private extraIgnorePatterns: string[];

  constructor(
    rootDir: string,
    handler: FileChangeHandler,
    debounceMs = 300,
    extraIgnorePatterns: string[] = [],
  ) {
    this.rootDir = rootDir;
    this.handler = handler;
    this.debounceMs = debounceMs;
    this.extraIgnorePatterns = extraIgnorePatterns;
  }

  start(): void {
    const ignored = buildChokidarIgnorePatterns(this.extraIgnorePatterns);

    this.watcher = watch(this.rootDir, {
      ignored,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    this.watcher.on("add", (filePath: string) => this.debouncedEmit("add", filePath));
    this.watcher.on("change", (filePath: string) => this.debouncedEmit("change", filePath));
    this.watcher.on("unlink", (filePath: string) => this.debouncedEmit("unlink", filePath));
  }

  private debouncedEmit(type: FileChangeType, absolutePath: string): void {
    const relativePath = "/" + path.relative(this.rootDir, absolutePath).replace(/\\/g, "/");

    const existing = this.debounceTimers.get(relativePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(relativePath);
      this.handler({ type, relativePath, absolutePath });
    }, this.debounceMs);

    this.debounceTimers.set(relativePath, timer);
  }

  async stop(): Promise<void> {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
