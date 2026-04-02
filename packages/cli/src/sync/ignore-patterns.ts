import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Default patterns that are ALWAYS ignored during CLI sync.
 * Follows .gitignore glob syntax — a segment matches any path component.
 */
export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  // ── Package managers ──────────────────────────────────────────────────────
  "node_modules",
  ".pnp",
  ".pnp.js",
  ".yarn",

  // ── Lock files (large, generated) ─────────────────────────────────────────
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  "bun.lockb",
  "bun.lock",

  // ── Build outputs ─────────────────────────────────────────────────────────
  "dist",
  "build",
  "out",
  ".output",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".open-next",
  ".wrangler",
  ".vercel",
  ".netlify",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".vite",
  "coverage",
  "storybook-static",
  "tmp",
  "temp",

  // ── Version control ───────────────────────────────────────────────────────
  ".git",
  ".hg",
  ".svn",
  ".bzr",

  // ── Environment / secrets ─────────────────────────────────────────────────
  ".env",
  ".env.local",
  ".env.*.local",
  ".dev.vars",
  "*.pem",
  "*.key",
  "*.cert",
  "secrets.json",

  // ── OS / editor metadata ──────────────────────────────────────────────────
  ".DS_Store",
  "Thumbs.db",
  "Desktop.ini",
  ".idea",
  ".vscode/settings.json",
  ".vscode/launch.json",

  // ── Logs ──────────────────────────────────────────────────────────────────
  "*.log",
  "logs",
  "npm-debug.log*",
  "yarn-debug.log*",
  "yarn-error.log*",

  // ── Binary / media assets (large, not editable as text) ───────────────────
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.webp",
  "*.ico",
  "*.woff",
  "*.woff2",
  "*.ttf",
  "*.eot",
  "*.otf",
  "*.pdf",
  "*.zip",
  "*.tar",
  "*.tar.gz",
  "*.tgz",
  "*.gz",
  "*.rar",
  "*.7z",
  "*.dmg",
  "*.pkg",
  "*.exe",
  "*.dll",
  "*.so",
  "*.dylib",
  "*.wasm",

  // ── Cloudflare / Worker generated directories ─────────────────────────────
  // Keep generated type files syncable because preview/typecheck depends on
  // them being present in both the local workspace and remote CodeBox.
  ".cloudflare",

  // ── CLI-injected context (never upload back to remote) ────────────────────
  ".claude",
  ".cursor",
];

/**
 * The filename that can be placed in the project root to customise ignore
 * patterns. Follows the same format as .gitignore.
 */
export const NULLSHOT_IGNORE_FILE = ".nullshotignore";

/**
 * Default content written to .nullshotignore at the root of a jam session.
 * This file is informational — the CLI always enforces DEFAULT_IGNORE_PATTERNS
 * on top of whatever is listed here.
 */
export const DEFAULT_NULLSHOT_IGNORE_CONTENT = `# .nullshotignore
# Files and directories excluded from Nullshot CLI sync.
# Follows .gitignore glob syntax.
#
# The CLI always ignores node_modules, build outputs, binaries, lock files,
# secrets, and .claude/.cursor folders regardless of this file.

# Add project-specific paths to exclude:
# /private-data
# /internal-docs
`;

/**
 * Read extra patterns from .nullshotignore or fall back to .gitignore in
 * the given directory. Lines starting with '#' and empty lines are skipped.
 */
export function loadProjectIgnorePatterns(localDir: string): string[] {
  const candidates = [
    path.join(localDir, NULLSHOT_IGNORE_FILE),
    path.join(localDir, ".gitignore"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        return fs
          .readFileSync(candidate, "utf-8")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"));
      } catch {
        // ignore read errors
      }
    }
  }

  return [];
}

/**
 * Build the combined chokidar-compatible ignore list for FileWatcher.
 * Converts simple name patterns into recursive glob patterns.
 */
export function buildChokidarIgnorePatterns(extraPatterns: string[] = []): string[] {
  const patterns = [...DEFAULT_IGNORE_PATTERNS, ...extraPatterns];

  return patterns.flatMap((p) => {
    // Already glob-like — keep as-is
    if (p.includes("/") || p.includes("*")) {
      return [`**/${p}`, `**/${p}/**`];
    }
    // Simple name: ignore both the path itself and anything inside it
    return [`**/${p}`, `**/${p}/**`];
  });
}

/**
 * Returns true when a relative file path should be ignored.
 * `filePath` should use forward slashes and optionally start with '/'.
 */
export function shouldIgnorePath(
  filePath: string,
  extraPatterns: string[] = [],
): boolean {
  const allPatterns = [...DEFAULT_IGNORE_PATTERNS, ...extraPatterns];

  // Normalise: strip leading slash, split into segments
  const normalised = filePath.replace(/^\/+/, "");
  const segments = normalised.split("/");

  for (const pattern of allPatterns) {
    // Strip leading slash from pattern (absolute patterns treated as relative)
    const p = pattern.replace(/^\/+/, "");

    if (p.includes("*")) {
      // Glob: check against full path and each segment
      if (matchGlob(p, normalised)) return true;
      for (const seg of segments) {
        if (matchGlob(p, seg)) return true;
      }
    } else if (p.includes("/")) {
      // Path-relative pattern
      if (normalised === p || normalised.startsWith(p + "/")) return true;
    } else {
      // Simple name: ignore any path segment that equals this name
      if (segments.includes(p)) return true;
    }
  }

  return false;
}

/**
 * Minimal glob matcher supporting `*` and `**`.
 */
function matchGlob(pattern: string, str: string): boolean {
  // Convert glob to regex
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex special chars
    .replace(/\*\*/g, "§DOUBLESTAR§")
    .replace(/\*/g, "[^/]*")
    .replace(/§DOUBLESTAR§/g, ".*");

  try {
    return new RegExp(`^${escaped}$`).test(str);
  } catch {
    return false;
  }
}
