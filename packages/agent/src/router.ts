import { Hono } from 'hono';
import { AgentEnv } from './env';
import { cors } from 'hono/cors';

/*
    This router is used to handle permissionless sessions where anyone can access the chat by knowing the unique session id
    If no sessionId is provided, a new one will be generated
*/
export function applyPermissionlessAgentSessionRouter<T extends AgentEnv>(app: Hono<{ Bindings: T }>) {
	// Add CORS middleware
	app.use(
		'*',
		cors({
			origin: '*', // Allow any origin for development; restrict this in production
			allowMethods: ['POST', 'GET', 'OPTIONS'],
			allowHeaders: ['Content-Type'],
			exposeHeaders: ['X-Session-Id'],
			maxAge: 86400, // 24 hours
		}),
	);

	// Route agent info endpoints (MCP servers, tools) to the Durable Object
	// These don't require a session - use a fixed instance name for config queries
	app.get('/agent/mcp', async (c) => {
		const { AGENT } = c.env;
		const id = AGENT.idFromName('__agent_info__');
		const stub = AGENT.get(id);
		const forwardRequest = new Request('https://internal.com/mcp', {
			method: 'GET',
			headers: c.req.raw.headers,
		});
		try {
			return await stub.fetch(forwardRequest);
		} catch (error) {
			console.error('Error fetching MCP info:', error);
			return c.json({ mcpServers: [] }, 200);
		}
	});

	app.get('/agent/tools', async (c) => {
		const { AGENT } = c.env;
		const id = AGENT.idFromName('__agent_info__');
		const stub = AGENT.get(id);
		const forwardRequest = new Request('https://internal.com/tools', {
			method: 'GET',
			headers: c.req.raw.headers,
		});
		try {
			return await stub.fetch(forwardRequest);
		} catch (error) {
			console.error('Error fetching tools info:', error);
			return c.json({ tools: [] }, 200);
		}
	});

	// Route all requests to the durable object instance based on session
	app.all('/agent/chat/:sessionId?', async (c) => {
		const { AGENT } = c.env;
		let sessionIdStr = c.req.param('sessionId');

		if (!sessionIdStr || sessionIdStr === '') {
			sessionIdStr = crypto.randomUUID();
		}

		const id = AGENT.idFromName(sessionIdStr);

		const forwardRequest = new Request('https://internal.com/agent/chat/' + sessionIdStr, {
			method: c.req.method,
			body: c.req.raw.body,
			headers: c.req.raw.headers,
		});

		// Add timeout to prevent hanging (Cloudflare limit is 60s)
		const controller = new AbortController();
		const timeoutId = setTimeout(() => {
			controller.abort();
		}, 55000);

		try {
			const durableObjectStub = AGENT.get(id);
			const response = await durableObjectStub.fetch(forwardRequest, {
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				console.error('Durable Object returned non-OK status:', response.status);
			}

			return response;
		} catch (error) {
			clearTimeout(timeoutId);
			console.error('Error forwarding to Durable Object:', error);

			return new Response(
				JSON.stringify({
					error: 'Failed to process request',
					message: error instanceof Error ? error.message : 'Unknown error',
					code: 'DURABLE_OBJECT_ERROR',
				}),
				{
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				},
			);
		}
	});

	return app;
}
