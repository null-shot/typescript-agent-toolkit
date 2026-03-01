/**
 * OAuth2 Bearer Token Authentication Middleware
 *
 * This module provides Hono middleware for validating OAuth2 bearer tokens
 * following the MCP authorization flow. When authentication fails, it returns
 * 401 Unauthorized responses with proper WWW-Authenticate headers pointing
 * to the Protected Resource Metadata (PRM) document.
 */

import type { Context, Next } from 'hono';
import type { AuthContext, AuthErrorResponse, AuthMiddlewareConfig, WwwAuthenticateParams } from './types.js';

/**
 * Build WWW-Authenticate header value per RFC 6750
 *
 * @param params - Authentication parameters
 * @returns Formatted WWW-Authenticate header value
 */
function buildWwwAuthenticateHeader(params: WwwAuthenticateParams): string {
	const parts: string[] = [params.scheme];

	if (params.realm) {
		parts.push(`realm="${params.realm}"`);
	}

	if (params.resourceMetadata) {
		parts.push(`resource_metadata="${params.resourceMetadata}"`);
	}

	if (params.scope) {
		parts.push(`scope="${params.scope}"`);
	}

	if (params.error) {
		parts.push(`error="${params.error}"`);
	}

	if (params.errorDescription) {
		parts.push(`error_description="${params.errorDescription}"`);
	}

	return parts.join(', ');
}

/**
 * Create a 401 Unauthorized response with proper headers
 *
 * @param c - Hono context
 * @param config - Auth middleware configuration
 * @param errorCode - OAuth2 error code (e.g., "invalid_token")
 * @param errorDescription - Human-readable error description
 * @returns 401 Response
 */
function createUnauthorizedResponse(c: Context, config: AuthMiddlewareConfig, errorCode?: string, errorDescription?: string): Response {
	const prmPath = config.prmPath || '.well-known/oauth-protected-resource';
	// Properly construct PRM URL by appending to resourceUrl
	const baseUrl = config.resourceUrl.endsWith('/') ? config.resourceUrl : `${config.resourceUrl}/`;
	const prmUrl = new URL(prmPath, baseUrl).toString();

	const wwwAuthenticateParams: WwwAuthenticateParams = {
		scheme: 'Bearer',
		realm: config.realm || 'mcp',
		resourceMetadata: prmUrl,
	};

	if (errorCode) {
		wwwAuthenticateParams.error = errorCode;
	}

	if (errorDescription) {
		wwwAuthenticateParams.errorDescription = errorDescription;
	}

	const body: AuthErrorResponse = {
		error: errorCode || 'invalid_token',
		error_description: errorDescription || 'Bearer token required or invalid',
	};

	return c.json(body, {
		status: 401,
		headers: {
			'WWW-Authenticate': buildWwwAuthenticateHeader(wwwAuthenticateParams),
		},
	});
}

/**
 * Check if a path should be excluded from authentication
 *
 * @param path - Request path
 * @param excludedPaths - Array of paths to exclude
 * @returns True if path should be excluded
 */
function isPathExcluded(path: string, excludedPaths?: string[]): boolean {
	if (!excludedPaths || excludedPaths.length === 0) {
		return false;
	}

	return excludedPaths.some((excluded) => {
		// Support exact matches and prefix matches
		if (excluded.endsWith('/')) {
			return path.startsWith(excluded);
		}
		return path === excluded || path.startsWith(excluded + '/');
	});
}

/**
 * Extract bearer token from Authorization header
 *
 * @param authHeader - Authorization header value
 * @returns Token string or null if not found/invalid
 */
function extractBearerToken(authHeader: string | undefined): string | null {
	if (!authHeader) {
		return null;
	}

	// Check for Bearer scheme (case-insensitive)
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
 * Create authentication middleware for Hono
 *
 * This middleware validates bearer tokens from the Authorization header.
 * When authentication fails, it returns a 401 response with a WWW-Authenticate
 * header containing the URL to the Protected Resource Metadata document.
 *
 * @param config - Authentication middleware configuration
 * @returns Hono middleware function
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { createAuthMiddleware } from '@nullshot/mcp'
 *
 * const app = new Hono()
 *
 * app.use(createAuthMiddleware({
 *   validateToken: async (token) => {
 *     // Validate JWT or opaque token
 *     return { valid: true, scopes: ['mcp'] }
 *   },
 *   resourceUrl: 'https://my-server.com/mcp',
 *   authorizationServers: ['https://auth.my-server.com'],
 *   scopesSupported: ['mcp', 'mcp:tools']
 * }))
 * ```
 */
export function createAuthMiddleware(config: AuthMiddlewareConfig) {
	return async (c: Context, next: Next) => {
		const path = c.req.path;

		// Check if path is excluded from authentication
		if (isPathExcluded(path, config.excludedPaths)) {
			// Set unauthenticated context for excluded paths
			c.set('auth', { authenticated: false } as AuthContext);
			return await next();
		}

		// Extract bearer token from Authorization header
		const authHeader = c.req.header('Authorization');
		const token = extractBearerToken(authHeader);

		if (!token) {
			// No valid bearer token provided
			return createUnauthorizedResponse(c, config, 'invalid_token', 'Missing or malformed Authorization header. Expected: Bearer <token>');
		}

		// Validate the token using the provided validator
		let validationResult;
		try {
			validationResult = await config.validateToken(token);
		} catch (error) {
			// Token validator threw an error
			const errorMessage = error instanceof Error ? error.message : 'Token validation failed';
			return createUnauthorizedResponse(c, config, 'server_error', `Token validation error: ${errorMessage}`);
		}

		if (!validationResult.valid) {
			// Token validation failed
			return createUnauthorizedResponse(c, config, 'invalid_token', validationResult.error || 'Token is invalid or expired');
		}

		// Token is valid - store auth context for downstream use
		const authContext: AuthContext = {
			authenticated: true,
			token: {
				raw: token,
				scopes: validationResult.scopes,
				claims: validationResult.claims,
			},
		};

		c.set('auth', authContext);

		// Continue to the next middleware/handler
		await next();
	};
}

/**
 * Get authentication context from Hono context
 *
 * Helper function to retrieve auth context set by the auth middleware.
 *
 * @param c - Hono context
 * @returns Auth context or undefined if not set
 *
 * @example
 * ```typescript
 * app.get('/protected', async (c) => {
 *   const auth = getAuthContext(c)
 *   if (!auth?.authenticated) {
 *     return c.json({ error: 'Unauthorized' }, 401)
 *   }
 *   return c.json({ message: 'Hello', scopes: auth.token?.scopes })
 * })
 * ```
 */
export function getAuthContext(c: Context): AuthContext | undefined {
	return c.get('auth') as AuthContext | undefined;
}
