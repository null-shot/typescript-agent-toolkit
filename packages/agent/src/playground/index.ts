/**
 * Playground Module
 * Provides a lightweight inline HTML playground UI for AI agents
 * Designed for single-worker architecture
 */

import { Hono } from 'hono'
import { generatePlaygroundHTML } from './html'
import type { PlaygroundOptions, PlaygroundAgent, PlaygroundTab } from './types'

// Re-export types
export type { PlaygroundOptions, PlaygroundAgent, PlaygroundTab }
export { generatePlaygroundHTML }

/** Internal base URL used when forwarding requests to Durable Objects */
const INTERNAL_DO_ORIGIN = 'https://internal.do'

/** Minimal Hono-like context expected by routing helpers */
interface RouteContext {
	req: { raw: Request; param: (key: string) => string | undefined }
}

/**
 * Setup playground routes on a Hono app
 * 
 * @example
 * ```typescript
 * const app = new Hono()
 * 
 * setupPlaygroundRoutes(app, {
 *   agents: [
 *     { id: 'sales', name: 'Sales Agent', path: '/agent/sales' },
 *     { id: 'support', name: 'Support Agent', path: '/agent/support' },
 *   ],
 *   title: 'My AI Agents'
 * })
 * ```
 */
export function setupPlaygroundRoutes<T extends Record<string, unknown>>(
	app: Hono<{ Bindings: T }>,
	options: PlaygroundOptions = {}
): void {
	const basePath = options.basePath || ''

	// Health check endpoint
	app.get(`${basePath}/health`, (c) => {
		return c.json({
			status: 'ok',
			timestamp: Date.now(),
			agents: options.agents?.length || 0,
		})
	})

	// Agents list endpoint (API)
	app.get(`${basePath}/api/agents`, (c) => {
		return c.json({
			agents: options.agents || [],
		})
	})

	// Main playground UI
	app.get(`${basePath}/`, (c) => {
		const html = generatePlaygroundHTML(options)
		return c.html(html)
	})

	// Also handle /playground path if basePath is empty
	if (!basePath) {
		app.get('/playground', (c) => {
			const html = generatePlaygroundHTML(options)
			return c.html(html)
		})
	}
}

/**
 * Helper to route requests to a Durable Object agent
 * 
 * @example
 * ```typescript
 * app.all('/agent/sales/*', (c) => routeToAgent(c, c.env.SALES_AGENT))
 * ```
 */
export async function routeToAgent(
	c: RouteContext,
	agentNamespace: DurableObjectNamespace,
	sessionIdParam = 'sessionId'
): Promise<Response> {
	// Extract session ID from URL or generate new one
	let sessionId = c.req.param(sessionIdParam)

	if (!sessionId) {
		// Try to extract from path
		const url = new URL(c.req.raw.url)
		const pathParts = url.pathname.split('/')
		const chatIndex = pathParts.indexOf('chat')
		if (chatIndex !== -1 && pathParts[chatIndex + 1]) {
			sessionId = pathParts[chatIndex + 1]
		}
	}

	if (!sessionId) {
		sessionId = crypto.randomUUID()
	}

	// Get or create Durable Object instance
	const id = agentNamespace.idFromName(sessionId)
	const stub = agentNamespace.get(id)

	// Forward request to Durable Object with sessionId in path
	const url = new URL(c.req.raw.url)
	const internalPath = `/agent/chat/${sessionId}`
	const internalUrl = new URL(internalPath + url.search, INTERNAL_DO_ORIGIN)

	const forwardRequest = new Request(internalUrl.toString(), {
		method: c.req.raw.method,
		headers: c.req.raw.headers,
		body: c.req.raw.body,
	})

	try {
		return await stub.fetch(forwardRequest)
	} catch (error) {
		console.error('Error routing to agent:', error)
		return new Response(
			JSON.stringify({
				error: 'Failed to reach agent',
				message: error instanceof Error ? error.message : 'Unknown error',
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			}
		)
	}
}

/**
 * Helper to route non-chat requests to a Durable Object agent endpoint
 * Unlike routeToAgent (which rewrites to /agent/chat/:sessionId), this preserves
 * the target path. Useful for forwarding /mcp, /tools, or other info endpoints.
 * Uses a fixed DO instance name since these endpoints return agent-level config.
 * 
 * @example
 * ```typescript
 * app.get('/agent/sales/mcp', (c) => routeToAgentEndpoint(c, c.env.SALES_AGENT, '/mcp'))
 * app.get('/agent/sales/tools', (c) => routeToAgentEndpoint(c, c.env.SALES_AGENT, '/tools'))
 * ```
 */
export async function routeToAgentEndpoint(
	c: Pick<RouteContext, 'req'>,
	agentNamespace: DurableObjectNamespace,
	endpointPath: string,
	instanceName = '__agent_info__'
): Promise<Response> {
	// Use a fixed instance since info endpoints return agent-level config (same for all sessions)
	const id = agentNamespace.idFromName(instanceName)
	const stub = agentNamespace.get(id)

	const internalUrl = new URL(endpointPath, INTERNAL_DO_ORIGIN)
	const forwardRequest = new Request(internalUrl.toString(), {
		method: c.req.raw.method,
		headers: c.req.raw.headers,
	})

	try {
		const response = await stub.fetch(forwardRequest)
		return response
	} catch (error) {
		console.error(`Error routing to agent endpoint ${endpointPath}:`, error)
		return new Response(
			JSON.stringify({
				error: 'Failed to reach agent endpoint',
				message: error instanceof Error ? error.message : 'Unknown error',
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			}
		)
	}
}

/**
 * Helper to route requests to a Durable Object MCP server
 * Similar to routeToAgent but for MCP servers
 * 
 * @example
 * ```typescript
 * app.all('/mcp/crud/*', (c) => routeToMcp(c, c.env.CRUD_MCP))
 * ```
 */
export async function routeToMcp(
	c: Pick<RouteContext, 'req'>,
	mcpNamespace: DurableObjectNamespace,
	sessionIdParam = 'sessionId'
): Promise<Response> {
	const url = new URL(c.req.raw.url)

	// Extract session ID from query params or generate
	let sessionId = url.searchParams.get(sessionIdParam)
	if (!sessionId) {
		sessionId = crypto.randomUUID()
	}

	// Get or create Durable Object instance
	const id = mcpNamespace.idFromName(sessionId)
	const stub = mcpNamespace.get(id)

	// Update URL with session ID
	url.searchParams.set(sessionIdParam, sessionId)

	const forwardRequest = new Request(url.toString(), {
		method: c.req.raw.method,
		headers: c.req.raw.headers,
		body: c.req.raw.body,
	})

	try {
		const response = await stub.fetch(forwardRequest)
		return response
	} catch (error) {
		console.error('Error routing to MCP:', error)
		return new Response(
			JSON.stringify({
				error: 'Failed to reach MCP server',
				message: error instanceof Error ? error.message : 'Unknown error',
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			}
		)
	}
}
