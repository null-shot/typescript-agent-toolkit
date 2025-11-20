import { Hono } from 'hono';
import { McpServerDO, SSE_MESSAGE_ENDPOINT, WEBSOCKET_ENDPOINT, MCP_SUBPROTOCOL } from './server';
import { cors } from 'hono/cors';

// Support both Cloudflare and Hono environments
export abstract class McpHonoServerDO<Env extends Record<string, any> = Record<string, any>> extends McpServerDO<Env> {
	private app: Hono<{ Bindings: Env }>;

	public constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.app = new Hono<{ Bindings: Env }>();
		this.app.use(
			cors({
				origin: '*',
				exposeHeaders: ['mcp-session-id', 'mcp-protocol-version'],
				allowHeaders: ['Content-Type', 'mcp-session-id', 'mcp-protocol-version'],
			}),
		);
		this.setupRoutes(this.app);
	}

	async fetch(request: Request): Promise<Response> {
		return await this.app.fetch(request);
	}

	/**
	 * Set up routes for the MCP server
	 */
	protected setupRoutes(app: Hono<{ Bindings: Env }>) {
		// HTTP endpoint for Streamable HTTP transport
		app.all('/mcp', async (c) => {
			return await this.processHttpRequest(c.req.raw);
		});

		// WebSocket endpoint for direct connections
		app.get('/ws', async (c) => {
			// All WebSocket validation will be done in processWebSocketConnection
			return this.processWebSocketConnection(c.req.raw);
		});

		// SSE endpoint for event streaming
		app.get(`/sse`, async (c) => {
			return this.processSSEConnection(c.req.raw);
		});

		// Message handling endpoint for SSE clients
		app.post(SSE_MESSAGE_ENDPOINT, async (c) => {
			return this.processMcpRequest(c.req.raw);
		});

		// Add headers middleware to set common headers for SSE connections
		app.use(`/sse`, async (c, next) => {
			await next();
			if (c.res.headers.get('Content-Type') === 'text/event-stream') {
				c.res.headers.set('Cache-Control', 'no-cache');
				c.res.headers.set('Connection', 'keep-alive');
			}
		});
	}
}
