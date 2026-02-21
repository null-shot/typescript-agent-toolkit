import { MCPClientManager } from 'agents/mcp/client';
import { ServiceBindingSSEClientTransport } from './service-binding-transport.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolSet } from 'ai';
import { jsonSchema } from 'ai';
import type { JSONSchema7 } from 'ai';

/**
 * Enhanced connection info that includes both URL and service binding connections
 */
interface EnhancedConnectionInfo {
	id: string;
	name: string;
	type: 'url' | 'service-binding';
	connectionState: string;
	tools: Tool[];
	client?: Client; // For service bindings only
}

/**
 * Safely converts MCP tool inputSchema to JSONSchema7
 * MCP tools use JSON Schema format but aren't strictly typed as JSONSchema7
 */
function convertMCPSchemaToJSONSchema7(mcpSchema: Tool['inputSchema']): JSONSchema7 {
	// MCP inputSchema should be compatible with JSONSchema7, but TypeScript can't verify this
	// We perform basic validation and return a properly typed schema
	if (!mcpSchema || typeof mcpSchema !== 'object') {
		console.log('⚠️ MCP schema is empty or invalid, using default empty object schema');
		// Fallback to empty object schema if invalid
		return {
			type: 'object',
			properties: {},
			additionalProperties: false,
		};
	}

	// Ensure the schema has a type - required by AI SDK providers
	const schema = mcpSchema as JSONSchema7;
	if (!schema.type) {
		console.log('⚠️ MCP schema missing type, adding "object" type');
		return {
			type: 'object',
			...schema,
		};
	}

	// MCP schemas are JSON Schema objects, so this should be safe
	return schema;
}

/**
 * UnifiedMCPClientManager extends MCPClientManager to add service binding support.
 * This provides a seamless interface where both URL-based and service binding MCP servers
 * appear as normal tools through the same manager.
 */
export class NullShotMCPClientManager extends MCPClientManager {
	private enhancedConnections: Map<string, EnhancedConnectionInfo> = new Map();

	constructor(name: string, version: string) {
		super(name, version);
	}

	/**
	 * Connect to a URL-based MCP server (enhanced to track server names)
	 */
	async connectUrl(url: string, serverName: string): Promise<{ id: string }> {
		const result = await super.connect(url);

		// Store enhanced connection info for this URL connection
		this.enhancedConnections.set(result.id, {
			id: result.id,
			name: serverName,
			type: 'url',
			connectionState: 'ready',
			tools: [], // Tools are managed by parent class, accessed via super.listTools()
		});

		return result;
	}

	/**
	 * Connect to a service binding MCP server.
	 * Pass an AbortSignal to cancel the underlying SSE connection on timeout.
	 */
	async connectServiceBinding(serviceBinding: Fetcher, serverName: string, endpoint: string = '/sse', abortSignal?: AbortSignal): Promise<{ id: string }> {
		const transport = new ServiceBindingSSEClientTransport(serviceBinding, endpoint, abortSignal);
		const client = new Client({ name: 'unified-client', version: '1.0.0' }, { capabilities: {} });

		// Initialize enhanced connection info
		const enhancedInfo: EnhancedConnectionInfo = {
			id: serverName,
			name: serverName,
			type: 'service-binding',
			connectionState: 'connecting',
			tools: [],
			client,
		};

		// Store connection info early
		this.enhancedConnections.set(serverName, enhancedInfo);

		try {
			// Connect to the MCP server via service binding
			await client.connect(transport);
			enhancedInfo.connectionState = 'discovering';

			// Get server capabilities
			const serverCapabilities = await client.getServerCapabilities();

			if (!serverCapabilities) {
				throw new Error('The MCP Server failed to return server capabilities');
			}

			// Fetch tools if supported
			if (serverCapabilities.tools) {
				enhancedInfo.tools = await this.fetchServiceBindingTools(client);
			}

			enhancedInfo.connectionState = 'ready';
		} catch (error) {
			enhancedInfo.connectionState = 'failed';
			throw error;
		}

		return { id: serverName };
	}

	/**
	 * Fetch tools from a service binding client
	 */
	private async fetchServiceBindingTools(client: Client): Promise<Tool[]> {
		let toolsAgg: Tool[] = [];
		let nextCursor: string | undefined;

		do {
			const toolsResult = await client.listTools({ cursor: nextCursor });
			toolsAgg = toolsAgg.concat(toolsResult.tools);
			nextCursor = toolsResult.nextCursor;
		} while (nextCursor);

		return toolsAgg;
	}

	/**
	 * Override listTools to include service binding tools
	 */
	listTools(): (Tool & { serverId: string; serverName: string; connectionType: string })[] {
		const allTools: (Tool & { serverId: string; serverName: string; connectionType: string })[] = [];

		// Get URL tools from parent class and enhance with server names
		const urlTools = super.listTools();
		for (const tool of urlTools) {
			const connectionInfo = this.enhancedConnections.get(tool.serverId);
			allTools.push({
				...tool,
				serverName: connectionInfo?.name || tool.serverId,
				connectionType: 'url',
			});
		}

		// Get service binding tools from enhanced connections
		for (const connectionInfo of this.enhancedConnections.values()) {
			if (connectionInfo.type === 'service-binding') {
				for (const tool of connectionInfo.tools) {
					allTools.push({
						...tool,
						serverId: connectionInfo.id,
						serverName: connectionInfo.name,
						connectionType: connectionInfo.type,
					});
				}
			}
		}

		return allTools;
	}

	/**
	 * Override unstable_getAITools to generate AI SDK v5 compatible tools for ALL connections
	 * This completely replaces the parent implementation to ensure v5 compatibility
	 * Note: Using 'any' return type to handle v4/v5 compatibility with agents package
	 */
	unstable_getAITools(): any {
		const aiTools: ToolSet = {};

		// Generate v5-compatible tools for ALL enhanced connections (both URL and service binding)
		for (const connectionInfo of this.enhancedConnections.values()) {
			// Get tools based on connection type
			let toolsToProcess: Tool[] = [];

			if (connectionInfo.type === 'service-binding') {
				toolsToProcess = connectionInfo.tools;
			} else if (connectionInfo.type === 'url') {
				// Get URL tools from parent class for this specific connection
				const urlTools = super.listTools().filter((tool) => tool.serverId === connectionInfo.id);
				toolsToProcess = urlTools;
			}

			// Convert each tool to AI SDK v5 format
			for (const tool of toolsToProcess) {
				// Use original tool name without prefix to match what the agent expects
				// Prefix is only needed if there are duplicate tool names across servers
				const toolKey = tool.name;
				
				// Check for duplicate tool names and add prefix only if needed
				if (aiTools[toolKey]) {
					// Tool name conflict - use prefixed name
					const prefixedKey = `${connectionInfo.name}-${tool.name}`;
					console.warn(`⚠️ Tool name conflict: "${tool.name}" already exists. Using prefixed name: "${prefixedKey}"`);
					// Don't overwrite existing tool, use prefixed version instead
					const schema = convertMCPSchemaToJSONSchema7(tool.inputSchema);
					aiTools[prefixedKey] = {
						description: `${tool.description || `Tool: ${tool.name}`} (from ${connectionInfo.name})`,
						inputSchema: jsonSchema(schema),
						execute: async (params: any) => {
							console.log(`🔧 Executing tool "${prefixedKey}" (${tool.name}) with params:`, JSON.stringify(params));
							try {
								if (connectionInfo.type === 'service-binding' && connectionInfo.client) {
									console.log(`📞 Calling MCP tool "${tool.name}" via service binding`);
									const result = await connectionInfo.client.callTool({
										name: tool.name,
										arguments: params,
									});
									console.log(`✅ Tool "${tool.name}" returned result:`, JSON.stringify(result));
									if (result.content && Array.isArray(result.content)) {
										const textResult = result.content.map((c: any) => c.text || JSON.stringify(c)).join('\n');
										console.log(`📝 Tool "${tool.name}" text result:`, textResult);
										return textResult;
									}
									const jsonResult = JSON.stringify(result);
									console.log(`📝 Tool "${tool.name}" JSON result:`, jsonResult);
									return jsonResult;
								} else {
									console.log(`📞 Calling MCP tool "${tool.name}" via URL`);
									const result = await super.callTool({
										serverId: connectionInfo.id,
										name: tool.name,
										arguments: params,
									});
									console.log(`✅ Tool "${tool.name}" returned result:`, JSON.stringify(result));
									if (result.content && Array.isArray(result.content)) {
										const textResult = result.content.map((c: any) => c.text || JSON.stringify(c)).join('\n');
										console.log(`📝 Tool "${tool.name}" text result:`, textResult);
										return textResult;
									}
									const jsonResult = JSON.stringify(result);
									console.log(`📝 Tool "${tool.name}" JSON result:`, jsonResult);
									return jsonResult;
								}
							} catch (error) {
								console.error(`❌ Error executing tool "${tool.name}":`, error);
								throw error;
							}
						},
					};
				} else {
					// No conflict - use original tool name
					const schema = convertMCPSchemaToJSONSchema7(tool.inputSchema);
					aiTools[toolKey] = {
						description: tool.description || `Tool: ${tool.name}`,
						// AI SDK v5 Tool interface expects inputSchema wrapped with jsonSchema()
						inputSchema: jsonSchema(schema),
						execute: async (params: any) => {
							console.log(`🔧 Executing tool "${tool.name}" with params:`, JSON.stringify(params));
							try {
								if (connectionInfo.type === 'service-binding' && connectionInfo.client) {
									console.log(`📞 Calling MCP tool "${tool.name}" via service binding`);
									const result = await connectionInfo.client.callTool({
										name: tool.name,
										arguments: params,
									});
									console.log(`✅ Tool "${tool.name}" returned result:`, JSON.stringify(result));
									// Return text content from MCP result
									if (result.content && Array.isArray(result.content)) {
										const textResult = result.content.map((c: any) => c.text || JSON.stringify(c)).join('\n');
										console.log(`📝 Tool "${tool.name}" text result:`, textResult);
										return textResult;
									}
									const jsonResult = JSON.stringify(result);
									console.log(`📝 Tool "${tool.name}" JSON result:`, jsonResult);
									return jsonResult;
								} else {
									// For URL connections, delegate to parent callTool
									console.log(`📞 Calling MCP tool "${tool.name}" via URL`);
									const result = await super.callTool({
										serverId: connectionInfo.id,
										name: tool.name,
										arguments: params,
									});
									console.log(`✅ Tool "${tool.name}" returned result:`, JSON.stringify(result));
									if (result.content && Array.isArray(result.content)) {
										const textResult = result.content.map((c: any) => c.text || JSON.stringify(c)).join('\n');
										console.log(`📝 Tool "${tool.name}" text result:`, textResult);
										return textResult;
									}
									const jsonResult = JSON.stringify(result);
									console.log(`📝 Tool "${tool.name}" JSON result:`, jsonResult);
									return jsonResult;
								}
							} catch (error) {
								console.error(`❌ Error executing tool "${tool.name}":`, error);
								throw error;
							}
						},
					};
				}
			}
		}

		return aiTools;
	}

	/**
	 * Call a tool from either URL or service binding connections
	 */
	async callTool(params: { serverId: string; name: string; arguments: any }): Promise<any> {
		// Check if this is in our enhanced connections (could be service binding)
		const connectionInfo = this.enhancedConnections.get(params.serverId);
		if (connectionInfo && connectionInfo.type === 'service-binding' && connectionInfo.client) {
			return await connectionInfo.client.callTool({
				name: params.name,
				arguments: params.arguments,
			});
		}

		// Otherwise, delegate to parent class for URL-based servers
		return await super.callTool(params);
	}

	/**
	 * Get connection information for both URL and service binding servers
	 */
	getConnectionInfo(): Array<{
		id: string;
		name: string;
		type: 'url' | 'service-binding';
		connectionState: string;
		tools: string[];
		toolDetails: Array<{ name: string; description?: string; params: string[] }>;
	}> {
		return Array.from(this.enhancedConnections.values()).map((connectionInfo) => ({
			id: connectionInfo.id,
			name: connectionInfo.name,
			type: connectionInfo.type,
			connectionState: connectionInfo.connectionState,
			tools: connectionInfo.tools.map((tool) => tool.name),
			toolDetails: connectionInfo.tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				params: Object.keys((tool.inputSchema as any)?.properties || {}),
			})),
		}));
	}

	/**
	 * Override closeAllConnections to include service bindings
	 */
	async closeAllConnections(): Promise<void[]> {
		// Close URL connections
		const urlResults = await super.closeAllConnections();

		// Close service binding connections
		const serviceBindingResults = await Promise.all(
			Array.from(this.enhancedConnections.values())
				.filter((conn) => conn.type === 'service-binding' && conn.client)
				.map((conn) => conn.client!.close()),
		);

		// Clear tracking
		this.enhancedConnections.clear();

		return [...urlResults, ...serviceBindingResults];
	}
}
