import * as fs from "node:fs";
import * as path from "node:path";
import type { NullshotApiClient } from "../api/nullshot-api-client.js";

/**
 * Detect the likely project type by inspecting files already present in
 * `localDir`. Returns a projectType hint string accepted by `/api/jam/skills`.
 */
export function detectProjectType(localDir: string): string {
  const has = (relative: string) =>
    fs.existsSync(path.join(localDir, relative));

  // Check for key indicator files
  if (has("wrangler.jsonc") || has("wrangler.toml")) {
    // Cloudflare Workers project
    const pkgPath = path.join(localDir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
        const deps: Record<string, unknown> = {
          ...((pkg.dependencies as Record<string, unknown>) ?? {}),
          ...((pkg.devDependencies as Record<string, unknown>) ?? {}),
        };
        if (deps["@cloudflare/agents"] || deps["agents"]) return "agent";
        if (deps["@modelcontextprotocol/sdk"] || deps["@cloudflare/mcp"]) return "mcp";
        if (deps["react"] || deps["next"]) return "react";
      } catch {
        // ignore parse errors
      }
    }
    return "cloudflare";
  }

  if (has("next.config.js") || has("next.config.ts") || has("next.config.mjs")) {
    return "nextjs";
  }

  if (has("vite.config.ts") || has("vite.config.js")) {
    return "react";
  }

  return ""; // default: all skills
}

/**
 * Download skill files from the platform and write them into
 * `<localDir>/.claude/skills/<skill-name>/SKILL.md`.
 *
 * Skills are placed in `.claude/` which is in the ignore list, so they are
 * never uploaded back to the CodeBox. They exist only for the local developer's
 * AI assistant (Claude Code, Cursor, etc.).
 *
 * Returns the list of skill names that were written.
 */
export async function injectSkills(
  localDir: string,
  apiClient: NullshotApiClient,
  roomId: string,
  jamId: string,
): Promise<string[]> {
  const projectType = detectProjectType(localDir);

  let skillsResponse: Awaited<ReturnType<NullshotApiClient["getSkills"]>>;
  try {
    skillsResponse = await apiClient.getSkills({ roomId, jamId, projectType });
  } catch {
    // Skills injection is best-effort — don't block the session
    return [];
  }

  const injected: string[] = [];
  const skillsDir = path.join(localDir, ".claude", "skills");

  for (const skill of skillsResponse.skills) {
    try {
      // Download the SKILL.md content
      const response = await fetch(skill.path);
      if (!response.ok) continue;

      const content = await response.text();
      if (!content.trim()) continue;

      const destDir = path.join(skillsDir, skill.name);
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, "SKILL.md"), content, "utf-8");
      injected.push(skill.name);
    } catch {
      // Best-effort: skip failed skills
    }
  }

  // Write a README so developers know where these came from
  if (injected.length > 0) {
    const readmePath = path.join(skillsDir, "README.md");
    if (!fs.existsSync(readmePath)) {
      fs.writeFileSync(
        readmePath,
        [
          "# Agent Skills",
          "",
          "These skill files are injected by the Nullshot CLI during `nullshot jam`.",
          "They document the patterns and best practices that the AI agents in this",
          "Jam room use. Your local AI assistant (Claude Code, Cursor, etc.) can use",
          "them to provide the same context as the remote agents.",
          "",
          "**Do not edit these files** — they are refreshed on every `nullshot jam` session.",
          "",
          "Skills included:",
          ...injected.map((s) => `- \`${s}\``),
        ].join("\n"),
        "utf-8",
      );
    }
  }

  return injected;
}
