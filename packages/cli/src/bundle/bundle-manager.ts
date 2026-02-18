/**
 * Bundle Manager
 * Generates a single-worker from selected components
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { Logger } from "../utils/logger.js";

const logger = new Logger();

export interface ComponentConfig {
  name: string;
  type: "agent" | "mcp" | "ui";
  description: string;
  exports: {
    className: string;
    binding: string;
  };
  dependencies: string[];
  env?: {
    required?: string[];
    secrets?: string[];
  };
  routes?: {
    pattern: string;
    method: string;
  };
  requiresMcp?: boolean;
  tools?: string[];
  /** If true, this component is not yet available for selection */
  disabled?: boolean;
  /** Reason why this component is disabled (shown in wizard UI) */
  disabledReason?: string;
}

export interface BundleConfig {
  name: string;
  outputDir: string;
  agents: ComponentConfig[];
  mcps: ComponentConfig[];
  includePlayground: boolean;
  aiProvider: string;
  primaryColor?: string;
  secondaryColor?: string;
  /** Include Telegram Bot integration */
  includeTelegram?: boolean;
  /** KV namespace ID for Telegram sessions */
  telegramKvId?: string;
  /** External binding IDs for MCPs that require them (kv-mcp, image-mcp, email-mcp) */
  mcpBindings?: Record<string, string>;
  /** If true, clears existing migration history before generating (fresh start) */
  resetHistory?: boolean;
}

/**
 * Discover available components from examples directory
 */
export async function discoverComponents(
  rootDir: string,
): Promise<{ agents: ComponentConfig[]; mcps: ComponentConfig[] }> {
  const examplesDir = join(rootDir, "examples");
  const agents: ComponentConfig[] = [];
  const mcps: ComponentConfig[] = [];

  const dirs = [
    "simple-prompt-agent",
    "dependent-agent",
    "crud-mcp",
    "expense-mcp",
    "email-mcp",
    "kv-mcp",
    "image-mcp",
  ];

  for (const dir of dirs) {
    const componentPath = join(examplesDir, dir, "component.json");
    if (existsSync(componentPath)) {
      try {
        const content = readFileSync(componentPath, "utf-8");
        const config = JSON.parse(content) as ComponentConfig;
        if (config.type === "agent") {
          agents.push(config);
        } else if (config.type === "mcp") {
          mcps.push(config);
        }
      } catch (error) {
        logger.warn(`Failed to parse ${componentPath}: ${error}`);
      }
    }
  }

  return { agents, mcps };
}

/**
 * Generate the bundled index.ts file
 */
export function generateBundledIndexTs(config: BundleConfig): string {
  const imports: string[] = [];
  const doExports: string[] = [];
  const routes: string[] = [];
  const playgroundAgents: string[] = [];
  const doBindings: string[] = [];
  const envTypes: string[] = [];
  const hasTelegram = !!config.includeTelegram;

  // Core imports
  imports.push(`import { Hono } from 'hono'`);
  imports.push(`import { cors } from 'hono/cors'`);

  // Agent imports if we have agents
  if (config.agents.length > 0) {
    imports.push(`import { createOpenAI } from '@ai-sdk/openai'`);
    imports.push(`import { createAnthropic } from '@ai-sdk/anthropic'`);
    imports.push(`import { createDeepSeek } from '@ai-sdk/deepseek'`);
    imports.push(`import { createXai } from '@ai-sdk/xai'`);
    imports.push(`import { createWorkersAI } from 'workers-ai-provider'`);
    imports.push(`import { LanguageModel, type Provider } from 'ai'`);

    if (hasTelegram) {
      // With Telegram: use generatePlaygroundHTML + PlaygroundTab for dynamic tabs
      imports.push(`import {
	AiSdkAgent,
	type AIUISDKMessage,
	ToolboxService,
	Service,
	generatePlaygroundHTML,
	routeToAgent,
	routeToMcp,
	type PlaygroundAgent,
	type PlaygroundTab,
} from '@nullshot/agent'`);
    } else {
      imports.push(`import {
	AiSdkAgent,
	type AIUISDKMessage,
	ToolboxService,
	Service,
	setupPlaygroundRoutes,
	routeToAgent,
	routeToMcp,
	type PlaygroundAgent,
} from '@nullshot/agent'`);
    }
  }

  // MCP imports if we have MCPs
  if (config.mcps.length > 0) {
    imports.push(`import { McpHonoServerDO } from '@nullshot/mcp'`);
    imports.push(
      `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'`,
    );
    imports.push(
      `import type { Implementation } from '@modelcontextprotocol/sdk/types.js'`,
    );
    imports.push(`import { z } from 'zod'`);
  }

  // Telegram imports — shared modules handle everything
  if (hasTelegram) {
    imports.push(
      `import { setupDashboardRoutes } from 'telegram-bot-agent/dashboard/setup-dashboard'`,
    );
    imports.push(
      `import { setupTelegramRoutes } from 'telegram-bot-agent/dashboard/telegram-routes'`,
    );
  }

  // Generate playground agents list
  for (const agent of config.agents) {
    const routePath =
      agent.routes?.pattern.replace("/:sessionId?", "") ||
      `/agent/${agent.name}`;
    playgroundAgents.push(`{
		id: '${agent.name}',
		name: '${agent.description}',
		path: '${routePath}',
	}`);
  }

  // Generate DO bindings for env type
  for (const agent of config.agents) {
    envTypes.push(`${agent.exports.binding}: DurableObjectNamespace`);
    doBindings.push(agent.exports.binding);
  }
  for (const mcp of config.mcps) {
    envTypes.push(`${mcp.exports.binding}: DurableObjectNamespace`);
    doBindings.push(mcp.exports.binding);
  }

  // Add standard env types
  envTypes.push(`AI_PROVIDER: string`);
  envTypes.push(`OPEN_AI_API_KEY?: string`);
  envTypes.push(`ANTHROPIC_API_KEY?: string`);
  envTypes.push(`DEEPSEEK_API_KEY?: string`);
  envTypes.push(`GROK_API_KEY?: string`);
  envTypes.push(`MODEL_ID?: string`);

  if (config.agents.some((a) => a.name === "dependent-agent")) {
    envTypes.push(`AI_PROVIDER_API_KEY?: string`);
  }

  // Workers AI + Vectorize env types (always available when Telegram is included)
  if (hasTelegram) {
    envTypes.push(`AI?: Ai`);
    envTypes.push(`CHAT_MEMORY?: VectorizeIndex`);
  }

  // Telegram env types
  if (hasTelegram) {
    envTypes.push(`TELEGRAM_BOT_TOKEN?: string`);
    envTypes.push(`TELEGRAM_WEBHOOK_SECRET?: string`);
    envTypes.push(`SESSIONS: KVNamespace`);
    envTypes.push(`OWNER_ID?: string`);
    envTypes.push(`LOG_CHAT_ID?: string`);
    envTypes.push(`AGENT_URL?: string`);
    envTypes.push(`AGENTS?: string`);
  }

  // Add external binding types for MCPs that require them
  for (const mcp of config.mcps) {
    if (mcp.name === "kv-mcp") envTypes.push(`EXAMPLE_KV: KVNamespace`);
    if (mcp.name === "image-mcp") envTypes.push(`IMAGES_BUCKET: R2Bucket`);
    if (mcp.name === "email-mcp") envTypes.push(`EMAIL_DB: D1Database`);
  }

  // Generate routes for agents
  for (const agent of config.agents) {
    const routePattern =
      agent.routes?.pattern || `/agent/${agent.name}/chat/:sessionId?`;
    routes.push(
      `app.all('${routePattern}', async (c) => routeToAgent(c, c.env.${agent.exports.binding}, 'sessionId'))`,
    );
  }

  // Generate MCP discovery routes for each agent (playground uses basePath + '/mcp')
  if (config.mcps.length > 0) {
    const mcpServerList = config.mcps
      .map(
        (mcp) =>
          `{ name: '${mcp.name}', id: '${mcp.name}', connectionState: 'connected', tools: [] }`,
      )
      .join(", ");

    for (const agent of config.agents) {
      const basePath = (
        agent.routes?.pattern || `/agent/${agent.name}/chat/:sessionId?`
      )
        .replace("/:sessionId?", "")
        .replace("/chat", "");
      routes.push(
        `app.get('${basePath}/mcp', (c) => c.json({ mcpServers: [${mcpServerList}] }))`,
      );
    }
  }

  // Generate routes for MCPs
  for (const mcp of config.mcps) {
    const routePattern = mcp.routes?.pattern || `/mcp/${mcp.name}/*`;
    routes.push(
      `app.all('${routePattern}', async (c) => routeToMcp(c, c.env.${mcp.exports.binding}))`,
    );
  }

  // Generate agent classes
  for (const agent of config.agents) {
    doExports.push(generateAgentClass(agent));
  }

  // Generate MCP classes
  for (const mcp of config.mcps) {
    doExports.push(generateMcpClass(mcp));
  }

  // Build agent binding entries for Telegram internal routing
  const agentBindingEntries = config.agents.map(
    (a) =>
      `'${a.routes?.pattern.split("/")[2] || a.name}': env.${a.exports.binding}`,
  );
  const defaultAgentRouteKey =
    config.agents[0]?.routes?.pattern.split("/")[2] ||
    config.agents[0]?.name ||
    "agent";

  // Telegram integration blocks
  const telegramBlock = hasTelegram
    ? generateTelegramIntegrationBlock(
        config,
        agentBindingEntries,
        defaultAgentRouteKey,
      )
    : "";
  const defaultAgentBinding =
    config.agents[0]?.exports.binding || "SIMPLE_PROMPT_AGENT";
  const cronBlock = hasTelegram
    ? generateCronBlock(
        agentBindingEntries,
        defaultAgentRouteKey,
        defaultAgentBinding,
      )
    : "";

  // Playground setup
  let playgroundBlock = "";
  if (config.includePlayground) {
    if (hasTelegram) {
      // With Telegram: dynamic config with dashboard tab
      playgroundBlock = `
// Dashboard tab (shown when Telegram Bot is configured)
const dashboardTab: PlaygroundTab = {
	id: 'dashboard',
	label: 'Telegram Agents',
	icon: '',
	apiPath: '/api/dashboard',
	type: 'dashboard',
}

function getPlaygroundConfig(env: Env) {
	const tabs: PlaygroundTab[] = []
	if (env.TELEGRAM_BOT_TOKEN) tabs.push(dashboardTab)
	return { agents, tabs }
}

// Playground UI (dynamic tabs based on config)
app.get('/', (c) => {
	const { agents: a, tabs } = getPlaygroundConfig(c.env)
	return c.html(generatePlaygroundHTML({
		agents: a,
		tabs,
		title: '${config.name}',
		primaryColor: '${config.primaryColor || "#00d4aa"}',
		secondaryColor: '${config.secondaryColor || "#14b8a6"}',
	}))
})
app.get('/playground', (c) => {
	const { agents: a, tabs } = getPlaygroundConfig(c.env)
	return c.html(generatePlaygroundHTML({
		agents: a,
		tabs,
		title: '${config.name}',
		primaryColor: '${config.primaryColor || "#00d4aa"}',
		secondaryColor: '${config.secondaryColor || "#14b8a6"}',
	}))
})`;
    } else {
      playgroundBlock = `
// Playground UI
setupPlaygroundRoutes(app, {
	agents,
	title: '${config.name}',
	primaryColor: '${config.primaryColor || "#10b981"}',
	secondaryColor: '${config.secondaryColor || "#059669"}',
})`;
    }
  }

  // CORS headers
  const corsHeaders = hasTelegram
    ? `['Content-Type', 'X-Telegram-Bot-Api-Secret-Token', 'X-Dashboard-Pin']`
    : `['Content-Type']`;

  // Build the final file
  const code = `/**
 * Single Worker Bundle
 * Generated by: nullshot bundle
 * 
 * Components:
 * - Agents: ${config.agents.map((a) => a.name).join(", ") || "none"}
 * - MCPs: ${config.mcps.map((m) => m.name).join(", ") || "none"}
 * - Playground: ${config.includePlayground ? "yes" : "no"}
 * - Telegram Bot: ${hasTelegram ? "yes" : "no"}
 */

${imports.join("\n")}

// ============================================================================
// ENV TYPES
// ============================================================================

interface Env {
	${envTypes.join("\n\t")}
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const agents: PlaygroundAgent[] = [
	${playgroundAgents.join(",\n\t")}
]

// ============================================================================
// HONO APP
// ============================================================================

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors({
	origin: '*',
	allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
	allowHeaders: ${corsHeaders},
	exposeHeaders: ['X-Session-Id'],
}))

app.get('/api/info', (c) => c.json({
	name: '${config.name}',
	type: 'single-worker-bundle',
	agents: agents.map(a => a.id),
}))

${playgroundBlock}

${telegramBlock}

// Routes
${routes.join("\n")}

// ============================================================================
// DURABLE OBJECTS
// ============================================================================

${doExports.join("\n\n")}

// ============================================================================
// WORKER EXPORT
// ============================================================================

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return app.fetch(request, env, ctx)
	},
${cronBlock}
}
`;

  return code;
}

/**
 * Generate the Telegram integration block.
 *
 * ALL routes come from shared modules in telegram-bot-agent:
 * - setupDashboardRoutes: auth, settings, webhook mgmt, kanban, setup wizard, moderation logs
 * - setupTelegramRoutes:  test endpoint, webhook singleton, health check
 *
 * The wizard generates the SAME code as single-worker — just with
 * project-specific agent namespace config.
 */
function generateTelegramIntegrationBlock(
  config: BundleConfig,
  _agentBindingEntries: string[],
  _defaultAgentRouteKey: string,
): string {
  // Build agent namespace map entries for the config
  const namespaceEntries = config.agents
    .slice(1) // skip the first (default) agent
    .map((a) => {
      const routeKey = a.routes?.pattern.split("/")[2] || a.name;
      return `\t\t'${routeKey}': env.${a.exports.binding},`;
    });

  const defaultBinding =
    config.agents[0]?.exports.binding || "SIMPLE_PROMPT_AGENT";
  const defaultAgentLabel = config.agents[0]?.description || "Agent";

  return `
// ============================================================================
// DASHBOARD + TELEGRAM ROUTES (from shared modules — identical to single-worker)
// ============================================================================

// Dashboard API: auth, middleware, settings, webhook mgmt, kanban, setup wizard, moderation logs
setupDashboardRoutes(app, () => agents)

// Telegram routes: test endpoint, webhook singleton (setupCoreHandlers), health check
setupTelegramRoutes(app, {
	getAgentNamespaces: (env: Env) => ({
${namespaceEntries.join("\n")}
	}),
	getDefaultNamespace: (env: Env) => env.${defaultBinding},
	defaultAgentLabel: "${defaultAgentLabel}",
})

// Health check
app.get("/health", async (c) => {
	const { DASHBOARD_PIN_KEY } = await import("telegram-bot-agent/dashboard/setup-dashboard")
	const checks: Record<string, { status: string; detail?: string }> = {}
	try {
		if (c.env.SESSIONS) { await c.env.SESSIONS.get("_health_check"); checks.kv = { status: "ok" } }
		else checks.kv = { status: "error", detail: "SESSIONS binding not configured" }
	} catch (e) { checks.kv = { status: "error", detail: e instanceof Error ? e.message : "Unknown error" } }
	const provider = (c.env.AI_PROVIDER || "anthropic").toLowerCase()
	if (provider === "workers-ai") {
		checks.ai = { status: c.env.AI ? "ok" : "error", detail: \`Provider: Workers AI (Llama)\${c.env.AI ? "" : " — AI binding missing"}\` }
	} else {
		const keyMap: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPEN_AI_API_KEY", deepseek: "DEEPSEEK_API_KEY", google: "GOOGLE_API_KEY", grok: "GROK_API_KEY" }
		const requiredKey = keyMap[provider]
		if (requiredKey && (c.env as Record<string, unknown>)[requiredKey]) checks.ai = { status: "ok", detail: \`Provider: \${provider}\` }
		else if (requiredKey) checks.ai = { status: "error", detail: \`\${requiredKey} not set for provider "\${provider}"\` }
		else checks.ai = { status: "warning", detail: \`Unknown provider: \${provider}\` }
	}
	checks.workersAi = { status: c.env.AI ? "ok" : "skipped", detail: c.env.AI ? "AI binding available (embeddings, moderation, image gen)" : "AI binding not configured" }
	checks.vectorize = { status: c.env.CHAT_MEMORY ? "ok" : "skipped", detail: c.env.CHAT_MEMORY ? "Chat memory index available" : "CHAT_MEMORY binding not configured" }
	if (c.env.TELEGRAM_BOT_TOKEN) {
		const pinExists = await c.env.SESSIONS?.get(DASHBOARD_PIN_KEY)
		checks.telegram = { status: "ok", detail: pinExists ? "Configured, PIN set" : "Token set, PIN not yet generated (send /start)" }
	} else checks.telegram = { status: "skipped", detail: "TELEGRAM_BOT_TOKEN not set (optional)" }
	checks.durableObjects = { status: c.env.${defaultBinding} ? "ok" : "error", detail: "Agent bindings" }
	const allOk = Object.values(checks).every((ch) => ch.status === "ok" || ch.status === "skipped")
	return c.json({ status: allOk ? "healthy" : "degraded", timestamp: new Date().toISOString(), checks }, allOk ? 200 : 503)
})
`;
}

/**
 * Generate the cron handler block for scheduled posts.
 */
function generateCronBlock(
  _agentBindingEntries: string[],
  _defaultAgentRouteKey: string,
  defaultBinding: string,
): string {
  return `
	// Cron trigger for Kanban scheduled/recurring tasks (runs every minute)
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		if (!env.TELEGRAM_BOT_TOKEN || !env.SESSIONS) return
		try {
			const { hasAnyTasks, getKanbanBoard, cleanupOldTasks } = await import("telegram-bot-agent/utils/kanban-storage")
			const { processKanbanScheduledTasks, processKanbanRecurringTasks } = await import("telegram-bot-agent/utils/cron-processor")

			const hasTasks = await hasAnyTasks(env.SESSIONS)
			if (!hasTasks) return

			// Fetcher adapter: routes requests to the DO agent for AI content generation
			const agentServiceAdapter = {
				fetch(input: Request | string | URL, init?: RequestInit): Promise<Response> {
					const req = input instanceof Request ? input : new Request(typeof input === "string" ? input : input.href, init)
					const url = new URL(req.url)
					const pathParts = url.pathname.split("/")
					const sessionId = pathParts[pathParts.length - 1] || "default"
					const id = env.${defaultBinding}.idFromName(sessionId)
					const stub = env.${defaultBinding}.get(id)
					return stub.fetch(req)
				},
				connect: undefined as never,
			} as Fetcher

			const cronEnv = {
				TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN!,
				AGENT_URL: "",
				SESSIONS: env.SESSIONS,
				AGENT_SERVICE: agentServiceAdapter,
				AI: env.AI,
			}
			const board = await getKanbanBoard(env.SESSIONS)
			ctx.waitUntil(processKanbanScheduledTasks(cronEnv, board))
			ctx.waitUntil(processKanbanRecurringTasks(cronEnv, board))

			const now = new Date()
			if (now.getUTCMinutes() === 0) {
				ctx.waitUntil(cleanupOldTasks(env.SESSIONS, 30).then((removed: number) => {
					if (removed > 0) console.log(\`[Cron] Cleanup: removed \${removed} old tasks\`)
				}))
			}
		} catch (error) {
			console.error("[Cron] Error processing kanban tasks:", error)
		}
	},`;
}

/**
 * Generate agent class code
 */
function generateAgentClass(agent: ComponentConfig): string {
  // Get agent description for system prompt — enhanced to ensure the model
  // always responds conversationally even when tools are available.
  const baseDesc = agent.description || "You are a helpful AI assistant.";

  // Special handling for dependent-agent
  let systemPrompt: string;
  if (agent.name === "dependent-agent") {
    systemPrompt =
      "You are a conversational expert, enjoying deep, intellectual conversations. " +
      "Always respond with text. Use tools only when the user explicitly asks for an action " +
      "like creating, listing, or managing items. For greetings and casual conversation, " +
      "respond naturally without calling any tools.";
  } else {
    systemPrompt =
      baseDesc +
      " Always respond with text to the user. If the user sends a greeting or casual message, " +
      "reply naturally and conversationally. Only use tools when the user explicitly requests " +
      "an action (e.g. create, list, delete, manage items). Never return an empty response.";
  }

  // Determine API key variable name based on agent type
  const useProviderKey = agent.name === "dependent-agent";
  const apiKeyVar = useProviderKey
    ? "env.AI_PROVIDER_API_KEY || env.ANTHROPIC_API_KEY"
    : "env.ANTHROPIC_API_KEY";
  const openaiKeyVar = useProviderKey
    ? "env.AI_PROVIDER_API_KEY || env.OPEN_AI_API_KEY"
    : "env.OPEN_AI_API_KEY";
  const deepseekKeyVar = useProviderKey
    ? "env.AI_PROVIDER_API_KEY || env.DEEPSEEK_API_KEY"
    : "env.DEEPSEEK_API_KEY";
  const grokKeyVar = useProviderKey
    ? "env.AI_PROVIDER_API_KEY || env.GROK_API_KEY"
    : "env.GROK_API_KEY";

  return `export class ${agent.exports.className} extends AiSdkAgent<Env> {
	constructor(state: DurableObjectState, env: Env) {
		let provider: Provider
		let model: LanguageModel

		switch (env.AI_PROVIDER) {
			case 'workers-ai': {
				const workersAi = createWorkersAI({ binding: env.AI! })
				model = workersAi(env.MODEL_ID || '@cf/meta/llama-3.3-70b-instruct-fp8-fast')
				provider = workersAi as unknown as Provider
				break
			}
			case 'anthropic':
				provider = createAnthropic({ apiKey: ${apiKeyVar} })
				model = provider.languageModel(env.MODEL_ID || 'claude-3-haiku-20240307')
				break
			case 'deepseek':
				provider = createDeepSeek({ apiKey: ${deepseekKeyVar} })
				model = provider.languageModel(env.MODEL_ID || 'deepseek-chat')
				break
			case 'grok':
			case 'xai':
				provider = createXai({ apiKey: ${grokKeyVar} })
				model = provider.languageModel(env.MODEL_ID || 'grok-beta')
				break
			case 'openai':
			default:
				provider = createOpenAI({ apiKey: ${openaiKeyVar} })
				model = provider.languageModel(env.MODEL_ID || 'gpt-4o-mini')
				break
		}

		const services: Service[] = [new ToolboxService(env)]
		super(state, env, model, services)
	}

	async processMessage(sessionId: string, messages: AIUISDKMessage): Promise<Response> {
		try {
			const result = await this.streamTextWithMessages(sessionId, messages.messages, {
				system: '${systemPrompt}',
				maxSteps: 10,
				experimental_toolCallStreaming: true,
			})
			return result.toTextStreamResponse()
		} catch (error) {
			return new Response(\`0:"Error: \${error instanceof Error ? error.message : 'Unknown'}"\`, {
				status: 200,
				headers: { 'Content-Type': 'text/plain; charset=utf-8' },
			})
		}
	}
}`;
}

/**
 * MCP class templates for different MCP types
 * Each uses only Durable Object storage (no external bindings required)
 */
const MCP_TEMPLATES: Record<string, (className: string) => string> = {
  // Todo/CRUD MCP
  "crud-mcp": (
    className,
  ) => `export class ${className} extends McpHonoServerDO<Env> {
	private todos: Map<string, { id: string; title: string; description: string; completed: boolean; createdAt: string }> = new Map()

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		console.log('🏗️ ${className} constructor called')
		ctx.blockConcurrencyWhile(async () => {
			const stored = await ctx.storage.get<Record<string, any>>('todos')
			if (stored) {
				// Convert object back to Map
				this.todos = new Map(Object.entries(stored))
				console.log(\`📦 ${className}: Loaded \${this.todos.size} todos from storage\`)
			} else {
				console.log(\`📦 ${className}: No todos found in storage, starting fresh\`)
			}
		})
	}

	getImplementation(): Implementation {
		return { name: '${className}', version: '1.0.0' }
	}

	configureServer(server: McpServer): void {
		console.log('🔧 ${className}.configureServer: Registering tools...')
		
		server.tool('create_todo', 'Create a new todo item', {
			title: z.string().describe('Todo title'),
			description: z.string().optional().describe('Todo description'),
		}, async ({ title, description }) => {
			console.log(\`📝 ${className}.create_todo called: title="\${title}", description="\${description || ''}"\`)
			try {
			const id = crypto.randomUUID()
				const todo = { id, title, description: description || '', completed: false, createdAt: new Date().toISOString() }
			this.todos.set(id, todo)
				// Convert Map to object for storage (Map doesn't serialize well)
				const todosObj = Object.fromEntries(this.todos)
				await this.ctx.storage.put('todos', todosObj)
				console.log(\`✅ ${className}.create_todo: Created todo id=\${id}\`)
				return { content: [{ type: 'text', text: \`Created todo: \${title} (id: \${id})\` }] }
			} catch (error) {
				console.error(\`❌ ${className}.create_todo error:\`, error)
				throw error
			}
		})

		server.tool('list_todos', 'List all todos', {}, async () => {
			console.log(\`📝 ${className}.list_todos called\`)
			try {
			const list = Array.from(this.todos.values())
				console.log(\`📋 ${className}.list_todos: Found \${list.length} todos\`)
				if (!list.length) {
					console.log(\`📋 ${className}.list_todos: No todos found\`)
					return { content: [{ type: 'text', text: 'No todos found.' }] }
				}
				const text = list.map(t => \`[\${t.completed ? 'x' : ' '}] \${t.title} (id: \${t.id})\`).join('\\n')
				console.log(\`✅ ${className}.list_todos: Returning \${list.length} todos\`)
			return { content: [{ type: 'text', text: \`Todos:\\n\${text}\` }] }
			} catch (error) {
				console.error(\`❌ ${className}.list_todos error:\`, error)
				throw error
			}
		})

		server.tool('get_todo', 'Get a todo by ID', { id: z.string() }, async ({ id }) => {
			console.log(\`📝 ${className}.get_todo called: id="\${id}"\`)
			try {
			const todo = this.todos.get(id)
				if (!todo) {
					console.log(\`⚠️ ${className}.get_todo: Todo not found id=\${id}\`)
					return { content: [{ type: 'text', text: \`Todo not found: \${id}\` }] }
				}
				console.log(\`✅ ${className}.get_todo: Found todo id=\${id}, title="\${todo.title}"\`)
				return { content: [{ type: 'text', text: \`Todo: \${todo.title}\\nDescription: \${todo.description}\\nCompleted: \${todo.completed}\` }] }
			} catch (error) {
				console.error(\`❌ ${className}.get_todo error:\`, error)
				throw error
			}
		})

		server.tool('complete_todo', 'Mark a todo as completed', { id: z.string() }, async ({ id }) => {
			console.log(\`📝 ${className}.complete_todo called: id="\${id}"\`)
			try {
				const todo = this.todos.get(id)
				if (!todo) {
					console.log(\`⚠️ ${className}.complete_todo: Todo not found id=\${id}\`)
					return { content: [{ type: 'text', text: \`Todo not found: \${id}\` }] }
				}
			todo.completed = true
				// Convert Map to object for storage
				const todosObj = Object.fromEntries(this.todos)
				await this.ctx.storage.put('todos', todosObj)
				console.log(\`✅ ${className}.complete_todo: Completed todo id=\${id}, title="\${todo.title}"\`)
				return { content: [{ type: 'text', text: \`Completed: \${todo.title}\` }] }
			} catch (error) {
				console.error(\`❌ ${className}.complete_todo error:\`, error)
				throw error
			}
		})

		server.tool('delete_todo', 'Delete a todo', { id: z.string() }, async ({ id }) => {
			console.log(\`📝 ${className}.delete_todo called: id="\${id}"\`)
			try {
			const todo = this.todos.get(id)
				if (!todo) {
					console.log(\`⚠️ ${className}.delete_todo: Todo not found id=\${id}\`)
					return { content: [{ type: 'text', text: \`Todo not found: \${id}\` }] }
				}
			this.todos.delete(id)
				// Convert Map to object for storage
				const todosObj = Object.fromEntries(this.todos)
				await this.ctx.storage.put('todos', todosObj)
				console.log(\`✅ ${className}.delete_todo: Deleted todo id=\${id}, title="\${todo.title}"\`)
				return { content: [{ type: 'text', text: \`Deleted: \${todo.title}\` }] }
			} catch (error) {
				console.error(\`❌ ${className}.delete_todo error:\`, error)
				throw error
			}
		})
		
		console.log('✅ ${className}.configureServer: All tools registered')
	}
}`,

  // Expense tracking MCP
  "expense-mcp": (
    className,
  ) => `export class ${className} extends McpHonoServerDO<Env> {
	private expenses: Map<string, { id: string; amount: number; category: string; description: string; date: string }> = new Map()

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		ctx.blockConcurrencyWhile(async () => {
			const stored = await ctx.storage.get<Map<string, any>>('expenses')
			if (stored) this.expenses = stored
		})
	}

	getImplementation(): Implementation {
		return { name: '${className}', version: '1.0.0' }
	}

	configureServer(server: McpServer): void {
		server.tool('add_expense', 'Add a new expense', {
			amount: z.number().describe('Expense amount'),
			category: z.string().describe('Category (food, transport, entertainment, etc.)'),
			description: z.string().optional().describe('Description'),
		}, async ({ amount, category, description }) => {
			const id = crypto.randomUUID()
			const expense = { id, amount, category, description: description || '', date: new Date().toISOString() }
			this.expenses.set(id, expense)
			await this.ctx.storage.put('expenses', this.expenses)
			return { content: [{ type: 'text', text: \`Added expense: $\${amount} for \${category}\` }] }
		})

		server.tool('list_expenses', 'List all expenses', {
			category: z.string().optional().describe('Filter by category'),
		}, async ({ category }) => {
			let list = Array.from(this.expenses.values())
			if (category) list = list.filter(e => e.category === category)
			if (!list.length) return { content: [{ type: 'text', text: 'No expenses found.' }] }
			const total = list.reduce((sum, e) => sum + e.amount, 0)
			const text = list.map(e => \`$\${e.amount} - \${e.category}: \${e.description || 'No description'}\`).join('\\n')
			return { content: [{ type: 'text', text: \`Expenses (Total: $\${total}):\\n\${text}\` }] }
		})

		server.tool('get_expense_summary', 'Get expense summary by category', {}, async () => {
			const list = Array.from(this.expenses.values())
			const byCategory: Record<string, number> = {}
			list.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + e.amount })
			const text = Object.entries(byCategory).map(([cat, amt]) => \`\${cat}: $\${amt}\`).join('\\n')
			const total = list.reduce((sum, e) => sum + e.amount, 0)
			return { content: [{ type: 'text', text: \`Summary (Total: $\${total}):\\n\${text || 'No expenses'}\` }] }
		})

		server.tool('delete_expense', 'Delete an expense', { id: z.string() }, async ({ id }) => {
			const expense = this.expenses.get(id)
			if (!expense) return { content: [{ type: 'text', text: \`Expense not found: \${id}\` }] }
			this.expenses.delete(id)
			await this.ctx.storage.put('expenses', this.expenses)
			return { content: [{ type: 'text', text: \`Deleted expense: $\${expense.amount} for \${expense.category}\` }] }
		})
	}
}`,

  // Email log MCP (simplified - just logging, no actual sending)
  "email-mcp": (
    className,
  ) => `export class ${className} extends McpHonoServerDO<Env> {
	private emails: Map<string, { id: string; to: string; subject: string; body: string; sentAt: string }> = new Map()

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		ctx.blockConcurrencyWhile(async () => {
			const stored = await ctx.storage.get<Map<string, any>>('emails')
			if (stored) this.emails = stored
		})
	}

	getImplementation(): Implementation {
		return { name: '${className}', version: '1.0.0' }
	}

	configureServer(server: McpServer): void {
		server.tool('send_email', 'Send an email (simulated - logs the email)', {
			to: z.string().describe('Recipient email address'),
			subject: z.string().describe('Email subject'),
			body: z.string().describe('Email body'),
		}, async ({ to, subject, body }) => {
			const id = crypto.randomUUID()
			const email = { id, to, subject, body, sentAt: new Date().toISOString() }
			this.emails.set(id, email)
			await this.ctx.storage.put('emails', this.emails)
			return { content: [{ type: 'text', text: \`Email sent to \${to}: "\${subject}"\` }] }
		})

		server.tool('list_emails', 'List sent emails', {
			to: z.string().optional().describe('Filter by recipient'),
		}, async ({ to }) => {
			let list = Array.from(this.emails.values())
			if (to) list = list.filter(e => e.to === to)
			if (!list.length) return { content: [{ type: 'text', text: 'No emails found.' }] }
			const text = list.map(e => \`To: \${e.to} | Subject: \${e.subject} | Sent: \${e.sentAt}\`).join('\\n')
			return { content: [{ type: 'text', text: \`Emails:\\n\${text}\` }] }
		})

		server.tool('get_email', 'Get email by ID', { id: z.string() }, async ({ id }) => {
			const email = this.emails.get(id)
			if (!email) return { content: [{ type: 'text', text: \`Email not found: \${id}\` }] }
			return { content: [{ type: 'text', text: \`To: \${email.to}\\nSubject: \${email.subject}\\nBody: \${email.body}\\nSent: \${email.sentAt}\` }] }
		})
	}
}`,

  // Key-Value storage MCP - uses Cloudflare KV
  "kv-mcp": (
    className,
  ) => `export class ${className} extends McpHonoServerDO<Env> {
	getImplementation(): Implementation {
		return { name: '${className}', version: '1.0.0' }
	}

	configureServer(server: McpServer): void {
		server.tool('kv_set', 'Set a key-value pair in Cloudflare KV', {
			key: z.string().describe('The key'),
			value: z.string().describe('The value'),
		}, async ({ key, value }) => {
			await this.env.EXAMPLE_KV.put(key, value)
			return { content: [{ type: 'text', text: \`Set \${key} = \${value}\` }] }
		})

		server.tool('kv_get', 'Get a value by key from Cloudflare KV', { key: z.string() }, async ({ key }) => {
			const value = await this.env.EXAMPLE_KV.get(key)
			if (!value) return { content: [{ type: 'text', text: \`Key not found: \${key}\` }] }
			return { content: [{ type: 'text', text: \`\${key} = \${value}\` }] }
		})

		server.tool('kv_list', 'List keys in Cloudflare KV', {
			prefix: z.string().optional().describe('Filter by key prefix'),
		}, async ({ prefix }) => {
			const list = await this.env.EXAMPLE_KV.list({ prefix: prefix || undefined })
			if (!list.keys.length) return { content: [{ type: 'text', text: 'No keys found.' }] }
			const keys = list.keys.map(k => k.name)
			return { content: [{ type: 'text', text: \`Keys:\\n\${keys.join('\\n')}\` }] }
		})

		server.tool('kv_delete', 'Delete a key from Cloudflare KV', { key: z.string() }, async ({ key }) => {
			await this.env.EXAMPLE_KV.delete(key)
			return { content: [{ type: 'text', text: \`Deleted: \${key}\` }] }
		})
	}
}`,

  // Image metadata MCP (simplified - stores metadata, not actual images)
  "image-mcp": (
    className,
  ) => `export class ${className} extends McpHonoServerDO<Env> {
	private images: Map<string, { id: string; name: string; url: string; tags: string[]; uploadedAt: string }> = new Map()

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		ctx.blockConcurrencyWhile(async () => {
			const stored = await ctx.storage.get<Map<string, any>>('images')
			if (stored) this.images = stored
		})
	}

	getImplementation(): Implementation {
		return { name: '${className}', version: '1.0.0' }
	}

	configureServer(server: McpServer): void {
		server.tool('add_image', 'Add image metadata', {
			name: z.string().describe('Image name'),
			url: z.string().describe('Image URL'),
			tags: z.array(z.string()).optional().describe('Image tags'),
		}, async ({ name, url, tags }) => {
			const id = crypto.randomUUID()
			const image = { id, name, url, tags: tags || [], uploadedAt: new Date().toISOString() }
			this.images.set(id, image)
			await this.ctx.storage.put('images', this.images)
			return { content: [{ type: 'text', text: \`Added image: \${name} (id: \${id})\` }] }
		})

		server.tool('list_images', 'List all images', {
			tag: z.string().optional().describe('Filter by tag'),
		}, async ({ tag }) => {
			let list = Array.from(this.images.values())
			if (tag) list = list.filter(i => i.tags.includes(tag))
			if (!list.length) return { content: [{ type: 'text', text: 'No images found.' }] }
			const text = list.map(i => \`\${i.name} (tags: \${i.tags.join(', ') || 'none'})\`).join('\\n')
			return { content: [{ type: 'text', text: \`Images:\\n\${text}\` }] }
		})

		server.tool('get_image', 'Get image by ID', { id: z.string() }, async ({ id }) => {
			const image = this.images.get(id)
			if (!image) return { content: [{ type: 'text', text: \`Image not found: \${id}\` }] }
			return { content: [{ type: 'text', text: \`Name: \${image.name}\\nURL: \${image.url}\\nTags: \${image.tags.join(', ') || 'none'}\` }] }
		})

		server.tool('delete_image', 'Delete an image', { id: z.string() }, async ({ id }) => {
			const image = this.images.get(id)
			if (!image) return { content: [{ type: 'text', text: \`Image not found: \${id}\` }] }
			this.images.delete(id)
			await this.ctx.storage.put('images', this.images)
			return { content: [{ type: 'text', text: \`Deleted: \${image.name}\` }] }
		})
	}
}`,
};

/**
 * Generate MCP class code based on MCP name
 * Uses predefined templates for known MCPs, falls back to generic todo
 */
function generateMcpClass(mcp: ComponentConfig): string {
  const templateFn = MCP_TEMPLATES[mcp.name];
  if (templateFn) {
    return templateFn(mcp.exports.className);
  }

  // Fallback to generic todo MCP
  const fallbackTemplate = MCP_TEMPLATES["crud-mcp"];
  if (fallbackTemplate) {
    return fallbackTemplate(mcp.exports.className);
  }

  // Ultimate fallback - minimal MCP class
  return `export class ${mcp.exports.className} extends McpHonoServerDO<Env> {
	getImplementation(): Implementation {
		return { name: '${mcp.exports.className}', version: '1.0.0' }
	}
	configureServer(server: McpServer): void {
		// No tools configured
	}
}`;
}

/**
 * Read all migration entries from an existing bundle wrangler.jsonc.
 *
 * Cloudflare tracks every migration tag that has been applied to a deployed
 * script. If a subsequent deployment omits a previously-applied tag the API
 * emits a warning (or error). To stay compatible we must preserve **all**
 * prior migration entries and only append new ones.
 */
function getPreviousMigrations(outputDir: string): {
  migrations: Array<Record<string, unknown>>;
  createdClasses: Set<string>;
  deletedClasses: Set<string>;
} {
  const existingConfigPath = join(outputDir, "wrangler.jsonc");
  const empty = {
    migrations: [],
    createdClasses: new Set<string>(),
    deletedClasses: new Set<string>(),
  };

  if (!existsSync(existingConfigPath)) {
    return empty;
  }

  try {
    const raw = readFileSync(existingConfigPath, "utf-8");
    // Strip comments (// and /* */) for JSON.parse
    const stripped = raw
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      // Remove trailing commas before } or ]
      .replace(/,\s*([}\]])/g, "$1");
    const parsed = JSON.parse(stripped);

    if (!Array.isArray(parsed.migrations)) {
      return empty;
    }

    const createdClasses = new Set<string>();
    const deletedClasses = new Set<string>();

    for (const migration of parsed.migrations) {
      for (const cls of migration.new_sqlite_classes ??
        migration.new_classes ??
        []) {
        createdClasses.add(cls as string);
      }
      for (const cls of migration.deleted_classes ?? []) {
        deletedClasses.add(cls as string);
      }
    }

    return {
      migrations: parsed.migrations as Array<Record<string, unknown>>,
      createdClasses,
      deletedClasses,
    };
  } catch {
    // If we can't parse, return empty — safe fallback
    return empty;
  }
}

/**
 * Generate wrangler.jsonc
 */
export function generateWranglerConfig(config: BundleConfig): string {
  const doBindings = [];
  const currentClassNames: string[] = [];

  for (const agent of config.agents) {
    doBindings.push({
      name: agent.exports.binding,
      class_name: agent.exports.className,
    });
    currentClassNames.push(agent.exports.className);
  }

  for (const mcp of config.mcps) {
    doBindings.push({
      name: mcp.exports.binding,
      class_name: mcp.exports.className,
    });
    currentClassNames.push(mcp.exports.className);
  }

  // ── Build migrations ────────────────────────────────────────────────
  //
  // Strategy:
  //   1. Start with ALL previous migration entries (preserves every tag
  //      Cloudflare has already applied — avoids "tag not found" warnings).
  //   2. Append new `do-{ClassName}` entries for classes that don't yet
  //      have a creation migration.
  //   3. Append `delete-{ClassName}` entries for classes that were
  //      previously created, are NOT in the current selection, and
  //      haven't already been deleted.

  const {
    migrations: previousMigrations,
    createdClasses: prevCreated,
    deletedClasses: prevDeleted,
  } = getPreviousMigrations(config.outputDir);

  const migrationConfig: Array<Record<string, unknown>> = [
    ...previousMigrations,
  ];
  const existingTags = new Set(migrationConfig.map((m) => m.tag as string));

  const currentClasses = new Set(currentClassNames);

  // Add creation migrations for brand-new classes (never deployed before)
  for (const className of currentClassNames) {
    const tag = `do-${className}`;
    if (!existingTags.has(tag)) {
      migrationConfig.push({ tag, new_sqlite_classes: [className] });
      existingTags.add(tag);
    }
  }

  // Add delete migrations for classes removed from the current selection
  for (const cls of prevCreated) {
    if (!currentClasses.has(cls) && !prevDeleted.has(cls)) {
      const deleteTag = `delete-${cls}`;
      if (!existingTags.has(deleteTag)) {
        logger.info(
          chalk.yellow(
            `   ⚠ Adding delete-class migration for removed DO: ${cls}`,
          ),
        );
        migrationConfig.push({ tag: deleteTag, deleted_classes: [cls] });
        existingTags.add(deleteTag);
      }
    }
  }

  // Re-create classes that were previously deleted but are now selected again
  for (const className of currentClassNames) {
    if (prevDeleted.has(className)) {
      const recreateTag = `recreate-${className}`;
      if (!existingTags.has(recreateTag)) {
        logger.info(
          chalk.cyan(
            `   ↻ Adding recreate migration for previously deleted DO: ${className}`,
          ),
        );
        migrationConfig.push({
          tag: recreateTag,
          new_sqlite_classes: [className],
        });
        existingTags.add(recreateTag);
      }
    }
  }

  // Build base config
  const wranglerConfig: Record<string, unknown> = {
    $schema: "node_modules/wrangler/config-schema.json",
    name: config.name.toLowerCase().replace(/\s+/g, "-"),
    main: "src/index.ts",
    compatibility_date: "2025-04-22",
    compatibility_flags: ["nodejs_compat"],
    observability: { enabled: true },
    durable_objects: { bindings: doBindings },
    migrations: migrationConfig,
    vars: { AI_PROVIDER: config.aiProvider },
  };

  // Add external bindings if configured
  if (config.mcpBindings) {
    // KV namespace for kv-mcp
    if (config.mcpBindings["kv-mcp"]) {
      wranglerConfig.kv_namespaces = [
        {
          binding: "EXAMPLE_KV",
          id: config.mcpBindings["kv-mcp"],
        },
      ];
    }

    // R2 bucket for image-mcp
    if (config.mcpBindings["image-mcp"]) {
      wranglerConfig.r2_buckets = [
        {
          binding: "IMAGES_BUCKET",
          bucket_name: config.mcpBindings["image-mcp"],
        },
      ];
    }

    // D1 database for email-mcp
    if (config.mcpBindings["email-mcp"]) {
      wranglerConfig.d1_databases = [
        {
          binding: "EMAIL_DB",
          database_id: config.mcpBindings["email-mcp"],
        },
      ];
    }
  }

  // Telegram Bot: KV namespace for SESSIONS + cron trigger + AI + Vectorize
  if (config.includeTelegram) {
    const kvNamespaces =
      (wranglerConfig.kv_namespaces as Array<Record<string, string>>) || [];
    kvNamespaces.push({
      binding: "SESSIONS",
      id: config.telegramKvId || "PLACEHOLDER_KV_ID",
    });
    wranglerConfig.kv_namespaces = kvNamespaces;

    // Workers AI binding (embeddings, LLM, image gen — free tier 10k Neurons/day)
    wranglerConfig.ai = { binding: "AI" };

    // Vectorize index for semantic chat memory
    wranglerConfig.vectorize = [
      { binding: "CHAT_MEMORY", index_name: "chat-memory" },
    ];

    // Cron trigger for scheduled posts + kanban tasks (every minute)
    wranglerConfig.triggers = { crons: ["* * * * *"] };
  }

  return JSON.stringify(wranglerConfig, null, "\t");
}

/**
 * Generate package.json
 * Uses catalog: for dependencies (like examples do) to ensure consistency
 */
export function generatePackageJson(config: BundleConfig): string {
  const deps: Record<string, string> = {
    hono: "^4.7.7", // Not in catalog, keep fixed version
  };

  // Collect all dependencies - use catalog: where available
  // Add all AI SDK providers since they're used in switch statements for provider switching
  if (config.agents.length > 0) {
    deps["ai"] = "catalog:";
    deps["@ai-sdk/openai"] = "catalog:";
    deps["@ai-sdk/anthropic"] = "catalog:";
    deps["@ai-sdk/deepseek"] = "catalog:";
    deps["@ai-sdk/xai"] = "catalog:";
    deps["workers-ai-provider"] = "catalog:";
    deps["@nullshot/agent"] = "workspace:*";
  }

  // Also add from agent dependencies if specified
  for (const agent of config.agents) {
    for (const dep of agent.dependencies) {
      if (dep.startsWith("@ai-sdk/")) {
        // Use catalog: for AI SDK packages
        if (!deps[dep]) {
          deps[dep] = "catalog:";
        }
      } else if (dep === "@nullshot/agent") {
        deps[dep] = "workspace:*";
      } else if (dep === "ai") {
        deps[dep] = "catalog:";
      } else if (dep === "workers-ai-provider") {
        deps[dep] = "catalog:";
      } else if (!deps[dep] && dep.startsWith("@")) {
        // Keep any other scoped deps
      }
    }
  }

  for (const mcp of config.mcps) {
    for (const dep of mcp.dependencies) {
      if (dep === "@nullshot/mcp") {
        deps[dep] = "workspace:*";
      } else if (dep === "@modelcontextprotocol/sdk") {
        deps[dep] = "catalog:";
      } else if (dep === "zod") {
        deps[dep] = "catalog:";
      }
    }
  }

  // Telegram Bot dependencies
  if (config.includeTelegram) {
    deps["grammy"] = "^1.40.0";
    deps["telegram-bot-agent"] = "workspace:*";
  }

  const pkg = {
    name: config.name.toLowerCase().replace(/\s+/g, "-"),
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      dev: "wrangler dev --local --port 8800",
      "dev:remote": "wrangler dev --remote --port 8800",
      deploy: "wrangler deploy",
      typecheck: "tsc --noEmit",
    },
    dependencies: deps,
    devDependencies: {
      "@cloudflare/workers-types": "catalog:",
      "@types/node": "catalog:",
      typescript: "catalog:",
      wrangler: "catalog:",
    },
  };

  return JSON.stringify(pkg, null, "\t");
}

/**
 * Create the bundle directory and files
 */
export async function createBundle(config: BundleConfig): Promise<void> {
  const { outputDir } = config;

  // Create directories
  mkdirSync(join(outputDir, "src"), { recursive: true });

  // Handle history reset
  const wranglerPath = join(outputDir, "wrangler.jsonc");
  if (config.resetHistory && existsSync(wranglerPath)) {
    try {
      // We import unlinkSync dynamically or just use fs.unlinkSync if imported
      // content of this file shows imports from "node:fs": { existsSync, mkdirSync, writeFileSync, readFileSync }
      // I need to add unlinkSync to imports or use import
      const { unlinkSync } = await import("node:fs");
      unlinkSync(wranglerPath);
      logger.info(chalk.yellow("   ↻ Resetting migration history..."));
    } catch (e) {
      logger.warn(chalk.yellow(`   ⚠ Failed to reset history: ${e}`));
    }
  }

  // Generate and write files
  const indexTs = generateBundledIndexTs(config);
  writeFileSync(join(outputDir, "src", "index.ts"), indexTs);

  const wranglerConfig = generateWranglerConfig(config);
  writeFileSync(wranglerPath, wranglerConfig);

  const packageJson = generatePackageJson(config);
  writeFileSync(join(outputDir, "package.json"), packageJson);

  // Generate tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "bundler",
      lib: ["ESNext"],
      types: ["@cloudflare/workers-types", "node"],
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      esModuleInterop: true,
    },
    include: ["src/**/*"],
  };
  writeFileSync(
    join(outputDir, "tsconfig.json"),
    JSON.stringify(tsconfig, null, "\t"),
  );

  logger.info(chalk.green(`✅ Bundle created at ${outputDir}`));
}
