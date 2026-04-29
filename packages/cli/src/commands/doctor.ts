import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { parse as parseJsonc } from "jsonc-parser";

interface Finding {
  severity: "blocker" | "warn";
  file: string;
  line: number;
  snippet: string;
  message: string;
  suggestion: string;
}

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".open-next",
  "dist",
  "build",
  ".wrangler",
  ".turbo",
  ".cache",
  "out",
  ".vercel",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (IGNORE_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...walk(full));
    } else if (e.isFile()) {
      const ext = path.extname(e.name);
      if (SCAN_EXTENSIONS.has(ext)) out.push(full);
    }
  }
  return out;
}

function scanFileForCodePatterns(file: string, root: string): Finding[] {
  let contents: string;
  try {
    contents = fs.readFileSync(file, "utf-8");
  } catch {
    return [];
  }
  const findings: Finding[] = [];
  const lines = contents.split(/\r?\n/);
  const rel = path.relative(root, file);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // Pattern A: `import type { ... } from '@cloudflare/workers-types'`
    if (/import\s+type\s*\{[^}]*\}\s*from\s*['"]@cloudflare\/workers-types['"]/.test(line)) {
      findings.push({
        severity: "warn",
        file: rel,
        line: i + 1,
        snippet: line.trim(),
        message:
          "Importing types from @cloudflare/workers-types may not resolve in the playground.",
        suggestion:
          "Use a triple-slash directive instead: /// <reference types=\"@cloudflare/workers-types\" />",
      });
    }

    // Pattern B: destructuring `ctx` from getCloudflareContext({ async: true })
    // Match across this line + the next two for multi-line forms.
    const window = [line, lines[i + 1] ?? "", lines[i + 2] ?? ""].join("\n");
    if (
      /\{\s*[^}]*\bctx\b[^}]*\}\s*=\s*await\s+getCloudflareContext\(\s*\{[^}]*\basync\s*:\s*true/.test(
        window,
      )
    ) {
      findings.push({
        severity: "blocker",
        file: rel,
        line: i + 1,
        snippet: line.trim(),
        message:
          "`ctx` is not available from `getCloudflareContext({ async: true })` in playground.",
        suggestion:
          "Drop the `ctx` destructure (only env/cf are available) or guard usage behind a runtime check until the platform polyfill ships.",
      });
    }
  }

  return findings;
}

function scanWranglerConfig(root: string): Finding[] {
  const candidates = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"];
  const findings: Finding[] = [];
  for (const name of candidates) {
    const full = path.join(root, name);
    if (!fs.existsSync(full)) continue;
    if (!name.endsWith(".jsonc") && !name.endsWith(".json")) continue;

    let raw: string;
    try {
      raw = fs.readFileSync(full, "utf-8");
    } catch {
      continue;
    }
    const config = parseJsonc(raw) as Record<string, unknown> | null;
    if (!config) continue;

    const previewOnly = ["queues", "workflows", "durable_objects", "vectorize"];
    for (const key of previewOnly) {
      if (config[key]) {
        // Find the line containing this key for nicer reporting.
        const lineIdx = raw
          .split(/\r?\n/)
          .findIndex((l) => l.includes(`"${key}"`));
        findings.push({
          severity: "warn",
          file: name,
          line: lineIdx >= 0 ? lineIdx + 1 : 1,
          snippet: `"${key}": …`,
          message: `Wrangler key "${key}" is not yet fully supported in the playground.`,
          suggestion: `Note: ${key} works only on real wrangler deploys today; preview is best-effort.`,
        });
      }
    }
  }
  return findings;
}

function scanForMissingEnvDts(root: string): Finding[] {
  const findings: Finding[] = [];
  const cfDts = path.join(root, "cloudflare-env.d.ts");
  const wcDts = path.join(root, "worker-configuration.d.ts");
  if (!fs.existsSync(cfDts) && !fs.existsSync(wcDts)) {
    findings.push({
      severity: "warn",
      file: "(project root)",
      line: 0,
      snippet: "",
      message:
        "No cloudflare-env.d.ts or worker-configuration.d.ts found at the project root.",
      suggestion:
        "Run `wrangler types` (or generate manually) so the playground can typecheck Env bindings.",
    });
  }
  return findings;
}

export function buildDoctorCommand(): Command {
  return new Command("doctor")
    .description("Check the local project for cloud-incompatible patterns")
    .option("--cwd <path>", "Project root", process.cwd())
    .action(async (opts: { cwd?: string }) => {
      const root = path.resolve(opts.cwd ?? process.cwd());
      const findings: Finding[] = [];

      const sourceFiles = walk(root);
      for (const file of sourceFiles) {
        findings.push(...scanFileForCodePatterns(file, root));
      }
      findings.push(...scanWranglerConfig(root));
      findings.push(...scanForMissingEnvDts(root));

      if (findings.length === 0) {
        console.log(chalk.green("✓ No issues found."));
        return;
      }

      const blockers = findings.filter((f) => f.severity === "blocker");
      const warnings = findings.filter((f) => f.severity === "warn");

      const printGroup = (
        title: string,
        list: Finding[],
        color: (s: string) => string,
      ): void => {
        if (list.length === 0) return;
        console.log(color(`\n${title} (${list.length}):`));
        for (const f of list) {
          const loc = f.line > 0 ? `${f.file}:${f.line}` : f.file;
          console.log(`  ${chalk.dim(loc)}`);
          console.log(`    ${f.message}`);
          if (f.snippet) console.log(`    ${chalk.dim(f.snippet)}`);
          console.log(`    ${chalk.cyan("→")} ${f.suggestion}`);
        }
      };

      printGroup("Blockers", blockers, chalk.red.bold);
      printGroup("Warnings", warnings, chalk.yellow.bold);

      console.log(
        chalk.dim(
          `\n${blockers.length} blocker(s), ${warnings.length} warning(s)`,
        ),
      );
      process.exit(blockers.length > 0 ? 1 : 0);
    });
}
