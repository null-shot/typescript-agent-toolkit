import { describe, it, expect, beforeEach, vi } from "vitest";
import { vol } from "memfs";
import { exec } from "child_process";
import { TemplateManager } from "./template/template-manager.js";
import { program } from "./cli.js";

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
});
