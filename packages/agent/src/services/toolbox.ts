import { Hono } from 'hono';
import { ExternalService } from '../service';
import { AgentEnv } from '../env';
import { ToolSet } from 'ai';
import { MiddlewareService } from '../aisdk/middleware';
import { NullShotMCPClientManager } from '../client/mcp-client-manager';

/**
 * Configuration for an MCP tool server
 */
export interface MCPServerConfig {
	url?: string; // HTTP-based MCP server
	source?: string; // github: source for service bindings
	command?: string; // Local command execution
	args?: string[];
	env?: Record<string, string>;
}

/**
 * Full MCP configuration structure matching mcp.json format
 */
export interface MCPConfig {
	mcpServers: Record<string, MCPServerConfig>;
}

/**
 * Service for managing and exposing tools configurations and injecting them into the language model
 */
export class ToolboxService implements ExternalService, MiddlewareService {
	public name = '@nullshot/agent/toolbox-service';
	private env: AgentEnv;
	private mcpManager: NullShotMCPClientManager;
	private mcpConfig?: MCPConfig;

	constructor(env: AgentEnv, mcpConfig?: MCPConfig) {
		this.env = env;
		// Initialize MCP client manager with name and version
		this.mcpManager = new NullShotMCPClientManager('agent-toolbox', '1.0.0');
		this.mcpConfig = mcpConfig;
	}

	/**
	 * Parse the MCP servers configuration from static config
	 */
	private parseServerConfig(): Record<string, MCPServerConfig> {
		if (this.mcpConfig?.mcpServers) {
			return this.mcpConfig.mcpServers;
		}
		return {};
	}

	/**
	 * Find all service bindings of type Fetcher from the environment
	 * Note: These are candidates that need to be tested to see if they're MCP services
	 */
	private findFetcherBindings(): Record<string, Fetcher> {
		const fetcherBindings: Record<string, Fetcher> = {};

		for (const [key, value] of Object.entries(this.env)) {
			if (
				value &&
				typeof value === 'object' &&
				'fetch' in value &&
				typeof value.fetch === 'function' &&
				!('idFromName' in value)
			) {
				fetcherBindings[key] = value as Fetcher;
			}
		}

		return fetcherBindings;
	}

	/**
	 * Find all Durable Object Namespace bindings from the environment
	 * These could be co-located MCP servers in single-worker architecture
	 */
	private findDurableObjectBindings(): Record<string, DurableObjectNamespace> {
		const doBindings: Record<string, DurableObjectNamespace> = {};

		for (const [key, value] of Object.entries(this.env)) {
			if (
				value &&
				typeof value === 'object' &&
				'idFromName' in value &&
				'get' in value &&
				'newUniqueId' in value &&
				typeof (value as any).idFromName === 'function' &&
				typeof (value as any).get === 'function'
			) {
				doBindings[key] = value as DurableObjectNamespace;
			}
		}

		return doBindings;
	}

	/**
	 * Create a Fetcher-like wrapper around a DurableObjectStub
	 * This allows us to use the same MCP client code for both service bindings and DOs
	 */
	private createDOFetcherWrapper(stub: DurableObjectStub): Fetcher {
		return {
			fetch: (input: RequestInfo | URL, init?: RequestInit) => {
				// Convert input to Request if needed
				const request = input instanceof Request ? input : new Request(input, init);
				return stub.fetch(request);
			},
		} as Fetcher;
	}

	private isServiceBindingSource(config: MCPServerConfig): boolean {
		return !!(config.source && config.source.startsWith('github:'));
	}

	/**
	 * Test if a Fetcher service binding is an MCP service via SSE probe.
	 * Only used for multi-worker architecture (service bindings, not DOs).
	 */
	private async testMCPServiceBinding(bindingName: string, fetcher: Fetcher): Promise<boolean> {
		try {
			// Test the SSE endpoint with proper MCP headers
			const response = await fetcher.fetch(
				new Request('https://service-binding/sse', {
					method: 'GET',
					headers: {
						Accept: 'text/event-stream',
						'Cache-Control': 'no-cache',
						Connection: 'keep-alive',
					},
				}),
			);

			// Check response characteristics
			const contentType = response.headers.get('content-type');
			const cacheControl = response.headers.get('cache-control');
			const connection = response.headers.get('connection');

			const isSSE = contentType?.includes('text/event-stream') || false;
			const hasProperCaching = cacheControl?.includes('no-cache') || false;
			const hasKeepAlive = connection?.includes('keep-alive') || false;

			const isMCPService = response.status === 200 && isSSE && (hasProperCaching || hasKeepAlive);
			return isMCPService;
		} catch {
			return false;
		}
	}

	/**
	 * Check if a binding name looks like an MCP server by convention.
	 * Matches: *_MCP, *_MCP_SERVER, or exact "MCP" prefix patterns.
	 * This avoids expensive SSE probe requests on cold start.
	 */
	private isMCPBindingName(name: string): boolean {
		return name.endsWith('_MCP') || name.endsWith('_MCP_SERVER') || name.startsWith('MCP_');
	}

	/**
	 * Global init budget (ms) — must stay well under DO free-tier 30 s wall-clock limit.
	 * Leaves ~18 s for AI inference + response after MCP init.
	 */
	private static readonly INIT_TIMEOUT_MS = 10_000;

	/**
	 * Initialize the tools service by connecting to configured MCP servers.
	 *
	 * Uses a single AbortController so that when the global timeout fires,
	 * ALL underlying SSE fetch connections are actually cancelled — not just
	 * the JS promises. This is critical on Cloudflare free-tier where the DO
	 * stays "active" (and burns duration) until every pending I/O completes.
	 */
	async initialize(): Promise<void> {
		const mcpServers = this.parseServerConfig();
		const fetcherBindings = this.findFetcherBindings();
		const doBindings = this.findDurableObjectBindings();

		// One controller to rule them all — aborting it cancels every SSE connection
		const ac = new AbortController();
		const timer = setTimeout(() => ac.abort(), ToolboxService.INIT_TIMEOUT_MS);

		try {
			// 1. URL-based servers from mcp.json
			const urlConnections = Object.entries(mcpServers)
				.filter(([, config]) => !!config.url)
				.map(async ([name, config]) => {
					try {
						await this.mcpManager.connectUrl(config.url!, name);
						return true;
					} catch {
						return false;
					}
				});

			// 2. Fetcher service bindings — probe + connect
			const fetcherConnections = Object.entries(fetcherBindings).map(async ([bindingName, fetcher]) => {
				try {
					if (await this.testMCPServiceBinding(bindingName, fetcher)) {
						await this.mcpManager.connectServiceBinding(fetcher, bindingName, '/sse', ac.signal);
						return true;
					}
				} catch { /* skip */ }
				return false;
			});

			// 3. Durable Object bindings — skip agents, use _MCP naming convention
			const doConnections = Object.entries(doBindings)
				.filter(([name]) => !name.endsWith('_AGENT') && name !== 'AGENT')
				.filter(([name]) => this.isMCPBindingName(name))
				.map(async ([bindingName, doNamespace]) => {
					try {
						const id = doNamespace.idFromName('mcp-singleton');
						const stub = doNamespace.get(id);
						const fetcherWrapper = this.createDOFetcherWrapper(stub);
						const sessionId = `mcp-${crypto.randomUUID()}`;
						await this.mcpManager.connectServiceBinding(
							fetcherWrapper,
							bindingName,
							`/sse?sessionId=${sessionId}`,
							ac.signal,
						);
						return true;
					} catch {
						return false;
					}
				});

			// Run ALL connections in parallel — AbortController will cancel stragglers
			const allConnections = [...urlConnections, ...fetcherConnections, ...doConnections];
			const results = await Promise.allSettled(allConnections);

			const connected = results.filter(
				(r) => r.status === 'fulfilled' && r.value === true,
			).length;

			const finalTools = this.mcpManager.unstable_getAITools();
			const toolCount = finalTools ? Object.keys(finalTools).length : 0;
			console.log(
				`ToolboxService: ${connected}/${allConnections.length} MCP servers, ${toolCount} tools (budget ${ToolboxService.INIT_TIMEOUT_MS}ms)`,
			);
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * Register tool-related routes with the Hono app
	 */
	registerRoutes<E extends AgentEnv>(app: Hono<{ Bindings: E }>): void {
		try {
			// Register a route to get information about MCP servers
			app.get('/mcp', async (c) => {
				const mcpServers = this.mcpManager.getConnectionInfo();
				return c.json({ mcpServers }, 200);
			});
		} catch (error) {
			// Hono matcher may already be built if routes were registered after first request
			// This is not critical - routes are optional for debugging
			if (error instanceof Error && error.message.includes('matcher is already built')) {
				console.warn(`⚠️ ToolboxService.registerRoutes: Matcher already built, skipping route registration`);
				return;
			}
			throw error;
		}

		try {
			// Register a route to get all tools with details
			app.get('/tools', async (c) => {
				const allTools = this.mcpManager.listTools();
				const toolsInfo = allTools.map((tool) => ({
					name: tool.name,
					description: tool.description || 'No description available',
					mcpServer: tool.serverName || tool.serverId,
					type: tool.connectionType || 'url',
					parameters: tool.inputSchema?.properties || {},
				}));

				return c.json({ tools: toolsInfo }, 200);
			});
		} catch (error) {
			// Hono matcher may already be built if routes were registered after first request
			if (error instanceof Error && error.message.includes('matcher is already built')) {
				console.warn(`⚠️ ToolboxService.registerRoutes: Matcher already built, skipping /tools route`);
				return;
			}
			throw error;
		}
	}

	/**
	 * Clean up resources when service is shutdown
	 */
	async shutdown(): Promise<void> {
		// Close all connections through the unified manager
		await this.mcpManager.closeAllConnections();
	}

	transformStreamTextTools(tools?: ToolSet): ToolSet | undefined {
		const mcpTools = this.mcpManager.unstable_getAITools();

		const hasMcpTools = mcpTools && Object.keys(mcpTools).length > 0;
		const hasInputTools = tools && Object.keys(tools).length > 0;

		if (!hasMcpTools && !hasInputTools) return undefined;
		if (!hasInputTools) return mcpTools;
		if (!hasMcpTools) return tools;

		return { ...tools, ...mcpTools };
	}
}
