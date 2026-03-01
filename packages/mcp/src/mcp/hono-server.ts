import { Hono } from 'hono';
import { McpServerDO, SSE_MESSAGE_ENDPOINT, WEBSOCKET_ENDPOINT, MCP_SUBPROTOCOL } from './server';
import type { AuthMiddlewareConfig } from '../auth/types.js';
import { createAuthMiddleware, createPrmHandler } from '../auth/index.js';

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
	 * Set up OAuth2 authentication for the server.
	 * This method configures both the Protected Resource Metadata endpoint
	 * and the authentication middleware.
	 *
	 * Must be called before the server starts handling requests (typically in the constructor).
	 *
	 * @param config - Authentication middleware configuration
	 *
	 * @example
	 * ```typescript
	 * constructor(ctx: DurableObjectState, env: Env) {
	 *   super(ctx, env)
	 *   this.setupAuth({
	 *     validateToken: async (token) => {
	 *       // Validate JWT or opaque token
	 *       return { valid: true, scopes: ['mcp'] }
	 *     },
	 *     resourceUrl: 'https://my-server.com/mcp',
	 *     authorizationServers: ['https://auth.my-server.com'],
	 *     scopesSupported: ['mcp', 'mcp:tools']
	 *   })
	 * }
	 * ```
	 */
	setupAuth(config: AuthMiddlewareConfig): void {
		this.authConfig = config;
		// Re-setup routes with auth configuration
		this.setupRoutes(this.app);
	}

	/**
	 * Set up routes for the MCP server
	 */
	protected setupRoutes(app: Hono<{ Bindings: Env }>) {
		// Setup authentication if configured
		if (this.authConfig) {
			const prmPath = this.authConfig.prmPath || '.well-known/oauth-protected-resource';

			// Register PRM endpoint (no authentication required)
			app.get(prmPath, createPrmHandler(this.authConfig));

			// Apply authentication middleware to all routes
			app.use('*', createAuthMiddleware(this.authConfig));
		}

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
