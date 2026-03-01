/**
 * Unit tests for Protected Resource Metadata (PRM) handler
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createPrmHandler, generateProtectedResourceMetadata } from './prm-handler.js';
import type { AuthMiddlewareConfig } from './types.js';

describe('generateProtectedResourceMetadata', () => {
	const createConfig = (overrides?: Partial<AuthMiddlewareConfig>): AuthMiddlewareConfig => ({
		validateToken: async () => ({ valid: true }),
		resourceUrl: 'https://example.com/mcp',
		authorizationServers: ['https://auth.example.com'],
		...overrides,
	});

	it('should generate metadata with required fields', () => {
		const config = createConfig();
		const metadata = generateProtectedResourceMetadata(config);

		expect(metadata.resource).toBe('https://example.com/mcp');
		expect(metadata.authorization_servers).toEqual(['https://auth.example.com']);
	});

	it('should include default scopes when not specified', () => {
		const config = createConfig();
		const metadata = generateProtectedResourceMetadata(config);

		expect(metadata.scopes_supported).toEqual(['mcp']);
	});

	it('should include custom scopes when specified', () => {
		const config = createConfig({
			scopesSupported: ['mcp', 'mcp:tools', 'mcp:resources'],
		});
		const metadata = generateProtectedResourceMetadata(config);

		expect(metadata.scopes_supported).toEqual(['mcp', 'mcp:tools', 'mcp:resources']);
	});

	it('should include bearer_methods_supported', () => {
		const config = createConfig();
		const metadata = generateProtectedResourceMetadata(config);

		expect(metadata.bearer_methods_supported).toEqual(['header']);
	});

	it('should handle multiple authorization servers', () => {
		const config = createConfig({
			authorizationServers: ['https://auth1.example.com', 'https://auth2.example.com'],
		});
		const metadata = generateProtectedResourceMetadata(config);

		expect(metadata.authorization_servers).toEqual(['https://auth1.example.com', 'https://auth2.example.com']);
	});
});

describe('createPrmHandler', () => {
	const createConfig = (overrides?: Partial<AuthMiddlewareConfig>): AuthMiddlewareConfig => ({
		validateToken: async () => ({ valid: true }),
		resourceUrl: 'https://example.com/mcp',
		authorizationServers: ['https://auth.example.com'],
		scopesSupported: ['mcp', 'mcp:tools'],
		...overrides,
	});

	it('should serve PRM document at configured path', async () => {
		const config = createConfig();
		const app = new Hono();
		app.get('/.well-known/oauth-protected-resource', createPrmHandler(config));

		const req = new Request('https://example.com/.well-known/oauth-protected-resource');
		const res = await app.fetch(req);

		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('application/json');
	});

	it('should return correct PRM document structure', async () => {
		const config = createConfig();
		const app = new Hono();
		app.get('/.well-known/oauth-protected-resource', createPrmHandler(config));

		const req = new Request('https://example.com/.well-known/oauth-protected-resource');
		const res = await app.fetch(req);
		const body = (await res.json()) as {
			resource: string;
			authorization_servers: string[];
			scopes_supported: string[];
			bearer_methods_supported: string[];
		};

		expect(body.resource).toBe('https://example.com/mcp');
		expect(body.authorization_servers).toEqual(['https://auth.example.com']);
		expect(body.scopes_supported).toEqual(['mcp', 'mcp:tools']);
		expect(body.bearer_methods_supported).toEqual(['header']);
	});

	it('should serve at custom PRM path when configured', async () => {
		const config = createConfig({
			prmPath: '.well-known/custom-prm',
		});
		const app = new Hono();
		app.get('/.well-known/custom-prm', createPrmHandler(config));

		const req = new Request('https://example.com/.well-known/custom-prm');
		const res = await app.fetch(req);

		expect(res.status).toBe(200);
	});
});
