import { DurableObject } from 'cloudflare:workers';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSETransport } from './sse-transport';
import { WebSocketTransport } from './websocket-transport';
import { Implementation } from '@modelcontextprotocol/sdk/types.js';
import { IMcpServer } from './mcp-server-interface';
import type { AuthMiddlewareConfig, ProtectedResourceMetadata, TokenValidationResult } from '../auth/types.js';
// Transport factory removed - using direct imports
const MAXIMUM_MESSAGE_SIZE = 4 * 1024 * 1024; // 4MB
export const SSE_MESSAGE_ENDPOINT = '/sse/message';
export const WEBSOCKET_ENDPOINT = '/ws';
export const MCP_SUBPROTOCOL = 'mcp';

/**
 * Interface for the WebSocket attachment data
 */
interface WebSocketAttachment {
	sessionId: string;
}

/**
 * McpDurableServer is a Durable Object implementation of an MCP server.
 * It supports SSE connections for event streaming and WebSocket connections with hibernation.
 */
export abstract class McpServerDO<Env = unknown> extends DurableObject<Env> {
	private server: IMcpServer;
	private sessions: Map<string, SSETransport | WebSocketTransport> = new Map();
	protected ctx: DurableObjectState; // Make ctx accessible to subclasses
	protected authConfig?: AuthMiddlewareConfig; // Optional OAuth2 authentication configuration (protected for subclass access)

	constructor(ctx: DurableObjectState, env: any, server?: IMcpServer) {
		super(ctx, env);
		this.ctx = ctx; // Store ctx for subclass access

		if (!server) {
			// Only call configureServer if we have a real McpServer instance (not a proxy)
			this.configureServer((this.server = new McpServer(this.getImplementation())));
		} else {
			this.server = server;
		}
	}

	/**
	 * Returns the implementation information for the MCP server.
	 * Must be implemented by subclasses.
	 */
	abstract getImplementation(): Implementation;

	/**
	 * Abstract method that must be implemented by subclasses to configure the server instance.
	 * Called after server initialization to set up any additional server configuration, e.g., handlers of incoming RPC calls.
	 * Note: This is only called when using a real McpServer, not when using a proxy
	 * Can be synchronous or asynchronous (returning Promise<void>)
	 */
	abstract configureServer(server: McpServer): void | Promise<void>;

	/**
	 * Set OAuth2 authentication configuration for the server.
	 * When configured, all requests (except excluded paths) will require valid bearer token authentication.
	 *
	 * @param config - Authentication middleware configuration
	 *
	 * @example
	 * ```typescript
	 * server.setAuthConfig({
	 *   validateToken: async (token) => {
	 *     // Validate JWT or opaque token
	 *     return { valid: true, scopes: ['mcp'] }
	 *   },
	 *   resourceUrl: 'https://my-server.com/mcp',
	 *   authorizationServers: ['https://auth.my-server.com'],
	 *   scopesSupported: ['mcp', 'mcp:tools']
	 * })
	 * ```
	 */
	setAuthConfig(config: AuthMiddlewareConfig): void {
		this.authConfig = config;
	}

	/**
	 * Extract bearer token from Authorization header
	 */
	private extractBearerToken(authHeader: string | null): string | null {
		if (!authHeader) {
			return null;
		}

		const match = authHeader.match(/^Bearer\s+(.+)$/i);
		if (!match) {
			return null;
		}

		const token = match[1]?.trim();
		if (!token) {
			return null;
		}

		return token;
	}

	/**
	 * Check if a path should be excluded from authentication
	 */
	private isPathExcluded(path: string): boolean {
		if (!this.authConfig?.excludedPaths || this.authConfig.excludedPaths.length === 0) {
			return false;
		}

		return this.authConfig.excludedPaths.some((excluded) => {
			if (excluded.endsWith('/')) {
				return path.startsWith(excluded);
			}
			return path === excluded || path.startsWith(excluded + '/');
		});
	}

	/**
	 * Validate authentication for a request
	 * Returns null if valid, or a Response if authentication failed
	 */
	private async validateAuth(request: Request): Promise<Response | null> {
		if (!this.authConfig) {
			return null; // No auth configured, allow request
		}

		const url = new URL(request.url);
		const path = url.pathname;

		// Check if path is excluded from authentication
		if (this.isPathExcluded(path)) {
			return null;
		}

		// Check for PRM endpoint (always accessible)
		const prmPath = this.authConfig.prmPath || '.well-known/oauth-protected-resource';
		if (path.endsWith(prmPath)) {
			return null;
		}

		// Extract bearer token from Authorization header
		const authHeader = request.headers.get('Authorization');
		const token = this.extractBearerToken(authHeader);

		if (!token) {
			return this.createUnauthorizedResponse('invalid_token', 'Missing or malformed Authorization header. Expected: Bearer <token>');
		}

		// Validate the token
		let validationResult: TokenValidationResult;
		try {
			validationResult = await this.authConfig.validateToken(token);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Token validation failed';
			return this.createUnauthorizedResponse('server_error', `Token validation error: ${errorMessage}`);
		}

		if (!validationResult.valid) {
			return this.createUnauthorizedResponse('invalid_token', validationResult.error || 'Token is invalid or expired');
		}

		// Token is valid
		return null;
	}

	/**
	 * Create a 401 Unauthorized response with proper WWW-Authenticate header
	 */
	private createUnauthorizedResponse(errorCode: string, errorDescription: string): Response {
		if (!this.authConfig) {
			return new Response('Unauthorized', { status: 401 });
		}

		const prmPath = this.authConfig.prmPath || '.well-known/oauth-protected-resource';
		// Properly construct PRM URL by appending to resourceUrl
		const baseUrl = this.authConfig.resourceUrl.endsWith('/') ? this.authConfig.resourceUrl : `${this.authConfig.resourceUrl}/`;
		const prmUrl = new URL(prmPath, baseUrl).toString();
		const realm = this.authConfig.realm || 'mcp';

		const wwwAuthenticate = `Bearer realm="${realm}", resource_metadata="${prmUrl}", error="${errorCode}", error_description="${errorDescription}"`;

		const body = JSON.stringify({
			error: errorCode,
			error_description: errorDescription,
		});

		return new Response(body, {
			status: 401,
			headers: {
				'Content-Type': 'application/json',
				'WWW-Authenticate': wwwAuthenticate,
			},
		});
	}

	/**
	 * Serve the Protected Resource Metadata document
	 */
	private servePrmDocument(): Response {
		if (!this.authConfig) {
			return new Response('Not found', { status: 404 });
		}

		const metadata: ProtectedResourceMetadata = {
			resource: this.authConfig.resourceUrl,
			authorization_servers: this.authConfig.authorizationServers,
			scopes_supported: this.authConfig.scopesSupported || ['mcp'],
			bearer_methods_supported: ['header'],
		};

		return new Response(JSON.stringify(metadata), {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
			},
		});
	}

	protected processSSEConnection(request: Request): Response {
		// Session ID must exist as it will be created at the worker level prior to forwarding to DO.
		const url = new URL(request.url);
		const sessionId = url.searchParams.get('sessionId');
		if (!sessionId) {
			return new Response(`Missing sessionId parameter`, {
				status: 400,
			});
		}

		const { readable, writable } = new TransformStream();

		// Create message endpoint URL that preserves both proxyId and sessionId
		const messageEndpointUrl = new URL(SSE_MESSAGE_ENDPOINT, request.url);
		// Copy all search parameters from the original request to preserve proxyId
		url.searchParams.forEach((value, key) => {
			messageEndpointUrl.searchParams.set(key, value);
		});

		const transport = new SSETransport(writable.getWriter(), sessionId, messageEndpointUrl.toString());
		this.sessions.set(sessionId, transport);
		this.server.connect(transport);

		return new Response(readable, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache, no-transform',
				Connection: 'keep-alive',
			},
		});
	}

	/**
	 * Process a WebSocket connection request
	 */
	protected processWebSocketConnection(request: Request): Response {
		// Verify the Upgrade header is present and is WebSocket
		const upgradeHeader = request.headers.get('Upgrade');
		if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
			return new Response('Expected Upgrade: websocket', {
				status: 426,
			});
		}

		// Check for 'mcp' subprotocol
		const protocols = request.headers.get('Sec-WebSocket-Protocol');
		const acceptProtocol = protocols
			?.split(',')
			.map((p) => p.trim())
			.includes(MCP_SUBPROTOCOL);
		if (!acceptProtocol) {
			return new Response('Expected Sec-WebSocket-Protocol: mcp', {
				status: 426,
			});
		}

		// If no session was set, it will be automatically generated by the worker.
		const url = new URL(request.url);
		const sessionId = url.searchParams.get('sessionId');
		if (!sessionId) {
			return new Response(`Missing sessionId parameter`, {
				status: 400,
			});
		}

		// Create WebSocket pair
		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		// Store the sessionId as an attachment that will survive hibernation
		server.serializeAttachment({ sessionId });

		// Accept WebSocket with hibernation support
		this.ctx.acceptWebSocket(server);

		// Create transport and register handlers
		const transport = new WebSocketTransport(server, sessionId);
		this.sessions.set(sessionId, transport);
		this.server.connect(transport);

		// Return the client end of the WebSocket with the MCP subprotocol
		const headers = new Headers();
		headers.set('Sec-WebSocket-Protocol', MCP_SUBPROTOCOL);

		return new Response(null, {
			status: 101,
			webSocket: client,
			headers,
		});
	}

	/**
	 * Handle WebSocket messages
	 * This is called by the Durable Object runtime when a message is received
	 */
	async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
		// Find the transport associated with this WebSocket
		const transport = this.findWebSocketTransport(ws);
		if (transport) {
			transport.handleMessage(data);
		} else {
			console.error('[MCP] websocketSendMessage:No transport found for WebSocket');
		}
	}

	/**
	 * Handle WebSocket close events
	 */
	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
		const transport = this.findWebSocketTransport(ws);
		if (transport) {
			this.sessions.delete(transport.sessionId);
			await transport.close(code, reason);
		}
	}

	/**
	 * Handle WebSocket errors
	 */
	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		const transport = this.findWebSocketTransport(ws);
		if (transport) {
			transport.onerror?.(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Find the WebSocketTransport associated with a specific WebSocket instance
	 */
	private findWebSocketTransport(ws: WebSocket): WebSocketTransport | null {
		// First try to get the sessionId from the attachment
		const attachment = ws.deserializeAttachment() as WebSocketAttachment | null;
		if (attachment?.sessionId) {
			const transport = this.sessions.get(attachment.sessionId);
			if (transport instanceof WebSocketTransport) {
				return transport;
			}
		}

		return null;
	}

	protected processMcpRequest(request: Request) {
		const contentType = request.headers.get('content-type') || '';
		if (!contentType.includes('application/json')) {
			return new Response(`Unsupported content-type: ${contentType}`, {
				status: 400,
			});
		}

		// Check if the request body is too large
		const contentLength = Number.parseInt(request.headers.get('content-length') || '0', 10);

		if (contentLength > MAXIMUM_MESSAGE_SIZE) {
			return new Response(`Request body too large: ${contentLength} bytes`, {
				status: 400,
			});
		}

		const url = new URL(request.url);
		const sessionId = url.searchParams.get('sessionId');
		if (!sessionId) {
			return new Response(`Missing sessionId parameter`, {
				status: 400,
			});
		}

		const transport = this.sessions.get(sessionId);
		if (!transport) {
			return new Response(`Session not found`, {
				status: 404,
			});
		}

		// Only SSE transports handle POST messages since WebSocket messages are handled by the webSocketMessage method
		if (transport instanceof SSETransport) {
			return transport.handlePostMessage(request);
		} else {
			return new Response(`Cannot send message to non-SSE transport`, {
				status: 400,
			});
		}
	}

	/**
	 * Main fetch handler
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// Handle PRM endpoint if auth is configured
		if (this.authConfig) {
			const prmPath = this.authConfig.prmPath || '.well-known/oauth-protected-resource';
			if (path.endsWith(prmPath)) {
				return this.servePrmDocument();
			}
		}

		// Validate authentication if configured
		const authError = await this.validateAuth(request);
		if (authError) {
			return authError;
		}

		// Process WebSocket upgrade requests
		if (path.endsWith(WEBSOCKET_ENDPOINT)) {
			return this.processWebSocketConnection(request);
		}

		// Process SSE connection requests
		if (path.endsWith('/sse')) {
			return this.processSSEConnection(request);
		}

		// Process SSE message requests
		if (path.endsWith(SSE_MESSAGE_ENDPOINT)) {
			return this.processMcpRequest(request);
		}

		// Default response for unhandled paths
		return new Response('Not found', { status: 404 });
	}
}
