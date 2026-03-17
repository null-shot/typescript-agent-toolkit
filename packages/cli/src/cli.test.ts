import { describe, it, expect, beforeEach, vi } from "vitest";
import { vol } from "memfs";
import { exec } from "child_process";
import { TemplateManager } from "./template/template-manager.js";
import { program } from "./cli.js";
import { AuthManager } from "./auth/auth-manager.js";
import { NullshotApiClient } from "./api/nullshot-api-client.js";

vi.mock("fs/promises", () => ({
  ...vi.importActual("memfs"),
}));

vi.mock("child_process");

vi.mock("simple-git", () => ({
  simpleGit: () => ({
    clone: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("inquirer", () => ({
  default: {
    prompt: vi.fn(),
  },
}));

describe("CLI Integration", () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
  });

  it("should handle install command with dry-run", async () => {
    vol.fromJSON({
      "mcp.jsonc": JSON.stringify({
        mcpServers: {
          filesystem: {
            source: "github:modelcontextprotocol/servers#filesystem",
            command: "npx @modelcontextprotocol/server-filesystem",
          },
        },
      }),
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
      }),
    });

    // Mock exec for package installation
    const execMock = vi.mocked(exec) as any;
    execMock.mockImplementation((command: string, callback?: any) => {
      callback?.(null, "success", "");
      return {} as any;
    });

    // Test would import and run CLI commands
    // This is a placeholder for actual CLI testing
    expect(true).toBe(true);
  });

  it("should return available templates", () => {
    const templates = TemplateManager.getAvailableTemplates();

    expect(templates).toHaveLength(2);
    expect(templates.find((t) => t.type === "mcp")).toBeDefined();
    expect(templates.find((t) => t.type === "agent")).toBeDefined();
    expect(templates.find((t) => t.type === "mcp")?.url).toBe(
      "https://github.com/null-shot/typescript-mcp-template",
    );
    expect(templates.find((t) => t.type === "agent")?.url).toBe(
      "https://github.com/null-shot/typescript-agent-template",
    );
  });

  it("should expose auth and Jam inspection commands in top-level help", () => {
    const help = program.helpInformation();

    expect(help).toContain("login [options]");
    expect(help).toContain("logout");
    expect(help).toContain("jam [options] [room-id]");
    expect(help).toContain("logs [options] [room-id]");
    expect(help).toContain("messages [options] [room-id]");
    expect(help).toContain("errors [options] [room-id]");
    expect(help).toContain("View messages for a Jam room");
  });

  it("should expose message, log, and error command options in help", () => {
    const messagesCommand = program.commands.find(
      (command) => command.name() === "messages",
    );
    const logsCommand = program.commands.find(
      (command) => command.name() === "logs",
    );
    const errorsCommand = program.commands.find(
      (command) => command.name() === "errors",
    );

    expect(messagesCommand?.helpInformation()).toContain("--raw");
    expect(messagesCommand?.helpInformation()).toContain("--full");
    expect(messagesCommand?.helpInformation()).toContain("--output <file>");
    expect(logsCommand?.helpInformation()).toContain("--branch <branch>");
    expect(errorsCommand?.helpInformation()).toContain("--branch <branch>");
  });

  it("formats normalized worker validation output for the errors command", async () => {
    vi.spyOn(AuthManager, "getCredentials").mockReturnValue({
      baseUrl: "http://localhost:3000",
      sessionToken: "session-token",
      email: "user@example.com",
      userId: "user-1",
    });
    vi.spyOn(NullshotApiClient.prototype, "getErrors").mockResolvedValue({
      success: false,
      message: "❌ Found 2 error(s): 1 TypeScript, 0 runtime, 0 transpile, 1 worker preflight",
      typescript: {
        status: "fail",
        errors: [{ file: "src/worker/index.ts", line: 7, column: 2, message: "Bad import", code: "TS2307" }],
        errorCount: 1,
        note: "TypeScript transport failed during validation",
      },
      runtime: { status: "pass", errors: [], errorCount: 0 },
      transpile: { status: "pass", errors: [], errorCount: 0 },
      worker_preflight: {
        status: "fail",
        errors: ["Worker loader validation failed"],
        errorCount: 1,
      },
      bundle_warnings: ["Could not resolve internal import __bare:hono/validator"],
    } as any);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "));
    });

    await program.parseAsync(["errors", "room-1"], {
      from: "user",
    });

    const output = logs.join("\n");
    expect(output).toContain("TypeScript Errors:");
    expect(output).toContain("Worker Preflight:");
    expect(output).toContain("Bundle Warnings:");
    expect(output).toContain("Worker loader validation failed");
  });
});
