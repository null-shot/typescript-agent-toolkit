import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { resolveResourceContext, reportApiError } from "./shared.js";

interface SharedOpts {
  roomId?: string;
  apiUrl?: string;
}

const DEFAULT_BINDING = "FILE_STORAGE";

/**
 * Walk a glob pattern relative to cwd. We only support a small useful subset:
 * - exact paths
 * - directories (walked recursively)
 * - patterns of the form `path/**` or `path/**\/*.ext`
 */
export function expandFileGlob(pattern: string): string[] {
  const cwd = process.cwd();
  const abs = path.isAbsolute(pattern) ? pattern : path.join(cwd, pattern);

  // Strip trailing /** and any wildcard suffix to find a base directory
  const wildcardIdx = abs.search(/[*?]/);
  if (wildcardIdx === -1) {
    if (!fs.existsSync(abs)) return [];
    const stat = fs.statSync(abs);
    if (stat.isFile()) return [abs];
    if (stat.isDirectory()) return walkDir(abs);
    return [];
  }

  // Has a wildcard — find the deepest fixed prefix
  const before = abs.slice(0, wildcardIdx);
  const baseDir = before.endsWith("/")
    ? before.slice(0, -1)
    : path.dirname(before);
  const tail = abs.slice(baseDir.length + 1);

  if (!fs.existsSync(baseDir)) return [];

  const files = walkDir(baseDir);
  const regex = globToRegex(tail);
  return files.filter((f) => regex.test(path.relative(baseDir, f)));
}

function walkDir(dir: string): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...walkDir(full));
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§DOUBLESTAR§")
    .replace(/\*/g, "[^/]*")
    .replace(/§DOUBLESTAR§/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
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

export function buildStorageCommand(): Command {
  const cmd = new Command("storage").description(
    "Manage object storage for a Jam room",
  );

  cmd
    .command("list")
    .alias("ls")
    .description("List objects in a storage binding")
    .option("--binding <name>", "Storage binding", DEFAULT_BINDING)
    .option("--prefix <prefix>", "Key prefix")
    .option("--room-id <id>", "Room ID (defaults to active jam)")
    .option("--api-url <url>", "API base URL override")
    .action(async (opts: SharedOpts & { binding: string; prefix?: string }) => {
      const { client, roomId } = await resolveResourceContext(opts);
      const spinner = ora("Listing objects...").start();
      try {
        let cursor: string | undefined;
        let total = 0;
        do {
          const listOpts: { prefix?: string; cursor?: string } = {};
          if (opts.prefix !== undefined) listOpts.prefix = opts.prefix;
          if (cursor !== undefined) listOpts.cursor = cursor;
          const page = await client.listStorage(roomId, opts.binding, listOpts);
          spinner.stop();
          for (const obj of page.objects) {
            console.log(`  ${obj.key.padEnd(40)} ${obj.size} bytes  ${chalk.dim(obj.uploaded)}`);
            total++;
          }
          cursor = page.cursor;
          if (cursor) spinner.start("Fetching next page...");
        } while (cursor);
        if (total === 0) console.log(chalk.yellow("No objects."));
        else console.log(chalk.dim(`\n${total} object(s)`));
      } catch (error) {
        spinner.stop();
        reportApiError("List storage", error);
      }
    });

  cmd
    .command("upload")
    .description("Upload local files to storage via signed URL")
    .argument("<local>", "Local file or glob")
    .argument("<remote-prefix>", "Remote key prefix")
    .option("--binding <name>", "Storage binding", DEFAULT_BINDING)
    .option("--room-id <id>", "Room ID (defaults to active jam)")
    .option("--api-url <url>", "API base URL override")
    .action(async (
      local: string,
      remotePrefix: string,
      opts: SharedOpts & { binding: string },
    ) => {
      const files = expandFileGlob(local);
      if (files.length === 0) {
        console.error(chalk.red(`No files matched: ${local}`));
        process.exit(1);
      }
      const { client, roomId } = await resolveResourceContext(opts);
      const baseDir = path.isAbsolute(local) ? local : path.join(process.cwd(), local);
      const baseStat = fs.existsSync(baseDir) && fs.statSync(baseDir).isDirectory();

      let succeeded = 0;
      let failed = 0;
      for (const file of files) {
        const rel = baseStat
          ? path.relative(baseDir, file)
          : path.basename(file);
        const remoteKey = `${remotePrefix.replace(/\/$/, "")}/${rel}`.replace(/\\/g, "/");
        const stat = fs.statSync(file);
        const contentType = guessContentType(file);
        const spinner = ora(`Uploading ${rel} → ${remoteKey}...`).start();
        try {
          const { url, headers } = await client.signStoragePut(
            roomId,
            opts.binding,
            remoteKey,
            contentType,
            stat.size,
          );
          const buf = fs.readFileSync(file);
          // Convert Node Buffer to Uint8Array for fetch BodyInit compatibility.
          const body = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
          const putRes = await fetch(url, {
            method: "PUT",
            headers: {
              "Content-Type": contentType,
              "Content-Length": String(stat.size),
              ...(headers ?? {}),
            },
            body,
          });
          if (!putRes.ok) {
            const t = await putRes.text().catch(() => "");
            throw new Error(t || `PUT failed (${putRes.status})`);
          }
          spinner.succeed(chalk.green(`Uploaded ${remoteKey}`));
          succeeded++;
        } catch (error) {
          spinner.fail(
            chalk.red(
              `Failed ${rel}: ${error instanceof Error ? error.message : error}`,
            ),
          );
          failed++;
        }
      }
      console.log(
        chalk.dim(`\n${succeeded} succeeded, ${failed} failed (${files.length} total)`),
      );
      if (failed > 0) process.exit(1);
    });

  cmd
    .command("download")
    .description("Download an object via signed URL")
    .argument("<remote-key>", "Remote key")
    .argument("[local-path]", "Local path (defaults to basename of key)")
    .option("--binding <name>", "Storage binding", DEFAULT_BINDING)
    .option("--room-id <id>", "Room ID (defaults to active jam)")
    .option("--api-url <url>", "API base URL override")
    .action(async (
      remoteKey: string,
      localPath: string | undefined,
      opts: SharedOpts & { binding: string },
    ) => {
      const target = localPath ?? path.basename(remoteKey);
      const { client, roomId } = await resolveResourceContext(opts);
      const spinner = ora(`Fetching ${remoteKey}...`).start();
      try {
        const { url } = await client.signStorageGet(roomId, opts.binding, remoteKey);
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Download failed (${res.status})`);
        }
        const arr = new Uint8Array(await res.arrayBuffer());
        fs.writeFileSync(target, arr);
        spinner.succeed(chalk.green(`Saved ${arr.byteLength} bytes → ${target}`));
      } catch (error) {
        spinner.stop();
        reportApiError("Download", error);
      }
    });

  cmd
    .command("delete")
    .alias("rm")
    .description("Delete an object")
    .argument("<remote-key>", "Remote key")
    .option("--binding <name>", "Storage binding", DEFAULT_BINDING)
    .option("--room-id <id>", "Room ID (defaults to active jam)")
    .option("--api-url <url>", "API base URL override")
    .action(async (remoteKey: string, opts: SharedOpts & { binding: string }) => {
      const { client, roomId } = await resolveResourceContext(opts);
      const spinner = ora(`Deleting ${remoteKey}...`).start();
      try {
        await client.deleteStorage(roomId, opts.binding, remoteKey);
        spinner.succeed(chalk.green(`Deleted ${remoteKey}`));
      } catch (error) {
        spinner.stop();
        reportApiError("Delete", error);
      }
    });

  return cmd;
}
