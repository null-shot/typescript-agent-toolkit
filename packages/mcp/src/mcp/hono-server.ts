import { Hono } from 'hono';
import { McpServerDO, SSE_MESSAGE_ENDPOINT, WEBSOCKET_ENDPOINT } from './server';

// Support both Cloudflare and Hono environments
export abstract class McpHonoServerDO<Env extends Record<string, any> = Record<string, any>> extends McpServerDO<Env> {
	private app: Hono<{ Bindings: Env }>;

	public constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.app = new Hono<{ Bindings: Env }>();
		this.setupRoutes(this.app);
	}

	async fetch(request: Request): Promise<Response> {
		return await this.app.fetch(request);
	}

	/**
	 * Set up routes for the MCP server
	 * 
	 * Uses endsWith() path-matching that works both for direct DO access (/sse)
	 * and proxied access through worker routes (/mcp/todo/sse).
	 * This replicates the flexible matching from the parent McpServerDO.fetch().
	 */
	protected setupRoutes(app: Hono<{ Bindings: Env }>) {
		// Catch-all handler that uses endsWith() matching for MCP protocol paths
		// This ensures /sse, /mcp/todo/sse, /ws, /sse/message all work correctly
		app.all('*', async (c) => {
			const path = new URL(c.req.url).pathname;
			
			if (path.endsWith(WEBSOCKET_ENDPOINT)) {
				return this.processWebSocketConnection(c.req.raw);
			}
			
			if (path.endsWith('/sse')) {
				return this.processSSEConnection(c.req.raw);
			}
			
			if (path.endsWith(SSE_MESSAGE_ENDPOINT)) {
				return this.processMcpRequest(c.req.raw);
			}
			
			// Not an MCP path - return 404 (subclasses can override setupRoutes to add custom routes before this)
			return c.notFound();
		});
	}
}
