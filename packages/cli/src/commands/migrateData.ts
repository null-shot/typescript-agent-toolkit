import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { resolveResourceContext } from "./shared.js";
import { parseDotEnv } from "./secret.js";
import { splitSqlChunks } from "./database.js";
import { expandFileGlob } from "./storage.js";

interface MigrateOptions {
  roomId?: string;
  apiUrl?: string;
  secrets?: string;
  databaseDump?: string;
  databaseBinding?: string;
  storageDir?: string;
  storageBinding?: string;
  storagePrefix?: string;
  kvDump?: string;
  kvBinding?: string;
  continueOnError?: boolean;
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
  };
  return map[ext] ?? "application/octet-stream";
}

export function buildMigrateDataCommand(): Command {
  return new Command("migrate-data")
    .description(
      "Composite import: secrets, database dump, storage dir, and KV dump in one go",
    )
    .option("--room-id <id>", "Room ID (defaults to active jam)")
    .option("--api-url <url>", "API base URL override")
    .option("--secrets <file>", ".dev.vars-style file to bulk-import")
    .option("--database-dump <file>", "SQL dump to restore")
    .option("--database-binding <name>", "Database binding", "DB")
    .option("--storage-dir <dir>", "Local directory of files to upload")
    .option("--storage-binding <name>", "Storage binding", "FILE_STORAGE")
    .option("--storage-prefix <prefix>", "Remote key prefix", "")
    .option("--kv-dump <file>", "JSON array of {key,value,...} for KV")
    .option("--kv-binding <name>", "KV binding", "CACHE")
    .option(
      "--continue-on-error",
      "Continue subsequent steps even if one fails",
      false,
    )
    .action(async (opts: MigrateOptions) => {
      if (
        !opts.secrets &&
        !opts.databaseDump &&
        !opts.storageDir &&
        !opts.kvDump
      ) {
        console.error(
          chalk.red(
            "Nothing to do. Pass at least one of --secrets / --database-dump / --storage-dir / --kv-dump.",
          ),
        );
        process.exit(1);
      }

      const ctxOpts: { apiUrl?: string; roomId?: string } = {};
      if (opts.apiUrl !== undefined) ctxOpts.apiUrl = opts.apiUrl;
      if (opts.roomId !== undefined) ctxOpts.roomId = opts.roomId;
      const { client, roomId } = await resolveResourceContext(ctxOpts);
      const errors: string[] = [];

      const runStep = async (
        label: string,
        fn: () => Promise<void>,
      ): Promise<void> => {
        const spinner = ora(label).start();
        try {
          await fn();
          spinner.succeed(chalk.green(label));
        } catch (error) {
          spinner.fail(
            chalk.red(
              `${label} — ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
          errors.push(label);
          if (!opts.continueOnError) {
            console.error(chalk.red("Aborting; pass --continue-on-error to ignore."));
            process.exit(1);
          }
        }
      };

      // 1) secrets
      if (opts.secrets) {
        await runStep(`Importing secrets from ${opts.secrets}`, async () => {
          if (!fs.existsSync(opts.secrets!)) {
            throw new Error(`File not found: ${opts.secrets}`);
          }
          const entries = parseDotEnv(fs.readFileSync(opts.secrets!, "utf-8"));
          if (entries.length === 0) return;
          await client.bulkPutSecrets(roomId, entries);
        });
      }

      // 2) database dump
      if (opts.databaseDump) {
        await runStep(
          `Restoring database ${opts.databaseBinding} from ${opts.databaseDump}`,
          async () => {
            if (!fs.existsSync(opts.databaseDump!)) {
              throw new Error(`File not found: ${opts.databaseDump}`);
            }
            const sql = fs.readFileSync(opts.databaseDump!, "utf-8");
            const chunks = splitSqlChunks(sql);
            for (const c of chunks) {
              await client.restoreDatabase(roomId, opts.databaseBinding ?? "DB", c);
            }
          },
        );
      }

      // 3) storage dir
      if (opts.storageDir) {
        await runStep(`Uploading ${opts.storageDir} → storage`, async () => {
          const baseDir = path.isAbsolute(opts.storageDir!)
            ? opts.storageDir!
            : path.join(process.cwd(), opts.storageDir!);
          if (!fs.existsSync(baseDir)) {
            throw new Error(`Directory not found: ${baseDir}`);
          }
          const files = expandFileGlob(opts.storageDir!);
          for (const file of files) {
            const rel = path.relative(baseDir, file);
            const remoteKey = `${(opts.storagePrefix ?? "").replace(/\/$/, "")}/${rel}`
              .replace(/^\/+/, "")
              .replace(/\\/g, "/");
            const stat = fs.statSync(file);
            const contentType = guessContentType(file);
            const { url, headers } = await client.signStoragePut(
              roomId,
              opts.storageBinding ?? "FILE_STORAGE",
              remoteKey,
              contentType,
              stat.size,
            );
            const buf = fs.readFileSync(file);
            const body = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
            const res = await fetch(url, {
              method: "PUT",
              headers: {
                "Content-Type": contentType,
                "Content-Length": String(stat.size),
                ...(headers ?? {}),
              },
              body,
            });
            if (!res.ok) {
              const t = await res.text().catch(() => "");
              throw new Error(`PUT ${remoteKey} failed: ${t || res.status}`);
            }
          }
        });
      }

      // 4) kv dump
      if (opts.kvDump) {
        await runStep(`Importing KV from ${opts.kvDump}`, async () => {
          if (!fs.existsSync(opts.kvDump!)) {
            throw new Error(`File not found: ${opts.kvDump}`);
          }
          const parsed = JSON.parse(fs.readFileSync(opts.kvDump!, "utf-8"));
          if (!Array.isArray(parsed)) {
            throw new Error("KV dump must be a JSON array.");
          }
          await client.bulkPutKv(roomId, opts.kvBinding ?? "CACHE", parsed);
        });
      }

      if (errors.length > 0) {
        console.log(
          chalk.yellow(
            `\nCompleted with ${errors.length} error(s): ${errors.join(", ")}`,
          ),
        );
        process.exit(1);
      } else {
        console.log(chalk.green("\nMigration complete."));
      }
    });
}
