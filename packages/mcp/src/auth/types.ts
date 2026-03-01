/**
 * OAuth2 Authentication Types for MCP Server
 *
 * This module provides TypeScript types and interfaces for implementing
 * OAuth2 bearer token authentication following the MCP authorization flow
 * and RFC 9728 (OAuth 2.0 Protected Resource Metadata).
 */

/**
 * Result of token validation
 */
export interface TokenValidationResult {
	/** Whether the token is valid */
	valid: boolean
	/** Scopes granted to this token (if any) */
	scopes?: string[]
	/** Error message if validation failed */
	error?: string
	/** Additional claims from the token (e.g., sub, iss, aud) */
	claims?: Record<string, unknown>
}

/**
 * Function type for validating bearer tokens
 *
 * @param token - The bearer token extracted from the Authorization header
 * @returns Promise resolving to validation result
 */
export type TokenValidator = (token: string) => Promise<TokenValidationResult>

/**
 * Protected Resource Metadata (PRM) document
 * Following RFC 9728: https://datatracker.ietf.org/doc/html/rfc9728
 *
 * This document describes the protected resource and how to access it,
 * including authorization server information and supported scopes.
 */
export interface ProtectedResourceMetadata {
	/** The resource identifier (URL of the MCP server) */
	resource: string

	/** Array of authorization server URLs that can issue tokens for this resource */
	authorization_servers: string[]

	/** Scopes supported by this resource (e.g., ["mcp:tools", "mcp:resources"]) */
	scopes_supported?: string[]

	/** Bearer token presentation methods supported (typically ["header"]) */
	bearer_methods_supported?: string[]

	/** JWS signing algorithms supported for resource JWTs */
	resource_signing_alg_values_supported?: string[]

	/** Additional metadata as defined by RFC 9728 */
	[ key: string ]: unknown
}

/**
 * Configuration options for the auth middleware
 */
export interface AuthMiddlewareConfig {
	/**
	 * Required: Function to validate bearer tokens.
	 * This function is called for every request that requires authentication.
	 */
	validateToken: TokenValidator

	/**
	 * Required: Base URL for the MCP server.
	 * Used as the resource identifier in the PRM document.
	 * Example: "https://your-server.com/mcp"
	 */
	resourceUrl: string

	/**
	 * Required: List of authorization server URLs.
	 * Clients will use these to discover token endpoints.
	 * Example: ["https://auth.your-server.com"]
	 */
	authorizationServers: string[]

	/**
	 * Optional: Supported OAuth2 scopes.
	 * Defaults to ["mcp"] if not specified.
	 */
	scopesSupported?: string[]

	/**
	 * Optional: URL paths to exclude from authentication.
	 * Useful for health checks, public endpoints, etc.
	 * Example: ["/health", "/.well-known/oauth-protected-resource"]
	 */
	excludedPaths?: string[]

	/**
	 * Optional: Custom path for the Protected Resource Metadata endpoint.
	 * Defaults to ".well-known/oauth-protected-resource" per RFC 9728.
	 */
	prmPath?: string

	/**
	 * Optional: Realm value for WWW-Authenticate header.
	 * Defaults to "mcp".
	 */
	realm?: string
}

/**
 * Auth context stored in Hono context for downstream use
 */
export interface AuthContext {
	/** Whether the request is authenticated */
	authenticated: boolean
	/** Validated token information */
	token?: {
		/** The raw token string */
		raw: string
		/** Scopes granted to the token */
		scopes?: string[]
		/** Token claims */
		claims?: Record<string, unknown>
	}
}

/**
 * Error response body for 401 Unauthorized responses
 */
export interface AuthErrorResponse {
	/** Error code (e.g., "invalid_token", "insufficient_scope") */
	error: string
	/** Human-readable error description */
	error_description?: string
	/** URI for error documentation */
	error_uri?: string
}

/**
 * WWW-Authenticate header parameters
 */
export interface WwwAuthenticateParams {
	/** Authentication scheme (e.g., "Bearer") */
	scheme: string
	/** Protection realm */
	realm?: string
	/** URL to Protected Resource Metadata document */
	resourceMetadata?: string
	/** Required scopes for this resource */
	scope?: string
	/** Error code if authentication failed */
	error?: string
	/** Error description */
	errorDescription?: string
}
