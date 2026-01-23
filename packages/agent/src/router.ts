import { Hono } from 'hono';
import { AgentEnv } from './env';
import { cors } from 'hono/cors';

/*
    This router is used to handle permissionless sessions where anyone can access the chat by knowing the unique session id
    If no sessionId is provided, a new one will be generated
*/
export function applyPermissionlessAgentSessionRouter<T extends AgentEnv>(app: Hono<{ Bindings: T }>) {
	console.log('Setting up permissionless agent session router');
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

	// Route all requests to the durable object instance based on session
	app.all('/agent/chat/:sessionId?', async (c) => {
		console.log('🌐 Router: Request received');
		console.log('🌐 Router: URL:', c.req.url);
		console.log('🌐 Router: Method:', c.req.method);
		console.log('🌐 Router: Path:', c.req.path);
		
		const { AGENT } = c.env;
		var sessionIdStr = c.req.param('sessionId');
		
		console.log('🌐 Router: Session ID param:', sessionIdStr);

		if (!sessionIdStr || sessionIdStr == '') {
			sessionIdStr = crypto.randomUUID();
		}

		const id = AGENT.idFromName(sessionIdStr);

		console.log(`Fetching durable object instance: ${sessionIdStr} to do id: ${id}`);

		const forwardRequest = new Request('https://internal.com/agent/chat/' + sessionIdStr, {
			method: c.req.method,
			body: c.req.raw.body,
			headers: c.req.raw.headers,
		});

		try {
			console.log('🔄 Router: About to call Durable Object fetch');
			console.log('🔄 Router: Durable Object ID:', id.toString());
			console.log('🔄 Router: Forward request URL:', forwardRequest.url);
			console.log('🔄 Router: Forward request method:', forwardRequest.method);
			console.log('🔄 Router: Request headers:', Object.fromEntries(forwardRequest.headers.entries()));
			
			// Forward to Durable Object and get response
			// Add timeout to prevent hanging
			const controller = new AbortController();
			const timeoutId = setTimeout(() => {
				console.error('❌ Router: Timeout waiting for Durable Object response (55s)');
				controller.abort();
			}, 55000); // 55 seconds (Cloudflare limit is 60s)
			
			console.log('🔄 Router: Calling AGENT.get(id).fetch()...');
			// Durable Objects automatically have access to the same env as the Worker
			// But we need to ensure the request is properly formatted
			const durableObjectStub = AGENT.get(id);
			console.log('🔄 Router: Got Durable Object stub');
			
			const fetchStartTime = Date.now();
			const response = await durableObjectStub.fetch(forwardRequest, {
				signal: controller.signal,
			}).catch((error: unknown) => {
				const fetchDuration = Date.now() - fetchStartTime;
				console.error('❌ Router: Error calling Durable Object fetch:', error);
				console.error('❌ Router: Fetch duration:', fetchDuration, 'ms');
				if (error instanceof Error) {
					console.error('❌ Router: Error name:', error.name);
					console.error('❌ Router: Error message:', error.message);
					console.error('❌ Router: Error stack:', error.stack);
					if (error.name === 'AbortError') {
						console.error('❌ Router: Request was aborted (timeout)');
					}
				}
				throw error;
			});
			
			const fetchDuration = Date.now() - fetchStartTime;
			console.log('🔄 Router: Got response from Durable Object, status:', response.status, `(${fetchDuration}ms)`);
			console.log('🔄 Router: Response headers:', Object.fromEntries(response.headers.entries()));
			console.log('🔄 Router: Response ok:', response.ok);
			
			// Check if response is actually OK
			if (!response.ok && response.status !== 200) {
				console.error('❌ Router: Durable Object returned non-200 status:', response.status);
				const responseText = await response.text().catch(() => '');
				console.error('❌ Router: Response body:', responseText.substring(0, 200));
			} else {
				// Log first few bytes of response body for debugging
				const responseClone = response.clone();
				const responseText = await responseClone.text().catch(() => '');
				console.log('🔄 Router: Response body preview:', responseText.substring(0, 100));
			}
			
			clearTimeout(timeoutId);
			console.log('🔄 Router: Returning response to client');
			return response;
		} catch (error) {
			console.error('Error forwarding to Durable Object:', error);
			if (error instanceof Error) {
				console.error('Error message:', error.message);
				console.error('Error name:', error.name);
				console.error('Error stack:', error.stack);
			}
			// Return proper error response instead of letting it fail
				return new Response(
				JSON.stringify({ 
					error: 'Failed to process request', 
					message: error instanceof Error ? error.message : 'Unknown error',
					code: 'DURABLE_OBJECT_ERROR'
				}),
				{ 
					status: 500,
					headers: { 'Content-Type': 'application/json' }
				}
			);
		}
	});

	return app;
}
