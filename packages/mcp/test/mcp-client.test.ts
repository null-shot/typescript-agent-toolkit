import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { WorkerStreamableHTTPClientTransport } from '../../test-utils/src/mcp/WorkerStreamableHTTPClientTransport';
import { WorkerWebSocketClientTransport } from '../../test-utils/src/mcp/WorkerWebSocketClientTransport';
import { WorkerSSEClientTransport } from '../../test-utils/src/mcp/WorkerSSEClientTransport';
import { ExecutionContext } from 'hono';

// Define response type for clarity
interface ToolResponse {
	content: Array<{
		type: string;
		text: string;
	}>;
}

describe('MCP Client Connection Tests', () => {
	const baseUrl = 'http://localhost';
	const wsBaseUrl = 'ws://localhost';

	// Define transport configurations
	const transportConfigs = [
		{
			name: 'SSE',
			createTransport: (ctx: ExecutionContext) => {
				const url = new URL(`${baseUrl}/sse`);
				return new WorkerSSEClientTransport(url, ctx);
			},
		},
		{
			name: 'StreamableHTTP',
			createTransport: (ctx: ExecutionContext) => {
				const url = new URL(`${baseUrl}/mcp`);
				return new WorkerStreamableHTTPClientTransport(url, ctx);
			},
		},
		{
			name: 'WebSocket',
			createTransport: (ctx: ExecutionContext) => {
				const url = new URL(`${wsBaseUrl}/ws`);
				return new WorkerWebSocketClientTransport(url, ctx);
			},
		},
	];

	// Parameterized tests for each transport type
	describe.each(transportConfigs)('$name Transport', (transportConfig) => {
		let client: Client;
		let ctx: ExecutionContext;

		beforeEach(async () => {
			console.log(`--------- ${transportConfig.name} TEST STARTING ---------`);
			ctx = createExecutionContext();

			// Create a new client
			client = new Client({
				name: 'test-client',
				version: '1.0.0',
			});

			console.log(`Created MCP Client for ${transportConfig.name} testing`);
		});

		afterEach(async () => {
			console.log(`--------- ${transportConfig.name} TEST ENDING ---------`);
			try {
				await client.close();
				console.log(`${transportConfig.name} client closed successfully`);
			} catch (err) {
				console.warn(`Error closing ${transportConfig.name} client:`, err);
			}
		});

		it('should successfully connect to the mcp server', async () => {
			console.log(`Testing ${transportConfig.name} transport connection`);

			const transport = transportConfig.createTransport(ctx);
			await client.connect(transport);

			await waitOnExecutionContext(ctx);
			console.log(`${transportConfig.name} client connection test passed!`);
		});

		// Somethign wrong with websockets transport - to be fixed.
		// it('should return server version matching the implementation', async () => {
		//   console.log(`Testing ${transportConfig.name} server version`);

		//   const transport = transportConfig.createTransport(ctx);
		//   await client.connect(transport);

		//   const serverInfo = client.getServerVersion();

		//   await waitOnExecutionContext(ctx);

		//   // Verify that serverInfo is defined
		//   expect(serverInfo).not.toBeUndefined();

		//   if (serverInfo) {
		//     // Expected values from TestHonoServer's getImplementation method
		//     expect(serverInfo.name).toBe('TestMcpServer');
		//     expect(serverInfo.version).toBe('1.0.0');
		//     expect(serverInfo.vendor).toBe('Test');
		//   }

		//   console.log(`${transportConfig.name} server version test passed!`);
		// });

		it('should call the echo tool and return the same message', async () => {
			console.log(`Testing ${transportConfig.name} echo tool`);

			const transport = transportConfig.createTransport(ctx);
			await client.connect(transport);

			// Test message to echo
			const testMessage = 'Hello, world!';

			// Call the echo tool with our test message
			const response = (await client.callTool({
				name: 'echo',
				arguments: { message: testMessage },
			})) as ToolResponse;

			await waitOnExecutionContext(ctx);

			// Verify that response has content
			expect(response).not.toBeUndefined();
			expect(Array.isArray(response.content)).toBe(true);
			expect(response.content.length).toBeGreaterThan(0);

			// Check the first content item is our echoed message
			const firstContent = response.content[0];
			expect(firstContent.type).toBe('text');
			expect(firstContent.text).toBe(testMessage);

			console.log(`${transportConfig.name} echo tool test passed!`);
		});
	});
});
