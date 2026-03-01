/**
 * Worker entry point for AuthMcpServer
 *
 * This worker handles incoming requests and forwards them to the
 * AuthMcpServer Durable Object with OAuth2 authentication enabled.
 */

import { AuthMcpServer } from './server';

// Export the AuthMcpServer class for Durable Object binding
export { AuthMcpServer };

// Worker entrypoint for handling incoming requests
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const sessionIdStr = url.searchParams.get('sessionId');
		const id = sessionIdStr
			? env.AUTH_MCP_SERVER.idFromString(sessionIdStr)
			: env.AUTH_MCP_SERVER.newUniqueId();

		console.log(`Fetching sessionId: ${sessionIdStr} with id: ${id}`);

		url.searchParams.set('sessionId', id.toString());

		return env.AUTH_MCP_SERVER.get(id).fetch(
			new Request(url.toString(), request)
		);
	},
};
