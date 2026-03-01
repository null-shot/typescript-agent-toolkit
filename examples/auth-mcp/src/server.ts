/**
 * Example MCP Server with OAuth2 Authentication
 *
 * This example demonstrates how to set up an MCP server with OAuth2 bearer token
 * authentication using the @nullshot/mcp package.
 */

import { McpHonoServerDO } from '@nullshot/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Implementation } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

/**
 * Example MCP server with OAuth2 authentication
 *
 * This server demonstrates:
 * 1. Setting up OAuth2 authentication with JWT token validation
 * 2. Configuring the Protected Resource Metadata (PRM) endpoint
 * 3. Protecting MCP endpoints with bearer token authentication
 * 4. Registering tools that can check authentication context
 */
export class AuthMcpServer extends McpHonoServerDO<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		// Configure OAuth2 authentication
		// In production, you would validate tokens against your auth server
		this.setupAuth({
			// Token validation function - called for every request
			validateToken: async (token) => {
				// Example: Validate JWT using a library like jose
				// For this example, we accept any non-empty token
				// In production, verify the token with your auth server
				if (!token || token.length < 10) {
					return { valid: false, error: 'Invalid token format' };
				}

				// Example: Parse a simple JWT-like token
				// In production, use proper JWT validation with jose or jsonwebtoken
				try {
					// Simulate token validation
					// const { payload } = await jwtVerify(token, publicKey);

					return {
						valid: true,
						scopes: ['mcp', 'mcp:tools'],
						claims: {
							sub: 'user123',
							iss: 'https://auth.example.com',
						},
					};
				} catch (error) {
					return {
						valid: false,
						error: error instanceof Error ? error.message : 'Token validation failed',
					};
				}
			},

			// Resource URL - identifies this MCP server
			resourceUrl: 'https://api.example.com/mcp',

			// Authorization servers that can issue tokens for this resource
			authorizationServers: ['https://auth.example.com'],

			// Supported OAuth2 scopes
			scopesSupported: ['mcp', 'mcp:tools', 'mcp:resources', 'mcp:prompts'],

			// Paths that don't require authentication
			excludedPaths: ['/health'],

			// Custom realm for WWW-Authenticate header (optional, defaults to "mcp")
			realm: 'mcp',
		});
	}

	/**
	 * Return server implementation metadata
	 */
	getImplementation(): Implementation {
		return {
			name: 'AuthMcpServer',
			version: '1.0.0',
		};
	}

	/**
	 * Configure the MCP server with tools
	 */
	configureServer(server: McpServer): void {
		// Register an echo tool
		(server.tool as any)(
			'echo',
			'Echo back the input message (requires authentication)',
			{ message: z.string() },
			async (args: { message: string }) => {
				return {
					content: [
						{
							type: 'text',
							text: args.message,
						},
					],
				};
			}
		);

		// Register a protected tool that simulates accessing user data
		(server.tool as any)(
			'getUserInfo',
			'Get current user information (requires authentication)',
			{},
			async () => {
				// In a real implementation, you would access the auth context
				// to get the authenticated user's information
				return {
					content: [
						{
							type: 'text',
							text: 'User: user123 (authenticated)',
						},
					],
				};
			}
		);
	}
}
