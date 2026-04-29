import * as fs from "node:fs";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import prompts from "prompts";
import { resolveResourceContext, reportApiError } from "./shared.js";

interface SharedOpts {
  roomId?: string;
  apiUrl?: string;
}

/**
 * Parses dotenv-style files (`KEY=VALUE` per line). Supports `#` comments and
 * optional surrounding `'` or `"` quotes.
 */
export function parseDotEnv(contents: string): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  const lines = contents.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    // strip surrounding quotes
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out.push({ key, value });
  }
  return out;
}

export function buildSecretCommand(): Command {
  const cmd = new Command("secret").description(
    "Manage secrets for a Jam room (Worker bindings)",
  );

  cmd
    .command("list")
    .description("List secret keys (values are never returned)")
    .option("--room-id <id>", "Room ID (defaults to active jam)")
    .option("--api-url <url>", "API base URL override")
    .action(async (opts: SharedOpts) => {
      const { client, roomId } = await resolveResourceContext(opts);
      const spinner = ora("Fetching secrets...").start();
      try {
        const { keys } = await client.listSecrets(roomId);
        spinner.stop();
        if (keys.length === 0) {
          console.log(chalk.yellow("No secrets configured."));
          return;
        }
        for (const k of keys) {
          console.log(`  ${k}`);
        }
      } catch (error) {
        spinner.stop();
        reportApiError("List secrets", error);
      }
    });

  cmd
    .command("put")
    .description("Set a secret value (prompts if --value omitted)")
    .argument("<key>", "Secret key")
    .option("--value <value>", "Secret value (otherwise prompted, hidden)")
    .option("--force", "Overwrite without confirming")
    .option("--room-id <id>", "Room ID (defaults to active jam)")
    .option("--api-url <url>", "API base URL override")
    .action(async (
      key: string,
      opts: SharedOpts & { value?: string; force?: boolean },
    ) => {
      const { client, roomId } = await resolveResourceContext(opts);

      if (!opts.force) {
        try {
          const { keys } = await client.listSecrets(roomId);
          if (keys.includes(key)) {
            const ans = await prompts({
              type: "confirm",
              name: "ok",
              message: `Secret "${key}" already exists — overwrite?`,
              initial: false,
            });
            if (!ans.ok) {
              console.log(chalk.yellow("Aborted."));
              return;
            }
          }
        } catch {
          // best-effort overwrite check; skip if listing fails
        }
      }

      let value = opts.value;
      if (value === undefined) {
        const ans = await prompts({
          type: "password",
          name: "value",
          message: `Value for ${key}`,
        });
        value = typeof ans.value === "string" ? ans.value : undefined;
        if (value === undefined) {
          console.log(chalk.yellow("Aborted."));
          return;
        }
      }

      const spinner = ora(`Storing ${key}...`).start();
      try {
        await client.putSecret(roomId, key, value);
        spinner.succeed(chalk.green(`Set ${key}`));
      } catch (error) {
        spinner.stop();
        reportApiError("Put secret", error);
      }
    });

  cmd
    .command("delete")
    .alias("rm")
    .description("Delete a secret")
    .argument("<key>", "Secret key")
    .option("--room-id <id>", "Room ID (defaults to active jam)")
    .option("--api-url <url>", "API base URL override")
    .action(async (key: string, opts: SharedOpts) => {
      const { client, roomId } = await resolveResourceContext(opts);
      const spinner = ora(`Deleting ${key}...`).start();
      try {
        await client.deleteSecret(roomId, key);
        spinner.succeed(chalk.green(`Deleted ${key}`));
      } catch (error) {
        spinner.stop();
        reportApiError("Delete secret", error);
      }
    });

  cmd
    .command("import")
    .description("Bulk import a .dev.vars-style file (KEY=VALUE per line)")
    .argument("<file>", "Path to .dev.vars-style file")
    .option("--room-id <id>", "Room ID (defaults to active jam)")
    .option("--api-url <url>", "API base URL override")
    .action(async (file: string, opts: SharedOpts) => {
      if (!fs.existsSync(file)) {
        console.error(chalk.red(`File not found: ${file}`));
        process.exit(1);
      }
      const contents = fs.readFileSync(file, "utf-8");
      const entries = parseDotEnv(contents);
      if (entries.length === 0) {
        console.log(chalk.yellow("No KEY=VALUE pairs found in file."));
        return;
      }
      const { client, roomId } = await resolveResourceContext(opts);
      const spinner = ora(`Importing ${entries.length} secret(s)...`).start();
      try {
        const result = await client.bulkPutSecrets(roomId, entries);
        spinner.succeed(chalk.green(`Imported ${result.count} secret(s)`));
      } catch (error) {
        spinner.stop();
        reportApiError("Import secrets", error);
      }
    });

  return cmd;
}
