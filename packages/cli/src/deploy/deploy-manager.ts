import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { Logger } from "../utils/logger.js";

const logger = new Logger();

export interface DeployableAgent {
  name: string;
  path: string;
  wranglerConfig: string;
  secrets?: string[] | undefined;
  description?: string | undefined;
  requiredMcpServices?: string[] | undefined; // MCP services this agent depends on
  requiredQueues?: string[] | undefined; // Queues this agent requires
}

export interface DeployableMCPServer {
  name: string;
  path: string;
  wranglerConfig: string;
  description?: string | undefined;
  workerName?: string | undefined; // The actual worker name from wrangler.jsonc
  /** If true, this MCP server is not yet available for selection in the wizard */
  disabled?: boolean | undefined;
  /** Reason why this MCP server is disabled (shown in wizard UI) */
  disabledReason?: string | undefined;
  /** Tier level: 1 = no extra bindings, 2 = one extra binding, 3 = platform services */
  tier?: number | undefined;
}

export interface DeployResult {
  name: string;
  success: boolean;
  url?: string | undefined;
  error?: string | undefined;
  workerName?: string | undefined; // For MCP servers - the deployed worker name
}

export interface DeployConfig {
  agents: DeployableAgent[];
  playground?: {
    path: string;
    wranglerConfig: string;
  };
  telegram?: {
    path: string;
    wranglerConfig: string;
    secrets: string[];
  };
}

/**
 * Find deployable MCP servers in the examples directory
 */
export async function discoverMCPServers(
  rootDir: string,
): Promise<DeployableMCPServer[]> {
  const servers: DeployableMCPServer[] = [];
  const examplesDir = join(rootDir, "examples");

  // Known MCP servers with tier and disabled info
  const knownServers: Array<{
    name: string;
    description: string;
    disabled?: boolean;
    disabledReason?: string;
    tier?: number;
  }> = [
    // Tier 1: No extra bindings (Durable Objects only)
    {
      name: "crud-mcp",
      description: "CRUD operations (todo management)",
      tier: 1,
    },
    {
      name: "expense-mcp",
      description: "Expense tracking & summaries",
      tier: 1,
    },
    {
      name: "env-variable-mcp",
      description: "Environment variable demo (greeting)",
      tier: 1,
    },
    { name: "secret-mcp", description: "Secret guessing game demo", tier: 1 },
    // Tier 2: One extra binding
    {
      name: "kv-mcp",
      description: "Key-Value storage (requires KV namespace)",
      tier: 2,
      disabled: true,
      disabledReason: "Requires KV namespace binding",
    },
    // Tier 3: Platform services
    {
      name: "analytics-mcp",
      description: "Analytics Engine + D1",
      tier: 3,
      disabled: true,
      disabledReason: "Requires Analytics Engine + D1",
    },
    {
      name: "vectorize-mcp",
      description: "Vector search & RAG (Vectorize + Workers AI)",
      tier: 3,
      disabled: true,
      disabledReason: "Requires Vectorize + Workers AI",
    },
    {
      name: "email-mcp",
      description: "Email Workers integration",
      tier: 3,
      disabled: true,
      disabledReason: "Requires Email Workers + D1",
    },
    {
      name: "browser-mcp",
      description: "Browser Rendering API + R2",
      tier: 3,
      disabled: true,
      disabledReason: "Requires Browser Rendering + R2",
    },
    {
      name: "image-mcp",
      description: "Image metadata (R2 bucket)",
      tier: 3,
      disabled: true,
      disabledReason: "Requires R2 bucket",
    },
  ];

  for (const server of knownServers) {
    const serverPath = join(examplesDir, server.name);
    const wranglerConfig = join(serverPath, "wrangler.jsonc");

    if (existsSync(serverPath) && existsSync(wranglerConfig)) {
      // Read wrangler.jsonc to get the actual worker name
      let workerName = server.name;
      try {
        const configContent = await readFile(wranglerConfig, "utf-8");
        const cleanJson = configContent
          .replace(/\/\/.*$/gm, "")
          .replace(/\/\*[\s\S]*?\*\//g, "");
        const config = JSON.parse(cleanJson) as { name?: string };
        if (config.name) {
          workerName = config.name;
        }
      } catch {
        // Use default name
      }

      servers.push({
        name: server.name,
        path: serverPath,
        wranglerConfig,
        description: server.description,
        workerName,
        disabled: server.disabled,
        disabledReason: server.disabledReason,
        tier: server.tier,
      });
    }
  }

  return servers;
}

/**
 * Find deployable agents in the examples directory
 */
export async function discoverAgents(
  rootDir: string,
): Promise<DeployableAgent[]> {
  const agents: DeployableAgent[] = [];
  const examplesDir = join(rootDir, "examples");

  // Known AI agents (not MCP servers)
  const knownAgents = [
    {
      name: "simple-prompt-agent",
      description: "Simple AI agent with prompt-based interactions",
      secrets: [
        "AI_PROVIDER",
        "ANTHROPIC_API_KEY",
        "OPEN_AI_API_KEY",
        "DEEPSEEK_API_KEY",
        "GOOGLE_API_KEY",
        "GROK_API_KEY",
      ],
    },
    {
      name: "queues-agent",
      description: "AI agent with Cloudflare Queues for async processing",
      secrets: ["AI_PROVIDER", "ANTHROPIC_API_KEY", "OPEN_AI_API_KEY"],
      requiredQueues: ["request-queue"],
    },
    {
      name: "dependent-agent",
      description: "AI agent with dependent MCP services",
      secrets: ["AI_PROVIDER", "AI_PROVIDER_API_KEY", "MODEL_ID"],
      requiredMcpServices: ["MCP_SERVICE"], // Will be wired to selected MCP server
    },
  ];

  for (const agent of knownAgents) {
    const agentPath = join(examplesDir, agent.name);
    const wranglerConfig = join(agentPath, "wrangler.jsonc");

    if (existsSync(agentPath) && existsSync(wranglerConfig)) {
      agents.push({
        name: agent.name,
        path: agentPath,
        wranglerConfig,
        secrets: agent.secrets,
        description: agent.description,
        requiredMcpServices: (agent as { requiredMcpServices?: string[] })
          .requiredMcpServices,
        requiredQueues: (agent as { requiredQueues?: string[] }).requiredQueues,
      });
    }
  }

  return agents;
}

/**
 * Deploy a single agent using wrangler
 */
export async function deployAgent(
  agent: DeployableAgent,
): Promise<DeployResult> {
  return new Promise((resolve) => {
    logger.info(chalk.blue(`  Deploying ${agent.name}...`));

    const wrangler = spawn("npx", ["wrangler", "deploy"], {
      cwd: agent.path,
      shell: false,
      stdio: ["inherit", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    wrangler.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    wrangler.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    wrangler.on("close", (code) => {
      if (code === 0) {
        // Try to extract URL from output
        const urlMatch = stdout.match(/https:\/\/[^\s]+\.workers\.dev/);
        const url = urlMatch ? urlMatch[0] : undefined;

        const result: DeployResult = {
          name: agent.name,
          success: true,
        };
        if (url) {
          result.url = url;
        }
        resolve(result);
      } else {
        resolve({
          name: agent.name,
          success: false,
          error: stderr || stdout || `Exit code: ${code}`,
        });
      }
    });

    wrangler.on("error", (error) => {
      resolve({
        name: agent.name,
        success: false,
        error: error.message,
      });
    });
  });
}

/**
 * Set a secret for a worker
 */
export async function setSecret(
  workerPath: string,
  secretName: string,
  secretValue: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const wrangler = spawn("npx", ["wrangler", "secret", "put", secretName], {
      cwd: workerPath,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Write secret value to stdin
    wrangler.stdin?.write(secretValue);
    wrangler.stdin?.end();

    wrangler.on("close", (code) => {
      resolve(code === 0);
    });

    wrangler.on("error", () => {
      resolve(false);
    });
  });
}

/**
 * Set Telegram webhook
 */
export async function setTelegramWebhook(
  botToken: string,
  webhookUrl: string,
  secretToken?: string,
): Promise<boolean> {
  try {
    // Ensure webhook URL ends with /telegram/webhook path
    const fullWebhookUrl = webhookUrl.endsWith("/telegram/webhook")
      ? webhookUrl
      : `${webhookUrl}/telegram/webhook`;

    const params = new URLSearchParams({
      url: fullWebhookUrl,
      allowed_updates: JSON.stringify([
        "message",
        "edited_message",
        "channel_post",
        "callback_query",
        "my_chat_member",
        "chat_member",
      ]),
    });
    if (secretToken) {
      params.set("secret_token", secretToken);
    }

    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/setWebhook?${params}`,
    );
    const data = (await response.json()) as { ok: boolean };
    return data.ok;
  } catch {
    return false;
  }
}

/**
 * Generate AGENTS env string from deployed agents
 */
export function generateAgentsEnvString(results: DeployResult[]): string {
  const successfulAgents = results.filter((r) => r.success && r.url);
  return successfulAgents
    .map((r) => {
      const name = r.name
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      return `${name}|${r.url}`;
    })
    .join(",");
}

/**
 * Update wrangler.jsonc with AGENTS env variable
 */
export async function updateWranglerWithAgents(
  wranglerPath: string,
  agentsString: string,
): Promise<boolean> {
  try {
    const content = await readFile(wranglerPath, "utf-8");

    // Simple replacement - find AGENTS var and update it
    if (content.includes('"AGENTS"')) {
      const updated = content.replace(
        /"AGENTS":\s*"[^"]*"/,
        `"AGENTS": "${agentsString}"`,
      );
      await writeFile(wranglerPath, updated);
    } else {
      // Add AGENTS to vars section
      const updated = content.replace(
        /"vars":\s*\{/,
        `"vars": {\n\t\t"AGENTS": "${agentsString}",`,
      );
      await writeFile(wranglerPath, updated);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Get available AI providers
 */
export function getAvailableProviders(): Array<{
  name: string;
  value: string;
  envKey: string;
}> {
  return [
    {
      name: "Cloudflare Workers AI (Llama, free tier)",
      value: "workers-ai",
      envKey: "",
    },
    {
      name: "Anthropic (Claude)",
      value: "anthropic",
      envKey: "ANTHROPIC_API_KEY",
    },
    {
      name: "OpenAI (GPT-4, GPT-3.5)",
      value: "openai",
      envKey: "OPEN_AI_API_KEY",
    },
    { name: "Google (Gemini)", value: "google", envKey: "GOOGLE_API_KEY" },
    { name: "DeepSeek", value: "deepseek", envKey: "DEEPSEEK_API_KEY" },
    { name: "xAI (Grok)", value: "grok", envKey: "GROK_API_KEY" },
  ];
}

/**
 * Create a Cloudflare Queue
 */
export async function createQueue(
  queueName: string,
  cwd?: string,
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    logger.info(chalk.blue(`  Creating queue: ${queueName}...`));

    // Run npx wrangler from a directory where wrangler is installed
    const child = spawn("npx", ["wrangler", "queues", "create", queueName], {
      stdio: ["inherit", "pipe", "pipe"],
      shell: false,
      cwd: cwd || process.cwd(),
      env: { ...process.env },
    });

    let stderr = "";
    let stdout = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        // Queue might already exist - that's okay
        if (
          stderr.includes("already exists") ||
          stdout.includes("already exists")
        ) {
          resolve({ success: true });
        } else {
          resolve({
            success: false,
            error: stderr || stdout || `Exit code: ${code}`,
          });
        }
      }
    });

    child.on("error", (error) => {
      resolve({ success: false, error: error.message });
    });
  });
}

/**
 * Create a Cloudflare Vectorize index
 */
export async function createVectorizeIndex(
  indexName: string,
  dimensions: number,
  metric: string,
  cwd?: string,
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    logger.info(chalk.blue(`  Creating Vectorize index: ${indexName}...`));

    const child = spawn(
      "npx",
      [
        "wrangler",
        "vectorize",
        "create",
        indexName,
        "--dimensions",
        String(dimensions),
        "--metric",
        metric,
      ],
      {
        stdio: ["inherit", "pipe", "pipe"],
        shell: false,
        cwd: cwd || process.cwd(),
        env: { ...process.env },
      },
    );

    let stderr = "";
    let stdout = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        // Index might already exist - that's okay
        if (
          stderr.includes("already exists") ||
          stdout.includes("already exists") ||
          stderr.includes("duplicate_name") ||
          stdout.includes("duplicate_name")
        ) {
          logger.info(
            chalk.gray(`  Vectorize index "${indexName}" already exists`),
          );
          resolve({ success: true });
        } else {
          resolve({
            success: false,
            error: stderr || stdout || `Exit code: ${code}`,
          });
        }
      }
    });

    child.on("error", (error) => {
      resolve({ success: false, error: error.message });
    });
  });
}

/**
 * Update agent's wrangler.jsonc with MCP service bindings
 */
export async function updateAgentWithMCPServices(
  agentWranglerPath: string,
  mcpServices: Array<{ binding: string; workerName: string }>,
): Promise<boolean> {
  try {
    const content = await readFile(agentWranglerPath, "utf-8");

    // Parse the JSON (handling comments)
    const cleanJson = content
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const config = JSON.parse(cleanJson) as {
      services?: Array<{ binding: string; service: string }>;
    };

    // Update or add services
    if (!config.services) {
      config.services = [];
    }

    for (const mcp of mcpServices) {
      const existingIndex = config.services.findIndex(
        (s) => s.binding === mcp.binding,
      );
      const existingService =
        existingIndex >= 0 ? config.services[existingIndex] : undefined;
      if (existingService) {
        existingService.service = mcp.workerName;
      } else {
        config.services.push({
          binding: mcp.binding,
          service: mcp.workerName,
        });
      }
    }

    // Write back - try to preserve formatting
    let updatedContent = content;

    // Update services section
    const servicesJson = JSON.stringify(config.services, null, 2).replace(
      /^/gm,
      "\t",
    );

    if (content.includes('"services"')) {
      // Replace existing services
      updatedContent = content.replace(
        /"services"\s*:\s*\[[\s\S]*?\]/,
        `"services": ${servicesJson.trim()}`,
      );
    } else {
      // Add services before the closing brace
      updatedContent = content.replace(
        /\n\}$/,
        `,\n\t"services": ${servicesJson.trim()}\n}`,
      );
    }

    await writeFile(agentWranglerPath, updatedContent);
    return true;
  } catch (error) {
    logger.error(`Failed to update ${agentWranglerPath}: ${error}`);
    return false;
  }
}
