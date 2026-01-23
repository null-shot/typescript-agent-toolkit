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
		console.log('🏗️ Durable Object constructor called');
		console.log('🏗️ Services count:', services.length);
		this.state = state;
		this.env = env;
		this.app = new Hono<{ Bindings: ENV }>();
		this.services = services;
		console.log('🏗️ Setting up routes...');
		// Setup routes
		this.setupRoutes(this.app);
		console.log('🏗️ Routes setup complete');

		// Since this is ran async, implementing classes below should be initialized prior to this running
		console.log('🏗️ Starting service initialization...');
		state.blockConcurrencyWhile(async () => {
			try {
				console.log('🏗️ Inside blockConcurrencyWhile, initializing services...');
				// Initialize services before setting up routes
				await this.initializeServices();
				console.log('🏗️ Services initialized successfully');
			} catch (error) {
				console.error('❌ Error initializing services:', error);
				if (error instanceof Error) {
					console.error('❌ Error message:', error.message);
					console.error('❌ Error stack:', error.stack);
				}
				throw error;
			}
		});
		console.log('🏗️ Constructor complete');
	}

	abstract processMessage(sessionId: string, messages: MESSAGE): Promise<Response>;

	/**
	 * Setup services for the agent
	 * This can be overridden by subclasses to add custom services
	 */
	protected async initializeServices(): Promise<void> {
		// Initialize all services
		for (const service of this.services) {
			console.log('Initializing service', service);
			if (service.initialize) {
				await service.initialize();
			}

			// Register routes for external services
			if (isExternalService(service)) {
				service.registerRoutes(this.app);
			}
		}
	}

	/**
	 * Setup Hono routes
	 */
	protected setupRoutes(app: Hono<{ Bindings: ENV }>) {
		// Message processing route with sessionId as URL parameter
		app.post('/agent/chat/:sessionId', async (c) => {
			try {
				console.log('📨 Received request in Durable Object');
				// Get sessionId from URL params or generate a new one
				const sessionId = c.req.param('sessionId');
				console.log('📋 Session ID:', sessionId);

				if (!sessionId) {
					console.error('❌ Session ID is missing');
					throw new HTTPException(400, {
						message: 'Session ID is required',
					});
				}

				// Get the payload from the request
				console.log('📦 Parsing request body...');
				const messages = await c.req.json<MESSAGE>();
				console.log('✅ Request body parsed, messages count:', (messages as any)?.messages?.length || 0);

				if (!messages) {
					console.error('❌ Messages payload is empty');
					throw new HTTPException(400, {
						message: 'Payload must be a valid CoreMessage[] JSON Object CoreMessage[]',
					});
				}

				console.log('🔄 Calling processMessage...');
				const response = await this.processMessage(sessionId, messages);
				console.log('✅ processMessage completed, status:', response.status);

				response.headers.set('X-Session-Id', sessionId);

				return response;
			} catch (error) {
				console.error('❌ Error processing message in Durable Object:', error);
				if (error instanceof Error) {
					console.error('❌ Error message:', error.message);
					console.error('❌ Error name:', error.name);
					console.error('❌ Error stack:', error.stack);
				}
				if (error instanceof HTTPException) {
					console.error('❌ HTTPException status:', error.status);
					console.error('❌ HTTPException message:', error.message);
					throw error;
				}

				// Handle JSON parsing errors specifically
				if (error instanceof SyntaxError) {
					console.error('❌ JSON parsing error');
					throw new HTTPException(400, {
						message: 'Invalid JSON in request body',
					});
				}
				// Handle other errors
				console.error('❌ Unknown error, returning 500');
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
		console.log('🔵 Durable Object fetch called');
		console.log('🔵 Request URL:', request.url);
		console.log('🔵 Request method:', request.method);
		console.log('🔵 Request headers:', Object.fromEntries(request.headers.entries()));
		
		try {
			const response = await this.app.fetch(request);
			console.log('🔵 Hono app returned response, status:', response.status);
			return response;
		} catch (error) {
			console.error('❌ Error in Durable Object fetch:', error);
			if (error instanceof Error) {
				console.error('❌ Error message:', error.message);
				console.error('❌ Error stack:', error.stack);
			}
			throw error;
		}
	}
}
