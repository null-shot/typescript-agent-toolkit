import { Implementation } from '@modelcontextprotocol/sdk/types.js';
import { McpHonoServerDO } from '@nullshot/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setupServerTools } from './tools';
import { setupServerResources } from './resources';
import { setupServerPrompts } from './prompts';

/**
 * TodoMcpServer extends McpHonoServerDO for CRUD operations on todo items
 */
export class KvMcpServer extends McpHonoServerDO<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	/**
	 * Implementation of the required abstract method
	 */
	getImplementation(): Implementation {
		return {
			name: 'KvMcpServer',
			version: '1.0.0',
		};
	}

	/**
	 * Implements the required abstract configureServer method
	 * Registers CRUD tools for the MCP server
	 */
	configureServer(server: McpServer): void {
		// Create and set up tools and resources with our repository
		setupServerTools(server, this.env);
		setupServerResources(server);
		setupServerPrompts(server);
	}
}
