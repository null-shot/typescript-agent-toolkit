/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { AgentEnv } from './env';
import { Service, isExternalService } from './service';

/**
 * The Null Shot Standard for Agents.
 */
export abstract class NullShotAgent<ENV extends AgentEnv, MESSAGE extends any = any> implements DurableObject {
	protected state: DurableObjectState;
	protected env: ENV;
	protected app: Hono<{ Bindings: ENV }>;
	protected services: Service[];

	constructor(state: DurableObjectState, env: ENV, services: Service[] = []) {
		this.state = state;
		this.env = env;
		this.app = new Hono<{ Bindings: ENV }>();
		this.services = services;
		this.setupRoutes(this.app);

		state.blockConcurrencyWhile(async () => {
			try {
				await this.initializeServices();
			} catch (error) {
				console.error('Error initializing services:', error instanceof Error ? error.message : error);
				throw error;
			}
		});
	}

	abstract processMessage(sessionId: string, messages: MESSAGE): Promise<Response>;

	/**
	 * Setup services for the agent
	 * This can be overridden by subclasses to add custom services
	 */
	protected async initializeServices(): Promise<void> {
		for (const service of this.services) {
			if (service.initialize) {
				await service.initialize();
			}
			if (isExternalService(service)) {
				service.registerRoutes(this.app);
			}
		}

		try {
			this.app.get('/mcp', (c) => c.json({ mcpServers: [] }, 200));
			this.app.get('/tools', (c) => c.json({ tools: [] }, 200));
		} catch (error) {
			if (error instanceof Error && error.message.includes('matcher is already built')) {
				// Routes already registered by a service, safe to ignore
			} else {
				throw error;
			}
		}
	}

	/**
	 * Setup Hono routes
	 */
	protected setupRoutes(app: Hono<{ Bindings: ENV }>) {
		app.post('/agent/chat/:sessionId', async (c) => {
			try {
				const sessionId = c.req.param('sessionId');
				if (!sessionId) {
					throw new HTTPException(400, { message: 'Session ID is required' });
				}

				const messages = await c.req.json<MESSAGE>();
				if (!messages) {
					throw new HTTPException(400, { message: 'Payload must be a valid message JSON' });
				}

				const response = await this.processMessage(sessionId, messages);
				response.headers.set('X-Session-Id', sessionId);
				return response;
			} catch (error) {
				if (error instanceof HTTPException) throw error;
				if (error instanceof SyntaxError) {
					throw new HTTPException(400, { message: 'Invalid JSON in request body' });
				}
				console.error('Error in agent chat:', error instanceof Error ? error.message : error);
				throw new HTTPException(500, {
					message: error instanceof Error ? error.message : 'Internal server error',
				});
			}
		});

		// Default 404 route
		app.notFound(() => {
			return new Response('Not found', { status: 404 });
		});
	}

	/**
	 * Main fetch handler for the Agent Durable Object
	 */
	async fetch(request: Request): Promise<Response> {
		return this.app.fetch(request);
	}
}
