import * as fs from "node:fs";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { resolveResourceContext, reportApiError } from "./shared.js";

interface SharedOpts {
  roomId?: string;
  apiUrl?: string;
}

const DEFAULT_BINDING = "CACHE";

interface BulkKvEntry {
  key: string;
  value: string;
  expirationTtl?: number;
  metadata?: unknown;
}

export function buildKvCommand(): Command {
  const cmd = new Command("kv").description(
    "Manage Cloudflare KV namespace for a Jam room",
  );

  cmd
    .command("list")
    .alias("ls")
    .description("List keys in a KV binding")
    .option("--binding <name>", "KV binding", DEFAULT_BINDING)
    .option("--prefix <prefix>", "Key prefix")
    .option("--room-id <id>", "Room ID (defaults to active jam)")
    .option("--api-url <url>", "API base URL override")
    .action(async (opts: SharedOpts & { binding: string; prefix?: string }) => {
      const { client, roomId } = await resolveResourceContext(opts);
      const spinner = ora("Listing keys...").start();
      try {
        let cursor: string | undefined;
        let total = 0;
        do {
          const listOpts: { prefix?: string; cursor?: string } = {};
          if (opts.prefix !== undefined) listOpts.prefix = opts.prefix;
          if (cursor !== undefined) listOpts.cursor = cursor;
          const page = await client.listKvKeys(roomId, opts.binding, listOpts);
          spinner.stop();
          for (const k of page.keys) {
            const exp = k.expiration ? chalk.dim(`(expires ${k.expiration})`) : "";
            console.log(`  ${k.name} ${exp}`);
            total++;
          }
          cursor = page.cursor;
          if (cursor) spinner.start("Fetching next page...");
        } while (cursor);
        if (total === 0) console.log(chalk.yellow("No keys."));
        else console.log(chalk.dim(`\n${total} key(s)`));
      } catch (error) {
        spinner.stop();
        reportApiError("List KV keys", error);
      }
    });

  cmd
    .command("get")
    .description("Read a KV value")
    .argument("<key>", "Key")
    .option("--binding <name>", "KV binding", DEFAULT_BINDING)
    .option("--room-id <id>", "Room ID (defaults to active jam)")
    .option("--api-url <url>", "API base URL override")
    .action(async (key: string, opts: SharedOpts & { binding: string }) => {
      const { client, roomId } = await resolveResourceContext(opts);
      const spinner = ora(`Reading ${key}...`).start();
      try {
        const { body } = await client.getKvValue(roomId, opts.binding, key);
        spinner.stop();
        console.log(body);
      } catch (error) {
        spinner.stop();
        reportApiError("Get KV", error);
      }
    });

  cmd
    .command("put")
    .description("Write a KV value")
    .argument("<key>", "Key")
    .argument("<value>", "Value")
    .option("--binding <name>", "KV binding", DEFAULT_BINDING)
    .option("--ttl <seconds>", "Expiration TTL in seconds", (v) => parseInt(v, 10))
    .option("--room-id <id>", "Room ID (defaults to active jam)")
    .option("--api-url <url>", "API base URL override")
    .action(async (
      key: string,
      value: string,
      opts: SharedOpts & { binding: string; ttl?: number },
    ) => {
      const { client, roomId } = await resolveResourceContext(opts);
      const spinner = ora(`Writing ${key}...`).start();
      try {
        const putOpts: { expirationTtl?: number } = {};
        if (opts.ttl !== undefined) putOpts.expirationTtl = opts.ttl;
        await client.putKvValue(roomId, opts.binding, key, value, putOpts);
        spinner.succeed(chalk.green(`Set ${key}`));
      } catch (error) {
        spinner.stop();
        reportApiError("Put KV", error);
      }
    });

  cmd
    .command("delete")
    .alias("rm")
    .description("Delete a KV key")
    .argument("<key>", "Key")
    .option("--binding <name>", "KV binding", DEFAULT_BINDING)
    .option("--room-id <id>", "Room ID (defaults to active jam)")
    .option("--api-url <url>", "API base URL override")
    .action(async (key: string, opts: SharedOpts & { binding: string }) => {
      const { client, roomId } = await resolveResourceContext(opts);
      const spinner = ora(`Deleting ${key}...`).start();
      try {
        await client.deleteKvValue(roomId, opts.binding, key);
        spinner.succeed(chalk.green(`Deleted ${key}`));
      } catch (error) {
        spinner.stop();
        reportApiError("Delete KV", error);
      }
    });

  cmd
    .command("bulk")
    .description("Bulk-write a JSON file of {key,value,...} entries")
    .argument("<file>", "Path to JSON array file")
    .option("--binding <name>", "KV binding", DEFAULT_BINDING)
    .option("--room-id <id>", "Room ID (defaults to active jam)")
    .option("--api-url <url>", "API base URL override")
    .action(async (file: string, opts: SharedOpts & { binding: string }) => {
      if (!fs.existsSync(file)) {
        console.error(chalk.red(`File not found: ${file}`));
        process.exit(1);
      }
      let entries: BulkKvEntry[];
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
        if (!Array.isArray(parsed)) {
          throw new Error("File must contain a JSON array.");
        }
        entries = parsed as BulkKvEntry[];
      } catch (error) {
        console.error(
          chalk.red(
            `Could not parse ${file}: ${error instanceof Error ? error.message : error}`,
          ),
        );
        process.exit(1);
      }
      const { client, roomId } = await resolveResourceContext(opts);
      const spinner = ora(`Bulk-writing ${entries.length} key(s)...`).start();
      try {
        const { count } = await client.bulkPutKv(roomId, opts.binding, entries);
        spinner.succeed(chalk.green(`Wrote ${count} key(s)`));
      } catch (error) {
        spinner.stop();
        reportApiError("Bulk KV", error);
      }
    });

  return cmd;
}
