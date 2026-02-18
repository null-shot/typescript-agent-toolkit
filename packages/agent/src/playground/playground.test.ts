import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { generatePlaygroundHTML } from './html';
import { setupPlaygroundRoutes } from './index';
import type { PlaygroundAgent, PlaygroundTab, PlaygroundOptions } from './types';

describe('generatePlaygroundHTML', () => {
	it('should generate valid HTML with default options', () => {
		const html = generatePlaygroundHTML();
		expect(html).toContain('<!DOCTYPE html>');
		expect(html).toContain('<html lang="en">');
		expect(html).toContain('AI Agent Playground');
		expect(html).toContain('</html>');
	});

	it('should use custom title', () => {
		const html = generatePlaygroundHTML({ title: 'My Custom Agent' });
		expect(html).toContain('<title>My Custom Agent</title>');
		expect(html).toContain('My Custom Agent');
	});

	it('should use custom colors', () => {
		const html = generatePlaygroundHTML({
			primaryColor: '#ff0000',
			secondaryColor: '#00ff00',
		});
		expect(html).toContain('#ff0000');
		expect(html).toContain('#00ff00');
	});

	it('should use default colors when not specified', () => {
		const html = generatePlaygroundHTML();
		expect(html).toContain('#00d4aa');
		expect(html).toContain('#14b8a6');
	});

	it('should include Inter font from Google Fonts CDN', () => {
		const html = generatePlaygroundHTML();
		expect(html).toContain('fonts.googleapis.com');
		expect(html).toContain('Inter');
	});

	it('should define CSS custom properties in :root', () => {
		const html = generatePlaygroundHTML();
		expect(html).toContain(':root');
		expect(html).toContain('--accent:');
		expect(html).toContain('--bg-base:');
		expect(html).toContain('--text-primary:');
	});

	it('should include agent configuration in script', () => {
		const agents: PlaygroundAgent[] = [
			{ id: 'agent1', name: 'Agent One', path: '/agent/one' },
			{ id: 'agent2', name: 'Agent Two', path: '/agent/two', description: 'Second agent' },
		];
		const html = generatePlaygroundHTML({ agents });

		expect(html).toContain('agent1');
		expect(html).toContain('Agent One');
		expect(html).toContain('/agent/one');
		expect(html).toContain('agent2');
		expect(html).toContain('Agent Two');
	});

	it('should include default agent when no agents provided', () => {
		const html = generatePlaygroundHTML();
		expect(html).toContain('default');
		expect(html).toContain('AI Agent');
		expect(html).toContain('/agent/chat');
	});

	it('should include tab bar when tabs are provided', () => {
		const tabs: PlaygroundTab[] = [{ id: 'dashboard', label: 'Dashboard', type: 'dashboard', icon: '📊', apiPath: '/api/dashboard' }];
		const html = generatePlaygroundHTML({ tabs });
		expect(html).toContain('tab-bar');
		expect(html).toContain('Dashboard');
		expect(html).toContain('data-tab');
	});

	it('should always include tab bar with Chat tab', () => {
		const html = generatePlaygroundHTML({ tabs: [] });
		expect(html).toContain('tab-bar');
		expect(html).toContain('data-tab="chat"');
		expect(html).toContain('Connecting...');
	});

	it('should include chat input and send button', () => {
		const html = generatePlaygroundHTML();
		expect(html).toContain('messageInput');
		expect(html).toContain('sendButton');
		expect(html).toContain('Type your message');
	});
});

describe('setupPlaygroundRoutes', () => {
	it('should register health endpoint', async () => {
		const app = new Hono<{ Bindings: Record<string, unknown> }>();
		setupPlaygroundRoutes(app, {
			agents: [{ id: 'test', name: 'Test', path: '/agent/test' }],
		});

		const res = await app.request('/health');
		expect(res.status).toBe(200);

		const body = (await res.json()) as Record<string, unknown>;
		expect(body.status).toBe('ok');
		expect(body.timestamp).toBeDefined();
		expect(body.agents).toBe(1);
	});

	it('should return 0 agents when none provided', async () => {
		const app = new Hono<{ Bindings: Record<string, unknown> }>();
		setupPlaygroundRoutes(app);

		const res = await app.request('/health');
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.agents).toBe(0);
	});

	it('should register agents list endpoint', async () => {
		const agents: PlaygroundAgent[] = [
			{ id: 'a1', name: 'Agent 1', path: '/agent/a1' },
			{ id: 'a2', name: 'Agent 2', path: '/agent/a2' },
		];
		const app = new Hono<{ Bindings: Record<string, unknown> }>();
		setupPlaygroundRoutes(app, { agents });

		const res = await app.request('/api/agents');
		expect(res.status).toBe(200);

		const body = (await res.json()) as { agents: Array<{ id: string }> };
		expect(body.agents).toHaveLength(2);
		expect(body.agents[0].id).toBe('a1');
		expect(body.agents[1].id).toBe('a2');
	});

	it('should serve playground HTML at root', async () => {
		const app = new Hono<{ Bindings: Record<string, unknown> }>();
		setupPlaygroundRoutes(app, { title: 'Test Playground' });

		const res = await app.request('/');
		expect(res.status).toBe(200);

		const html = await res.text();
		expect(html).toContain('<!DOCTYPE html>');
		expect(html).toContain('Test Playground');
	});

	it('should serve playground HTML at /playground', async () => {
		const app = new Hono<{ Bindings: Record<string, unknown> }>();
		setupPlaygroundRoutes(app, { title: 'Alt Path' });

		const res = await app.request('/playground');
		expect(res.status).toBe(200);

		const html = await res.text();
		expect(html).toContain('Alt Path');
	});

	it('should support custom basePath', async () => {
		const app = new Hono<{ Bindings: Record<string, unknown> }>();
		setupPlaygroundRoutes(app, { basePath: '/ui' });

		const healthRes = await app.request('/ui/health');
		expect(healthRes.status).toBe(200);

		const agentsRes = await app.request('/ui/api/agents');
		expect(agentsRes.status).toBe(200);

		const htmlRes = await app.request('/ui/');
		expect(htmlRes.status).toBe(200);
	});

	it('should not register /playground when basePath is set', async () => {
		const app = new Hono<{ Bindings: Record<string, unknown> }>();
		setupPlaygroundRoutes(app, { basePath: '/ui' });

		const res = await app.request('/playground');
		expect(res.status).toBe(404);
	});
});
