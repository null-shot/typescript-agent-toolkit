/**
 * Protected Resource Metadata (PRM) Handler
 *
 * This module provides a handler for serving the OAuth 2.0 Protected Resource
 * Metadata document as defined in RFC 9728. The PRM document describes the
 * protected resource (MCP server) and how clients can obtain authorization.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc9728
 */

import type { Context } from 'hono';
import type { AuthMiddlewareConfig, ProtectedResourceMetadata } from './types.js';

/**
 * Generate Protected Resource Metadata document from configuration
 *
 * @param config - Auth middleware configuration
 * @returns PRM document following RFC 9728
 */
export function generateProtectedResourceMetadata(config: AuthMiddlewareConfig): ProtectedResourceMetadata {
	return {
		resource: config.resourceUrl,
		authorization_servers: config.authorizationServers,
		scopes_supported: config.scopesSupported || ['mcp'],
		bearer_methods_supported: ['header'],
	};
}

/**
 * Create a handler for the Protected Resource Metadata endpoint
 *
 * This handler serves the PRM document at the well-known endpoint
 * `.well-known/oauth-protected-resource` (or a custom path). The PRM document
 * is publicly accessible without authentication, as it's needed by clients
 * to discover how to authenticate.
 *
 * @param config - Auth middleware configuration
 * @returns Hono handler function
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { createPrmHandler } from '@nullshot/mcp'
 *
 * const app = new Hono()
 *
 * // Serve PRM document at the standard location
 * app.get('/.well-known/oauth-protected-resource', createPrmHandler({
 *   resourceUrl: 'https://my-server.com/mcp',
 *   authorizationServers: ['https://auth.my-server.com'],
 *   scopesSupported: ['mcp', 'mcp:tools', 'mcp:resources']
 * }))
 * ```
 */
export function createPrmHandler(config: AuthMiddlewareConfig) {
	return (c: Context) => {
		const metadata = generateProtectedResourceMetadata(config);
		return c.json(metadata);
	};
}
