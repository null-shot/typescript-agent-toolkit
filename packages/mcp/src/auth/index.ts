/**
 * OAuth2 Authentication Setup
 *
 * This module provides a convenient helper function to set up OAuth2 bearer token
 * authentication for MCP servers. It combines the auth middleware and PRM endpoint
 * into a single setup function.
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { setupAuth } from '@nullshot/mcp'
 *
 * const app = new Hono()
 *
 * setupAuth(app, {
 *   validateToken: async (token) => {
 *     // Validate your JWT or opaque token here
 *     return { valid: true, scopes: ['mcp'] }
 *   },
 *   resourceUrl: 'https://my-server.com/mcp',
 *   authorizationServers: ['https://auth.my-server.com'],
 *   scopesSupported: ['mcp', 'mcp:tools', 'mcp:resources'],
 *   excludedPaths: ['/health']
 * })
 * ```
 */

import type { Hono } from 'hono';
import type { AuthMiddlewareConfig } from './types.js';
import { createAuthMiddleware } from './middleware.js';
import { createPrmHandler } from './prm-handler.js';

/**
 * Set up OAuth2 authentication for a Hono application
 *
 * This function configures both the Protected Resource Metadata endpoint
 * and the authentication middleware. The PRM endpoint is publicly accessible,
 * while all other routes require valid bearer token authentication.
 *
 * @param app - Hono application instance
 * @param config - Authentication middleware configuration
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { setupAuth } from '@nullshot/mcp'
 *
 * const app = new Hono()
 *
 * // Setup OAuth2 authentication
 * setupAuth(app, {
 *   validateToken: async (token) => {
 *     // Example: Validate JWT using a library like jose
 *     try {
 *       const { payload } = await jwtVerify(token, publicKey)
 *       return {
 *         valid: true,
 *         scopes: payload.scope?.split(' ') || ['mcp'],
 *         claims: payload
 *       }
 *     } catch (error) {
 *       return { valid: false, error: 'Invalid token' }
 *     }
 *   },
 *   resourceUrl: 'https://api.example.com/mcp',
 *   authorizationServers: ['https://auth.example.com'],
 *   scopesSupported: ['mcp', 'mcp:tools', 'mcp:resources', 'mcp:prompts'],
 *   excludedPaths: ['/health', '/.well-known/oauth-protected-resource']
 * })
 *
 * // Protected routes
 * app.get('/tools', async (c) => {
 *   const auth = c.get('auth')
 *   return c.json({ message: 'Access granted', scopes: auth.token?.scopes })
 * })
 * ```
 */
export function setupAuth(app: Hono, config: AuthMiddlewareConfig) {
	const prmPath = config.prmPath || '.well-known/oauth-protected-resource';

	// Register PRM endpoint (no authentication required)
	// This must be registered before the auth middleware
	app.get(prmPath, createPrmHandler(config));

	// Apply authentication middleware to all routes
	// Note: Excluded paths are handled within the middleware
	app.use('*', createAuthMiddleware(config));
}

// Re-export types and functions for convenience
export type {
	AuthContext,
	AuthErrorResponse,
	AuthMiddlewareConfig,
	ProtectedResourceMetadata,
	TokenValidationResult,
	TokenValidator,
	WwwAuthenticateParams,
} from './types.js';

export { createAuthMiddleware, getAuthContext } from './middleware.js';
export { createPrmHandler, generateProtectedResourceMetadata } from './prm-handler.js';
