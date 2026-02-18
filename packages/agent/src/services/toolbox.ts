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
			console.log('🔧 Using static MCP configuration (imported mcp.json)');
			return this.mcpConfig.mcpServers;
		}

		console.log('ℹ️  No MCP servers configured - no mcp.json provided to ToolboxService');
		return {};
	}

	/**
	 * Find all service bindings of type Fetcher from the environment
	 * Note: These are candidates that need to be tested to see if they're MCP services
	 */
	private findFetcherBindings(): Record<string, Fetcher> {
		const fetcherBindings: Record<string, Fetcher> = {};

		// Iterate through all properties of the env object
		for (const [key, value] of Object.entries(this.env)) {
			// Check if the value is a Fetcher (has a fetch method but NOT a DurableObjectNamespace)
			// DurableObjectNamespace has idFromName, get, newUniqueId - we handle those separately
			if (
				value &&
				typeof value === 'object' &&
				'fetch' in value &&
				typeof value.fetch === 'function' &&
				!('idFromName' in value) // Exclude DurableObjectNamespace
			) {
				fetcherBindings[key] = value as Fetcher;
			}
		}

		console.log(
			`🔍 Found ${Object.keys(fetcherBindings).length} Fetcher service bindings to test: ${Object.keys(fetcherBindings).join(', ')}`,
		);
		return fetcherBindings;
	}

	/**
	 * Find all Durable Object Namespace bindings from the environment
	 * These could be co-located MCP servers in single-worker architecture
	 */
	private findDurableObjectBindings(): Record<string, DurableObjectNamespace> {
		const doBindings: Record<string, DurableObjectNamespace> = {};

		// Iterate through all properties of the env object
		for (const [key, value] of Object.entries(this.env)) {
			// DurableObjectNamespace has idFromName, get, newUniqueId methods
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

		console.log(
			`🔍 Found ${Object.keys(doBindings).length} Durable Object bindings to test: ${Object.keys(doBindings).join(', ')}`,
		);
		return doBindings;
	}

	/**
	 * Test if a Durable Object is an MCP service by trying the /sse endpoint
	 * Uses a singleton ID pattern ('mcp-singleton') for MCP servers
	 * 
	 * IMPORTANT: This test creates a temporary SSE connection that is immediately
	 * cancelled after checking response headers. The actual MCP connection will
	 * use a fresh sessionId to avoid zombie transport issues.
	 */
	private async testDOMCPBinding(bindingName: string, doNamespace: DurableObjectNamespace): Promise<{ isMCP: boolean; stub?: DurableObjectStub }> {
		try {
			// Use a well-known singleton ID for MCP servers
			const id = doNamespace.idFromName('mcp-singleton');
			const stub = doNamespace.get(id);

			// Generate a throwaway session ID just for the probe
			const probeSessionId = `mcp-probe-${crypto.randomUUID()}`;

			// Test the SSE endpoint with proper MCP headers and required sessionId parameter
			const response = await stub.fetch(
				new Request(`https://do-internal/sse?sessionId=${probeSessionId}`, {
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

			// CRITICAL: Cancel the probe response body to avoid zombie SSE transport
			// Without this, Transport A stays open with an unconsumed WritableStream
			try {
				if (response.body) {
					await response.body.cancel();
				}
			} catch {
				// Ignore cancel errors - the important thing is we don't leave it hanging
			}

			// Log detailed test results
			console.log(
				`🔍 DO ${bindingName} test results: status=${response.status}, SSE=${isSSE}, cache=${hasProperCaching}, keepalive=${hasKeepAlive}`,
			);

			// Consider it an MCP service if it has all the characteristics of an SSE MCP endpoint
			const isMCPService = response.status === 200 && isSSE && (hasProperCaching || hasKeepAlive);

			return { isMCP: isMCPService, stub: isMCPService ? stub : undefined };
		} catch (error) {
			console.log(`❌ DO ${bindingName} MCP test failed:`, error instanceof Error ? error.message : 'Unknown error');
			return { isMCP: false };
		}
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

	/**
	 * Detect if a server config uses github: source for service bindings
	 */
	private isServiceBindingSource(config: MCPServerConfig): boolean {
		return !!(config.source && config.source.startsWith('github:'));
	}

	/**
	 * Generate service binding name from server name
	 * e.g., "mcp-template" -> "MCP_TEMPLATE"
	 */
	private getServiceBindingName(serverName: string): string {
		return serverName.toUpperCase().replace(/-/g, '_');
	}

	/**
	 * Get service binding from environment
	 */
	private getServiceBinding(bindingName: string): Fetcher | undefined {
		// Service bindings are available as properties on the env object
		return (this.env as any)[bindingName];
	}

	/**
	 * Test if a service binding is an MCP service by trying the /sse endpoint
	 * This is a more conservative approach - only services that respond correctly to MCP SSE requests
	 * are considered MCP services.
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

			// Log detailed test results
			console.log(
				`🔍 ${bindingName} test results: status=${response.status}, SSE=${isSSE}, cache=${hasProperCaching}, keepalive=${hasKeepAlive}`,
			);

			// Consider it an MCP service if it has all the characteristics of an SSE MCP endpoint
			const isMCPService = response.status === 200 && isSSE && (hasProperCaching || hasKeepAlive);

			return isMCPService;
		} catch (error) {
			console.log(`❌ ${bindingName} MCP test failed:`, error instanceof Error ? error.message : 'Unknown error');
			return false;
		}
	}

	/**
	 * Initialize the tools service by connecting to configured MCP servers
	 */
	async initialize(): Promise<void> {
		console.log(`🚀 ToolboxService.initialize() called`)
		console.log(`🔍 ToolboxService: env keys:`, Object.keys(this.env).join(', '))
		
		// Get the MCP server configurations from mcp.json
		const mcpServers = this.parseServerConfig();
		console.log(`📋 ToolboxService: Parsed ${Object.keys(mcpServers).length} MCP server configs from mcp.json`)

		// Find all Fetcher service bindings for testing
		const fetcherBindings = this.findFetcherBindings();

		// Find all Durable Object bindings for testing (single-worker architecture)
		const doBindings = this.findDurableObjectBindings();

		console.log(
			`🔧 Toolbox Service: Initializing with ${Object.keys(mcpServers).length} configured servers, ${
				Object.keys(fetcherBindings).length
			} Fetcher bindings, and ${Object.keys(doBindings).length} DO bindings to test`,
		);

		// Track initialization results
		const initResults = {
			successful: 0,
			failed: 0,
			skipped: 0,
		};

		// 1. First handle configured servers from mcp.json
		for (const [name, config] of Object.entries(mcpServers)) {
			if (config.url) {
				// Handle URL-based MCP servers
				try {
					console.log(`🔗 Initializing URL MCP client for "${name}" at ${config.url}`);
					await this.mcpManager.connectUrl(config.url, name);
					console.log(`✅ URL MCP client for "${name}" initialized successfully`);
					initResults.successful++;
				} catch (error) {
					console.error(`❌ Failed to create URL MCP client for "${name}":`, error);
					initResults.failed++;
				}
			} else if (config.command) {
				console.warn(`⏭️  Skipping MCP server "${name}" with command transport (stdio not supported yet)`);
				initResults.skipped++;
			} else if (this.isServiceBindingSource(config)) {
				// Skip source-based servers silently - they'll be handled by auto-discovery
				initResults.skipped++;
			}
		}

		// 2. Auto-discover MCP services from all service bindings (multi-worker architecture)
		for (const [bindingName, fetcher] of Object.entries(fetcherBindings)) {
			try {
				console.log(`🧪 Testing service binding "${bindingName}" for MCP compatibility...`);
				const isMCPService = await this.testMCPServiceBinding(bindingName, fetcher);

				if (isMCPService) {
					console.log(`🎉 Auto-discovered MCP service: "${bindingName}"`);
					console.log(`🔗 Initializing auto-discovered MCP service "${bindingName}"`);
					await this.mcpManager.connectServiceBinding(fetcher, bindingName);
					console.log(`✅ Auto-discovered MCP service "${bindingName}" initialized successfully`);
					initResults.successful++;
				} else {
					console.log(`⏭️  Service binding "${bindingName}" is not an MCP service`);
					initResults.skipped++;
				}
			} catch (error) {
				console.error(`❌ Failed to test/initialize service binding "${bindingName}":`, error);
				initResults.failed++;
			}
		}

		// 3. Auto-discover MCP services from Durable Object bindings (single-worker architecture)
		for (const [bindingName, doNamespace] of Object.entries(doBindings)) {
			try {
				// Skip AGENT binding - that's the agent itself, not an MCP server
				if (bindingName === 'AGENT' || bindingName.endsWith('_AGENT')) {
					console.log(`⏭️  Skipping "${bindingName}" - appears to be an agent, not MCP`);
					initResults.skipped++;
					continue;
				}

				console.log(`🧪 Testing Durable Object "${bindingName}" for MCP compatibility...`);
				const { isMCP, stub } = await this.testDOMCPBinding(bindingName, doNamespace);

				if (isMCP && stub) {
					console.log(`🎉 Auto-discovered DO MCP service: "${bindingName}"`);
					// Wrap the DO stub as a Fetcher for compatibility with existing MCP client
					const fetcherWrapper = this.createDOFetcherWrapper(stub);
					// Create a FRESH sessionId for the real connection (separate from probe)
					const connectionSessionId = `mcp-${crypto.randomUUID()}`;
					const endpointWithSession = `/sse?sessionId=${connectionSessionId}`;
					await this.mcpManager.connectServiceBinding(fetcherWrapper, bindingName, endpointWithSession);
					console.log(`✅ DO MCP service "${bindingName}" initialized successfully`);
					initResults.successful++;
				} else {
					console.log(`⏭️  Durable Object "${bindingName}" is not an MCP service`);
					initResults.skipped++;
				}
			} catch (error) {
				console.error(`❌ Failed to test/initialize DO "${bindingName}":`, error);
				initResults.failed++;
			}
		}

		// Log initialization summary
		this.logInitializationSummary(initResults, mcpServers);

		// Log duplicate tool names
		this.checkForDuplicateToolNames();
		
		// Final verification: check if tools are available
		const finalTools = this.mcpManager.unstable_getAITools();
		const toolCount = finalTools ? Object.keys(finalTools).length : 0;
		console.log(`🎯 ToolboxService.initialize() completed: ${toolCount} tools available`)
		if (toolCount > 0) {
			console.log(`🛠️  ToolboxService tools: ${Object.keys(finalTools).join(', ')}`)
		} else {
			console.warn(`⚠️  ToolboxService.initialize() completed but NO TOOLS available!`)
		}
	}

	/**
	 * Log a comprehensive initialization summary
	 */
	private logInitializationSummary(
		initResults: { successful: number; failed: number; skipped: number },
		mcpServers: Record<string, MCPServerConfig>,
	): void {
		const totalProcessed = initResults.successful + initResults.failed + initResults.skipped;

		console.log(`\n🎯 Toolbox Service Initialization Summary:`);
		console.log(`📈 Total servers/bindings processed: ${totalProcessed}`);
		console.log(`✅ Successfully connected: ${initResults.successful}`);
		console.log(`❌ Failed to connect: ${initResults.failed}`);
		console.log(`⏭️  Skipped: ${initResults.skipped}`);

		// Get connection info and tool counts
		const connections = this.mcpManager.getConnectionInfo();
		const allTools = this.mcpManager.listTools();
		const uniqueTools = new Set(allTools.map((tool) => tool.name)).size;

		console.log(`\n🔗 Active connections: ${connections.length}`);
		console.log(`🛠️  Total tools available: ${allTools.length} (${uniqueTools} unique)`);

		// Break down tools by connection type if available
		const toolsByType = allTools.reduce(
			(acc, tool) => {
				const type = (tool as any).connectionType || 'unknown';
				acc[type] = (acc[type] || 0) + 1;
				return acc;
			},
			{} as Record<string, number>,
		);

		if (Object.keys(toolsByType).length > 0) {
			console.log(`📊 Tools by connection type:`, toolsByType);
		}

		if (connections.length > 0) {
			console.log(`\n📋 Active MCP Connections:`);
			connections.forEach((conn) => {
				const source = conn.type === 'url' ? '📝 configured (mcp.json)' : '🔗 auto-discovered';
				console.log(`  • "${conn.name}" (${conn.type}, ${source}): ${conn.tools.length} tools [${conn.connectionState}]`);
			});
		}

		console.log(`\n🚀 Toolbox Service ready! Configured + Auto-discovery enabled.\n`);
	}

	/**
	 * Check for duplicate tool names across MCP servers and log warnings
	 */
	private checkForDuplicateToolNames(): void {
		const toolsMap = new Map<string, string[]>();

		// Get all tools from the unified manager
		const allTools = this.mcpManager.listTools();

		if (allTools.length === 0) {
			console.log(`ℹ️  No tools detected from MCP servers`);
			return;
		}

		// Group tools by name and track which servers they come from
		for (const tool of allTools) {
			const name = tool.name;
			const serverName = (tool as any).serverName || tool.serverId;
			if (!toolsMap.has(name)) {
				toolsMap.set(name, []);
			}
			toolsMap.get(name)?.push(serverName);
		}

		// Find and log warnings for duplicate tools
		const duplicates = Array.from(toolsMap.entries()).filter(([_, servers]) => servers.length > 1);

		if (duplicates.length > 0) {
			console.warn(`\n⚠️  Found ${duplicates.length} duplicate tool names:`);
			duplicates.forEach(([toolName, servers]) => {
				console.warn(`  • Tool "${toolName}" available from: ${servers.join(', ')}`);
			});
			console.warn(`  Note: Tool calls may be ambiguous. Consider renaming tools or using server-specific prefixes.`);
		} else {
			console.log(`✨ All tool names are unique across MCP servers`);
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
		
		// Check if mcpTools is empty object - Anthropic SDK crashes on empty tools
		const hasMcpTools = mcpTools && Object.keys(mcpTools).length > 0;
		const hasInputTools = tools && Object.keys(tools).length > 0;

		// Log tool availability for debugging
		console.log(`🔧 ToolboxService.transformStreamTextTools: hasMcpTools=${hasMcpTools}, hasInputTools=${hasInputTools}`);
		if (hasMcpTools) {
			console.log(`🛠️  MCP tools available: ${Object.keys(mcpTools).join(', ')}`);
		}

		if (!hasMcpTools && !hasInputTools) {
			// Return undefined instead of empty object to avoid Anthropic SDK crash
			console.log(`⚠️  No tools available (neither MCP nor input tools)`);
			return undefined;
		}

		if (!hasInputTools) {
			console.log(`✅ Returning MCP tools only: ${Object.keys(mcpTools).join(', ')}`);
			return mcpTools;
		}

		if (!hasMcpTools) {
			console.log(`✅ Returning input tools only: ${Object.keys(tools).join(', ')}`);
			return tools;
		}

		const mergedTools = {
			...tools,
			...mcpTools,
		};
		console.log(`✅ Returning merged tools: ${Object.keys(mergedTools).join(', ')}`);
		return mergedTools;
	}
}
