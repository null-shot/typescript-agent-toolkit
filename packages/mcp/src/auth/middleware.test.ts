/**
 * Unit tests for OAuth2 authentication middleware
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createAuthMiddleware, getAuthContext } from './middleware.js';
import type { AuthMiddlewareConfig } from './types.js';

describe('createAuthMiddleware', () => {
	const createConfig = (overrides?: Partial<AuthMiddlewareConfig>): AuthMiddlewareConfig => ({
		validateToken: vi.fn().mockResolvedValue({ valid: true, scopes: ['mcp'] }),
		resourceUrl: 'https://example.com/mcp',
		authorizationServers: ['https://auth.example.com'],
		...overrides,
	});

	describe('valid authentication', () => {
		it('should allow request with valid bearer token', async () => {
			const config = createConfig();
			const app = new Hono();
			app.use(createAuthMiddleware(config));
			app.get('/test', (c) => c.json({ success: true }));

			const req = new Request('https://example.com/test', {
				headers: { Authorization: 'Bearer valid-token' },
			});

			const res = await app.fetch(req);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ success: true });
		});

		it('should set auth context for valid token', async () => {
			const config = createConfig({
				validateToken: vi.fn().mockResolvedValue({
					valid: true,
					scopes: ['mcp', 'mcp:tools'],
					claims: { sub: 'user123', iss: 'auth.example.com' },
				}),
			});
			const app = new Hono();
			app.use(createAuthMiddleware(config));
			app.get('/test', (c) => {
				const auth = getAuthContext(c);
				return c.json({
					authenticated: auth?.authenticated,
					scopes: auth?.token?.scopes,
					sub: auth?.token?.claims?.sub,
				});
			});

			const req = new Request('https://example.com/test', {
				headers: { Authorization: 'Bearer valid-token' },
			});

			const res = await app.fetch(req);
			const body = (await res.json()) as {
				authenticated: boolean;
				scopes: string[];
				sub: string;
			};
			expect(body.authenticated).toBe(true);
			expect(body.scopes).toEqual(['mcp', 'mcp:tools']);
			expect(body.sub).toBe('user123');
		});
	});

	describe('missing authentication', () => {
		it('should return 401 when Authorization header is missing', async () => {
			const config = createConfig();
			const app = new Hono();
			app.use(createAuthMiddleware(config));
			app.get('/test', (c) => c.json({ success: true }));

			const req = new Request('https://example.com/test');
			const res = await app.fetch(req);

			expect(res.status).toBe(401);
			const body = (await res.json()) as { error: string; error_description?: string };
			expect(body.error).toBe('invalid_token');
		});

		it('should return 401 for non-Bearer authorization scheme', async () => {
			const config = createConfig();
			const app = new Hono();
			app.use(createAuthMiddleware(config));
			app.get('/test', (c) => c.json({ success: true }));

			const req = new Request('https://example.com/test', {
				headers: { Authorization: 'Basic dXNlcjpwYXNz' },
			});

			const res = await app.fetch(req);
			expect(res.status).toBe(401);
		});

		it('should include WWW-Authenticate header with PRM URL', async () => {
			const config = createConfig();
			const app = new Hono();
			app.use(createAuthMiddleware(config));
			app.get('/test', (c) => c.json({ success: true }));

			const req = new Request('https://example.com/test');
			const res = await app.fetch(req);

			const wwwAuth = res.headers.get('WWW-Authenticate');
			expect(wwwAuth).toContain('Bearer');
			expect(wwwAuth).toContain('realm="mcp"');
			expect(wwwAuth).toContain('resource_metadata="https://example.com/mcp/.well-known/oauth-protected-resource"');
			expect(wwwAuth).toContain('error="invalid_token"');
		});

		it('should use custom realm when configured', async () => {
			const config = createConfig({ realm: 'custom-realm' });
			const app = new Hono();
			app.use(createAuthMiddleware(config));
			app.get('/test', (c) => c.json({ success: true }));

			const req = new Request('https://example.com/test');
			const res = await app.fetch(req);

			const wwwAuth = res.headers.get('WWW-Authenticate');
			expect(wwwAuth).toContain('realm="custom-realm"');
		});
	});

	describe('invalid token', () => {
		it('should return 401 when token validation fails', async () => {
			const config = createConfig({
				validateToken: vi.fn().mockResolvedValue({
					valid: false,
					error: 'Token expired',
				}),
			});
			const app = new Hono();
			app.use(createAuthMiddleware(config));
			app.get('/test', (c) => c.json({ success: true }));

			const req = new Request('https://example.com/test', {
				headers: { Authorization: 'Bearer invalid-token' },
			});

			const res = await app.fetch(req);
			expect(res.status).toBe(401);
			const body = (await res.json()) as { error: string; error_description?: string };
			expect(body.error).toBe('invalid_token');
			expect(body.error_description).toBe('Token expired');
		});

		it('should include error in WWW-Authenticate header', async () => {
			const config = createConfig({
				validateToken: vi.fn().mockResolvedValue({
					valid: false,
					error: 'Token revoked',
				}),
			});
			const app = new Hono();
			app.use(createAuthMiddleware(config));
			app.get('/test', (c) => c.json({ success: true }));

			const req = new Request('https://example.com/test', {
				headers: { Authorization: 'Bearer revoked-token' },
			});

			const res = await app.fetch(req);
			const wwwAuth = res.headers.get('WWW-Authenticate');
			expect(wwwAuth).toContain('error="invalid_token"');
			expect(wwwAuth).toContain('error_description="Token revoked"');
		});
	});

	describe('token validation errors', () => {
		it('should return 401 when token validator throws error', async () => {
			const config = createConfig({
				validateToken: vi.fn().mockRejectedValue(new Error('Validation service unavailable')),
			});
			const app = new Hono();
			app.use(createAuthMiddleware(config));
			app.get('/test', (c) => c.json({ success: true }));

			const req = new Request('https://example.com/test', {
				headers: { Authorization: 'Bearer some-token' },
			});

			const res = await app.fetch(req);
			expect(res.status).toBe(401);
			const body = (await res.json()) as { error: string; error_description?: string };
			expect(body.error).toBe('server_error');
			expect(body.error_description).toContain('Validation service unavailable');
		});
	});

	describe('excluded paths', () => {
		it('should skip auth for excluded exact paths', async () => {
			const config = createConfig({
				excludedPaths: ['/health', '/public'],
			});
			const app = new Hono();
			app.use(createAuthMiddleware(config));
			app.get('/health', (c) => c.json({ status: 'ok' }));
			app.get('/test', (c) => c.json({ success: true }));

			const healthReq = new Request('https://example.com/health');
			const healthRes = await app.fetch(healthReq);
			expect(healthRes.status).toBe(200);

			const testReq = new Request('https://example.com/test');
			const testRes = await app.fetch(testReq);
			expect(testRes.status).toBe(401);
		});

		it('should skip auth for excluded path prefixes', async () => {
			const config = createConfig({
				excludedPaths: ['/public/'],
			});
			const app = new Hono();
			app.use(createAuthMiddleware(config));
			app.get('/public/info', (c) => c.json({ info: 'public' }));
			app.get('/test', (c) => c.json({ success: true }));

			const publicReq = new Request('https://example.com/public/info');
			const publicRes = await app.fetch(publicReq);
			expect(publicRes.status).toBe(200);

			const testReq = new Request('https://example.com/test');
			const testRes = await app.fetch(testReq);
			expect(testRes.status).toBe(401);
		});

		it('should set unauthenticated context for excluded paths', async () => {
			const config = createConfig({
				excludedPaths: ['/health'],
			});
			const app = new Hono();
			app.use(createAuthMiddleware(config));
			app.get('/health', (c) => {
				const auth = getAuthContext(c);
				return c.json({ authenticated: auth?.authenticated });
			});

			const req = new Request('https://example.com/health');
			const res = await app.fetch(req);
			const body = (await res.json()) as { authenticated: boolean };
			expect(body.authenticated).toBe(false);
		});
	});

	describe('token extraction', () => {
		it('should handle Bearer with extra spaces', async () => {
			const validateToken = vi.fn().mockResolvedValue({ valid: true, scopes: ['mcp'] });
			const config = createConfig({ validateToken });
			const app = new Hono();
			app.use(createAuthMiddleware(config));
			app.get('/test', (c) => c.json({ success: true }));

			const req = new Request('https://example.com/test', {
				headers: { Authorization: 'Bearer   token-with-spaces   ' },
			});

			await app.fetch(req);
			expect(validateToken).toHaveBeenCalledWith('token-with-spaces');
		});

		it('should handle lowercase bearer scheme', async () => {
			const validateToken = vi.fn().mockResolvedValue({ valid: true, scopes: ['mcp'] });
			const config = createConfig({ validateToken });
			const app = new Hono();
			app.use(createAuthMiddleware(config));
			app.get('/test', (c) => c.json({ success: true }));

			const req = new Request('https://example.com/test', {
				headers: { Authorization: 'bearer lowercase-token' },
			});

			await app.fetch(req);
			expect(validateToken).toHaveBeenCalledWith('lowercase-token');
		});

		it('should reject empty bearer token', async () => {
			const config = createConfig();
			const app = new Hono();
			app.use(createAuthMiddleware(config));
			app.get('/test', (c) => c.json({ success: true }));

			const req = new Request('https://example.com/test', {
				headers: { Authorization: 'Bearer ' },
			});

			const res = await app.fetch(req);
			expect(res.status).toBe(401);
		});
	});

	describe('custom PRM path', () => {
		it('should use custom PRM path in WWW-Authenticate header', async () => {
			const config = createConfig({
				prmPath: '.well-known/custom-prm',
			});
			const app = new Hono();
			app.use(createAuthMiddleware(config));
			app.get('/test', (c) => c.json({ success: true }));

			const req = new Request('https://example.com/test');
			const res = await app.fetch(req);

			const wwwAuth = res.headers.get('WWW-Authenticate');
			expect(wwwAuth).toContain('resource_metadata="https://example.com/mcp/.well-known/custom-prm"');
		});
	});
});
