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

const DEFAULT_BINDING = "DB";
const MAX_CHUNK_BYTES = 500 * 1024; // 500 KB

/**
 * Split a SQL dump on `;\n` into chunks no larger than ~500 KB. Each chunk
 * still contains complete statements (we never split mid-statement).
 */
export function splitSqlChunks(sql: string, maxBytes = MAX_CHUNK_BYTES): string[] {
  const stmts = sql.split(";\n");
  const chunks: string[] = [];
  let current = "";
  for (const stmt of stmts) {
    const piece = stmt.endsWith(";") ? stmt : `${stmt};`;
    if (
      current &&
      Buffer.byteLength(current, "utf8") + Buffer.byteLength(piece, "utf8") + 1 >
        maxBytes
    ) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n${piece}` : piece;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

function printResultTable(rows: unknown[]): void {
  if (rows.length === 0) {
    console.log(chalk.dim("(no rows)"));
    return;
  }
  const objects = rows.map((r) =>
    r && typeof r === "object" ? (r as Record<string, unknown>) : { value: r },
  );
  const columns = Array.from(
    new Set(objects.flatMap((o) => Object.keys(o))),
  );
  const widths: Record<string, number> = {};
  for (const c of columns) {
    widths[c] = c.length;
    for (const o of objects) {
      const v = o[c];
      const s = v === null || v === undefined ? "" : String(v);
      if (s.length > (widths[c] ?? 0)) widths[c] = s.length;
    }
    if ((widths[c] ?? 0) > 40) widths[c] = 40;
  }
  const header = columns.map((c) => c.padEnd(widths[c] ?? c.length)).join(" │ ");
  console.log(chalk.bold(header));
  console.log(chalk.dim("─".repeat(header.length)));
  for (const o of objects) {
    const row = columns
      .map((c) => {
        const v = o[c];
        const s = v === null || v === undefined ? "" : String(v);
        const trimmed =
          s.length > (widths[c] ?? s.length) ? `${s.slice(0, (widths[c] ?? 1) - 1)}…` : s;
        return trimmed.padEnd(widths[c] ?? s.length);
      })
      .join(" │ ");
    console.log(row);
  }
}

export function buildDatabaseCommand(): Command {
  const cmd = new Command("database")
    .alias("db")
    .description("Manage SQL databases bound to a Jam room");

  cmd
    .command("list")
    .description("List configured database bindings")
    .option("--room-id <id>", "Room ID (defaults to active jam)")
    .option("--api-url <url>", "API base URL override")
    .action(async (opts: SharedOpts) => {
      const { client, roomId } = await resolveResourceContext(opts);
      const spinner = ora("Fetching databases...").start();
      try {
        const { databases } = await client.listDatabases(roomId);
        spinner.stop();
        if (databases.length === 0) {
          console.log(chalk.yellow("No databases bound to this room."));
          return;
        }
        for (const db of databases) {
          console.log(
            `  ${chalk.cyan(db.binding)}  ${db.database_name}  ${chalk.dim(db.database_id)}`,
          );
        }
      } catch (error) {
        spinner.stop();
        reportApiError("List databases", error);
      }
    });

  cmd
    .command("create")
    .description("Create a new database binding")
    .requiredOption("--binding <name>", "Binding name")
    .requiredOption("--name <name>", "Database name")
    .option("--room-id <id>", "Room ID (defaults to active jam)")
    .option("--api-url <url>", "API base URL override")
    .action(async (opts: SharedOpts & { binding: string; name: string }) => {
      const { client, roomId } = await resolveResourceContext(opts);
      const spinner = ora(`Creating database ${opts.name}...`).start();
      try {
        const { database_id } = await client.createDatabase(
          roomId,
          opts.binding,
          opts.name,
        );
        spinner.succeed(
          chalk.green(`Created ${opts.binding} → ${opts.name} (${database_id})`),
        );
      } catch (error) {
        spinner.stop();
        reportApiError("Create database", error);
      }
    });

  cmd
    .command("migrate")
    .description("Apply local migrations/*.sql to the remote database")
    .option("--binding <name>", "Database binding", DEFAULT_BINDING)
    .option("--dir <path>", "Migrations directory", "migrations")
    .option("--room-id <id>", "Room ID (defaults to active jam)")
    .option("--api-url <url>", "API base URL override")
    .action(async (opts: SharedOpts & { binding: string; dir: string }) => {
      const dir = path.resolve(process.cwd(), opts.dir);
      if (!fs.existsSync(dir)) {
        console.error(chalk.red(`Migrations directory not found: ${dir}`));
        process.exit(1);
      }
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort();
      if (files.length === 0) {
        console.log(chalk.yellow(`No .sql files found in ${dir}`));
        return;
      }
      const migrations = files.map((f) => ({
        name: f,
        sql: fs.readFileSync(path.join(dir, f), "utf-8"),
      }));

      const { client, roomId } = await resolveResourceContext(opts);
      const spinner = ora(
        `Applying ${migrations.length} migration(s) to ${opts.binding}...`,
      ).start();
      try {
        const result = await client.migrateDatabase(roomId, opts.binding, migrations);
        spinner.stop();
        if (result.applied.length) {
          console.log(chalk.green(`Applied (${result.applied.length}):`));
          for (const n of result.applied) console.log(`  + ${n}`);
        }
        if (result.skipped.length) {
          console.log(chalk.dim(`Skipped (${result.skipped.length}):`));
          for (const n of result.skipped) console.log(chalk.dim(`  · ${n}`));
        }
      } catch (error) {
        spinner.stop();
        reportApiError("Migrate database", error);
      }
    });

  cmd
    .command("query")
    .description("Run a SQL query and print results")
    .argument("<sql>", "SQL statement")
    .option("--binding <name>", "Database binding", DEFAULT_BINDING)
    .option("--room-id <id>", "Room ID (defaults to active jam)")
    .option("--api-url <url>", "API base URL override")
    .action(async (sql: string, opts: SharedOpts & { binding: string }) => {
      const { client, roomId } = await resolveResourceContext(opts);
      const spinner = ora("Running query...").start();
      try {
        const { results, meta } = await client.queryDatabase(roomId, opts.binding, sql);
        spinner.stop();
        printResultTable(results);
        console.log(
          chalk.dim(
            `\n${results.length} row(s) · read=${meta.rowsRead} written=${meta.rowsWritten}`,
          ),
        );
      } catch (error) {
        spinner.stop();
        reportApiError("Query", error);
      }
    });

  cmd
    .command("export")
    .description("Stream a SQL dump to a local file")
    .option("--binding <name>", "Database binding", DEFAULT_BINDING)
    .requiredOption("-o, --output <path>", "Output file path")
    .option("--room-id <id>", "Room ID (defaults to active jam)")
    .option("--api-url <url>", "API base URL override")
    .action(async (opts: SharedOpts & { binding: string; output: string }) => {
      const { client, roomId } = await resolveResourceContext(opts);
      const spinner = ora(`Dumping ${opts.binding}...`).start();
      try {
        const response = await client.dumpDatabase(roomId, opts.binding);
        const text = await response.text();
        fs.writeFileSync(opts.output, text, "utf-8");
        spinner.succeed(
          chalk.green(`Wrote ${Buffer.byteLength(text, "utf8")} bytes → ${opts.output}`),
        );
      } catch (error) {
        spinner.stop();
        reportApiError("Export database", error);
      }
    });

  cmd
    .command("import")
    .description("Restore from a local SQL dump (chunked POSTs)")
    .option("--binding <name>", "Database binding", DEFAULT_BINDING)
    .requiredOption("-i, --input <path>", "Input SQL file path")
    .option("--room-id <id>", "Room ID (defaults to active jam)")
    .option("--api-url <url>", "API base URL override")
    .action(async (opts: SharedOpts & { binding: string; input: string }) => {
      if (!fs.existsSync(opts.input)) {
        console.error(chalk.red(`Input file not found: ${opts.input}`));
        process.exit(1);
      }
      const sql = fs.readFileSync(opts.input, "utf-8");
      const chunks = splitSqlChunks(sql);
      const { client, roomId } = await resolveResourceContext(opts);
      const spinner = ora(
        `Restoring ${chunks.length} chunk(s) to ${opts.binding}...`,
      ).start();
      try {
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          if (chunk === undefined) continue;
          spinner.text = `Restoring chunk ${i + 1}/${chunks.length}...`;
          await client.restoreDatabase(roomId, opts.binding, chunk);
        }
        spinner.succeed(chalk.green(`Restored ${chunks.length} chunk(s)`));
      } catch (error) {
        spinner.stop();
        reportApiError("Import database", error);
      }
    });

  return cmd;
}
