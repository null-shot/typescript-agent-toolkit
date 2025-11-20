import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { WorkerSSEClientTransport } from '@nullshot/test-utils/mcp/WorkerSSEClientTransport';

// Define response type for clarity
interface ToolResponse {
	content: Array<{
		type: string;
		text: string;
	}>;
	isPrime?: boolean;
}

describe('KV MCP Client Integration Tests', () => {
	const baseUrl = 'http://localhost';
	let client: Client;
	let ctx: ExecutionContext;

	beforeEach(async () => {
		console.log(`--------- STARTING KV MCP TEST ---------`);
		ctx = createExecutionContext();

		// Create a standard MCP client
		client = new Client({
			name: 'test-client',
			version: '1.0.0',
		});

		console.log(`Created MCP Client for KV testing`);
	});

	afterEach(async () => {
		console.log(`--------- ENDING KV MCP TEST ---------`);
		try {
			// Only call close if client is properly initialized
			if (client && typeof client.close === 'function') {
				await client.close();
				console.log(`Client closed successfully`);
			}
		} catch (err) {
			console.warn(`Error closing client:`, err);
		}
	});

	// Helper function to create the transport
	function createTransport(ctx: ExecutionContext) {
		const url = new URL(`${baseUrl}/sse`);
		return new WorkerSSEClientTransport(url, ctx);
	}

	// Test for basic functionality
	it('should initialize the client properly', () => {
		expect(client).toBeDefined();

		// Simply check that the client was created successfully
		// Skip checking internal properties since they seem to vary
		const clientOptions = client.constructor.name;
		expect(clientOptions).toBe('Client');
	});

	it('should successfully connect to the kv MCP server', async () => {
		console.log(`Testing SSE transport connection`);

		const transport = createTransport(ctx);
		await client.connect(transport);

		await waitOnExecutionContext(ctx);
		console.log(`Client connection test passed!`);
	});

	it('should return server version matching the implementation', async () => {
		console.log(`Testing server version`);

		const transport = createTransport(ctx);
		await client.connect(transport);

		const serverInfo = await client.getServerVersion();

		// Verify that serverInfo is defined
		expect(serverInfo).not.toBeUndefined();

		if (serverInfo) {
			// Expected values from KvMcpServer's getImplementation method
			expect(serverInfo.name).toBe('KvMcpServer');
			expect(serverInfo.version).toBe('1.0.0');
		}

		await waitOnExecutionContext(ctx);
		console.log(`Server version test passed!`);
	});

	it('should list available tools including is_prime tool', async () => {
		const transport = createTransport(ctx);
		await client.connect(transport);

		const tools = await client.listTools();

		// Verify tools are available
		expect(tools).not.toBeUndefined();
		expect(tools.tools).toHaveLength(1);

		// Check is_prime tool exists
		const isPrimeTool = tools.tools.find((tool) => tool.name === 'is_prime');
		expect(isPrimeTool).not.toBeUndefined();
		expect(isPrimeTool?.description).toBe('Returns true if the number is prime, false otherwise');

		await waitOnExecutionContext(ctx);
		console.log(`Tools listing test passed!`);
	});

	it('should execute is_prime tool with a prime number', async () => {
		const transport = createTransport(ctx);
		await client.connect(transport);

		// Test with a prime number (7 is prime)
		const result = (await client.callTool({
			name: 'is_prime',
			arguments: { num: 7 },
		})) as ToolResponse;

		// Verify result structure
		expect(result).not.toBeUndefined();
		expect(Array.isArray(result.content)).toBe(true);
		expect(result.content.length).toBeGreaterThan(0);

		const firstContent = result.content[0];
		expect(firstContent.type).toBe('text');
		expect(firstContent.text).toContain('Number: 7 is prime: true');

		// Check the isPrime property if available
		if (result.isPrime !== undefined) {
			expect(result.isPrime).toBe(true);
		}

		await waitOnExecutionContext(ctx);
		console.log(`Is prime tool (prime) test passed!`);
	});

	it('should execute is_prime tool with a non-prime number', async () => {
		const transport = createTransport(ctx);
		await client.connect(transport);

		// Test with a non-prime number (4 is not prime)
		const result = (await client.callTool({
			name: 'is_prime',
			arguments: { num: 4 },
		})) as ToolResponse;

		// Verify result structure
		expect(result).not.toBeUndefined();
		expect(Array.isArray(result.content)).toBe(true);
		expect(result.content.length).toBeGreaterThan(0);

		const firstContent = result.content[0];
		expect(firstContent.type).toBe('text');
		expect(firstContent.text).toContain('Number: 4 is prime: false');

		// Check the isPrime property if available
		if (result.isPrime !== undefined) {
			expect(result.isPrime).toBe(false);
		}

		await waitOnExecutionContext(ctx);
		console.log(`Is prime tool (non-prime) test passed!`);
	});

	it('should execute is_prime tool with edge cases', async () => {
		const transport = createTransport(ctx);
		await client.connect(transport);

		// Test edge case: 1 is not prime
		const result1 = (await client.callTool({
			name: 'is_prime',
			arguments: { num: 1 },
		})) as ToolResponse;

		expect(result1.content[0].text).toContain('Number: 1 is prime: false');

		// Test edge case: 2 is prime (smallest prime)
		const result2 = (await client.callTool({
			name: 'is_prime',
			arguments: { num: 2 },
		})) as ToolResponse;

		expect(result2.content[0].text).toContain('Number: 2 is prime: true');

		await waitOnExecutionContext(ctx);
		console.log(`Is prime tool (edge cases) test passed!`);
	});

	it('should cache prime results in KV storage', async () => {
		const transport = createTransport(ctx);
		await client.connect(transport);

		// Use a larger prime number to ensure computation time
		const testNum = 17;

		// First call - should compute and cache
		const result1 = (await client.callTool({
			name: 'is_prime',
			arguments: { num: testNum },
		})) as ToolResponse;

		expect(result1.content[0].text).toContain(`Number: ${testNum} is prime: true`);

		// Second call - should retrieve from cache
		const result2 = (await client.callTool({
			name: 'is_prime',
			arguments: { num: testNum },
		})) as ToolResponse;

		expect(result2.content[0].text).toContain(`Number: ${testNum} is prime: true`);

		// Verify KV has the cached value
		const cachedValue = await env.EXAMPLE_KV.get(testNum.toString());
		expect(cachedValue).toBe('true');

		await waitOnExecutionContext(ctx);
		console.log(`Is prime tool (KV caching) test passed!`);
	});
});
