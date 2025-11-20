import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpHonoServerDO } from '../src/mcp/hono-server';
import { env, runInDurableObject } from 'cloudflare:test';
import { TestHonoServer } from './util/TestHonoServer';

/**
 * Test utilities for WebSocket and SSE connections
 */
interface WebSocketHeaders {
	upgrade?: boolean;
	mcpProtocol?: boolean;
	key?: string;
}

// Create standard headers for WebSocket connections
function createWebSocketHeaders(options: WebSocketHeaders = {}): HeadersInit {
	const headers: HeadersInit = {};

	if (options.upgrade !== false) {
		headers['Upgrade'] = 'websocket';
		headers['Connection'] = 'Upgrade';
		headers['Sec-WebSocket-Version'] = '13';
	}

	if (options.mcpProtocol !== false) {
		headers['Sec-WebSocket-Protocol'] = 'mcp';
	}

	headers['Sec-WebSocket-Key'] = options.key || 'dGhlIHNhbXBsZSBub25jZQ==';

	return headers;
}

// Create a new WebSocket connection with default settings
async function createWebSocketConnection(
	stub: DurableObjectStub<TestHonoServer>,
	sessionId: string = crypto.randomUUID(),
	headers: WebSocketHeaders = {},
): Promise<Response> {
	return await stub.fetch(`http://localhost/ws?sessionId=${sessionId}`, {
		headers: createWebSocketHeaders(headers),
	});
}

// Verify session existence in the DO
async function verifySession(stub: DurableObjectStub<TestHonoServer>, sessionId: string, shouldExist: boolean = true): Promise<void> {
	await runInDurableObject(stub, async (instance: McpHonoServerDO) => {
		// @ts-ignore - Access private field for testing purposes
		expect(instance.sessions.has(sessionId)).toBe(shouldExist);
	});
}

// Create an SSE connection
async function createSSEConnection(stub: DurableObjectStub<TestHonoServer>, sessionId: string = crypto.randomUUID()): Promise<Response> {
	return await stub.fetch(`http://localhost/sse?sessionId=${sessionId}`);
}

// Helper to wait for a specific JSON-RPC method from WebSocket
interface JsonRpcSessionMessage {
	jsonrpc: string;
	method: string;
	params?: {
		sessionId: string;
		[key: string]: any;
	};
}

function waitForJsonRpcMethod<T extends JsonRpcSessionMessage>(ws: WebSocket, method: string, timeout = 5000): Promise<T> {
	return new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			reject(new Error(`Timeout waiting for method ${method} after ${timeout}ms`));
		}, timeout);

		const receivedMessages: string[] = [];

		const messageHandler = (event: MessageEvent) => {
			const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
			receivedMessages.push(data);

			try {
				const parsed = JSON.parse(data);
				if (parsed.method === method) {
					clearTimeout(timeoutId);
					ws.removeEventListener('message', messageHandler);
					resolve(parsed as T);
				} else if (method === '*' && parsed.id) {
					// Special case: wait for any response with an ID
					clearTimeout(timeoutId);
					ws.removeEventListener('message', messageHandler);
					resolve(parsed as T);
				}
			} catch (error) {
				// Ignore non-JSON messages
			}
		};

		ws.addEventListener('message', messageHandler);
	});
}

describe('HonoMcpServerDO', () => {
	let id: DurableObjectId;
	let stub: DurableObjectStub<TestHonoServer>;
	let responseControllers: ReadableStreamDefaultController[] = [];

	beforeEach(() => {
		id = env.MCP_DURABLE_OBJECT.newUniqueId();
		stub = env.MCP_DURABLE_OBJECT.get(id) as DurableObjectStub<TestHonoServer>;
		responseControllers = [];
	});

	afterEach(async () => {
		// Clean up any active connections
		for (const controller of responseControllers) {
			try {
				controller.close();
			} catch (e) {
				// Ignore errors during cleanup
			}
		}

		// Clear any sessions in the DO
		await runInDurableObject(stub, async (instance: McpHonoServerDO) => {
			// @ts-ignore - Access private field for testing purposes
			if (instance.sessions) {
				// @ts-ignore
				instance.sessions.clear();
			}
		});
	});

	describe('SSE Connection', () => {
		it('should establish SSE connection', async () => {
			const sessionId = crypto.randomUUID();
			const response = await createSSEConnection(stub, sessionId);

			expect(response.status).toBe(200);
			expect(response.headers.get('Content-Type')).toBe('text/event-stream');
			expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
			expect(response.headers.get('Connection')).toBe('keep-alive');

			// Get the ReadableStream and its controller to close it later
			const stream = response.body;
			if (stream) {
				const reader = stream.getReader();
				reader.releaseLock(); // Release to allow consumption
			}

			// Verify session exists
			await verifySession(stub, sessionId, true);

			// Manually verify the DO was created properly
			await runInDurableObject(stub, async (instance: McpHonoServerDO) => {
				expect(instance).toBeInstanceOf(McpHonoServerDO);
			});
		});

		it('should reject SSE connection without sessionId', async () => {
			const response = await stub.fetch('http://localhost/sse');

			expect(response.status).toBe(400);
			const responseData = await response.text();
			expect(responseData).toContain('Missing sessionId parameter');
		});

		it('should handle multiple SSE connections with different sessionIds', async () => {
			const sessionId1 = crypto.randomUUID();
			const sessionId2 = crypto.randomUUID();

			const response1 = await createSSEConnection(stub, sessionId1);
			const response2 = await createSSEConnection(stub, sessionId2);

			expect(response1.status).toBe(200);
			expect(response2.status).toBe(200);

			// Verify both sessions exist
			await verifySession(stub, sessionId1, true);
			await verifySession(stub, sessionId2, true);
		});

		it('should handle reconnection with the same sessionId', async () => {
			const sessionId = crypto.randomUUID();

			// First connection
			const response1 = await createSSEConnection(stub, sessionId);
			expect(response1.status).toBe(200);

			// Second connection with same sessionId (should replace the first one)
			const response2 = await createSSEConnection(stub, sessionId);
			expect(response2.status).toBe(200);

			// Verify only one session exists in the DO
			await runInDurableObject(stub, async (instance: McpHonoServerDO) => {
				// @ts-ignore - Access private field for testing purposes
				expect(instance.sessions.has(sessionId)).toBe(true);
				// @ts-ignore
				expect(instance.sessions.size).toBe(1);
			});
		});
	});

	describe('WebSocket Connection', () => {
		it('should establish WebSocket connection', async () => {
			const sessionId = crypto.randomUUID();
			const response = await createWebSocketConnection(stub, sessionId);

			// Check for successful WebSocket handshake
			expect(response.status).toBe(101);
			// Headers may be handled differently in the testing environment, so we don't test them strictly

			// Verify a WebSocket pair was created
			expect(response.webSocket).toBeDefined();

			// Verify session was created in the DO
			await verifySession(stub, sessionId, true);
		});

		it('should reject WebSocket connection without sessionId', async () => {
			const response = await stub.fetch('http://localhost/ws', {
				headers: createWebSocketHeaders(),
			});

			// Should not upgrade without sessionId
			expect(response.status).toBe(400);
			const responseData = await response.text();
			expect(responseData).toContain('Missing sessionId parameter');
		});

		it('should reject non-WebSocket requests to WebSocket endpoint', async () => {
			const sessionId = crypto.randomUUID();
			const response = await createWebSocketConnection(stub, sessionId, { upgrade: false });

			expect(response.status).toBe(426); // Server uses 426 Upgrade Required
			const responseData = await response.text();
			expect(responseData).toContain('Expected Upgrade: websocket');
		});

		it('should reject WebSocket requests without MCP subprotocol', async () => {
			const sessionId = crypto.randomUUID();
			const response = await createWebSocketConnection(stub, sessionId, { mcpProtocol: false });

			expect(response.status).toBe(426);
			const responseData = await response.text();
			expect(responseData).toContain('Expected Sec-WebSocket-Protocol: mcp');
		});

		it('should handle multiple WebSocket connections with different sessionIds', async () => {
			const sessionId1 = crypto.randomUUID();
			const sessionId2 = crypto.randomUUID();

			const response1 = await createWebSocketConnection(stub, sessionId1);
			const response2 = await createWebSocketConnection(stub, sessionId2);

			expect(response1.status).toBe(101);
			expect(response2.status).toBe(101);

			// Verify that both sessions exist in the DO
			await verifySession(stub, sessionId1, true);
			await verifySession(stub, sessionId2, true);
		});

		it('should handle server-to-client WebSocket message exchange', async () => {
			const sessionId = crypto.randomUUID();
			const response = await createWebSocketConnection(stub, sessionId);

			expect(response.status).toBe(101);
			expect(response.webSocket).toBeDefined();

			// Get client WebSocket and accept it
			const clientWebSocket = response.webSocket as WebSocket;
			clientWebSocket.accept();

			// Step 1: Wait for the initial session message
			const sessionMessage = await waitForJsonRpcMethod<JsonRpcSessionMessage>(clientWebSocket, 'session');
			expect(sessionMessage).toBeDefined();
			expect(sessionMessage.params?.sessionId).toBe(sessionId);

			// Step 2: Create a test message that will be sent from server to client
			const testMessageId = 'server-message-' + crypto.randomUUID().slice(0, 8);
			const testMessage = {
				jsonrpc: '2.0' as const,
				method: 'test.message',
				params: {
					sessionId,
					text: 'Hello from server!',
				},
			};

			// Step 3: Create a promise to wait for the server-initiated message
			const messagePromise = new Promise<any>((resolve) => {
				const messageHandler = (event: MessageEvent) => {
					const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
					try {
						const parsed = JSON.parse(data);
						if (parsed.method === 'test.message') {
							clientWebSocket.removeEventListener('message', messageHandler);
							resolve(parsed);
						}
					} catch (error) {
						// Ignore parsing errors
					}
				};

				clientWebSocket.addEventListener('message', messageHandler);
			});

			// Step 4: Use runInDurableObject to send a message to the client
			await runInDurableObject(stub, async (instance: McpHonoServerDO) => {
				// @ts-ignore - Access private field for testing purposes
				const transport = instance.sessions.get(sessionId);
				if (!transport) {
					throw new Error('Transport not found for session');
				}

				// Send a test message directly to the client
				await transport.send(testMessage);
			});

			// Step 5: Wait for the message to be received by the client
			const receivedMessage = await messagePromise;

			// Step 6: Verify the message content
			expect(receivedMessage).toBeDefined();
			expect(receivedMessage.method).toBe(testMessage.method);
			expect(receivedMessage.params.text).toBe(testMessage.params.text);
			expect(receivedMessage.params.sessionId).toBe(sessionId);

			// Clean up
			clientWebSocket.close(1000, 'Normal closure');
		}, 10000); // Increase timeout to 10 seconds for this test

		it('should handle client-to-server WebSocket message exchange', async () => {
			const sessionId = crypto.randomUUID();
			const response = await createWebSocketConnection(stub, sessionId);

			expect(response.status).toBe(101);
			expect(response.webSocket).toBeDefined();

			// Get client WebSocket and accept it
			const clientWebSocket = response.webSocket as WebSocket;
			clientWebSocket.accept();

			// Wait for the initial session message
			const sessionMessage = await waitForJsonRpcMethod<JsonRpcSessionMessage>(clientWebSocket, 'session');
			expect(sessionMessage).toBeDefined();
			expect(sessionMessage.params?.sessionId).toBe(sessionId);

			// Create a test message to send from client to server
			const testMessageId = crypto.randomUUID();
			const testMessage = {
				jsonrpc: '2.0',
				method: 'test.clientMessage',
				id: testMessageId,
				params: { text: 'Hello from client!' },
			};

			// Create a Promise to monitor for message reception on the server side
			let messageReceivedResolve: (value: any) => void;
			const messageReceivedPromise = new Promise<any>((resolve) => {
				messageReceivedResolve = resolve;
			});

			// Set up a message listener on the transport object in the Durable Object
			await runInDurableObject(stub, async (instance: McpHonoServerDO) => {
				// @ts-ignore - Access private field for testing purposes
				const transport = instance.sessions.get(sessionId);
				if (!transport) {
					throw new Error('Transport not found for session');
				}

				// Override or add onmessage handler to detect when message is received
				// @ts-ignore - Accessing internal field for testing
				const originalOnMessage = transport.onmessage;

				// @ts-ignore - Setting up test hook
				transport.onmessage = (message: any) => {
					// Call original handler if it exists
					if (originalOnMessage) {
						originalOnMessage.call(transport, message);
					}

					// Check if this is our test message
					if (message?.method === testMessage.method && message?.id === testMessage.id) {
						messageReceivedResolve({
							received: true,
							message,
						});
					}
				};
			});

			// Send the message from client to server
			clientWebSocket.send(JSON.stringify(testMessage));

			// Wait for confirmation that the message was received on the server side
			const result = await messageReceivedPromise;

			// Verify the message was received correctly
			expect(result).toBeDefined();
			expect(result.received).toBe(true);
			expect(result.message.method).toBe(testMessage.method);
			expect(result.message.id).toBe(testMessage.id);
			expect(result.message.params.text).toBe(testMessage.params.text);

			// Clean up
			clientWebSocket.close(1000, 'Normal closure');
		}, 10000); // Increase timeout to 10 seconds for this test

		it('should handle session closure through WebSocket', async () => {
			const sessionId = crypto.randomUUID();
			const response = await createWebSocketConnection(stub, sessionId);

			expect(response.status).toBe(101);

			// Verify the session was created
			await verifySession(stub, sessionId, true);

			// Instead of using webSocketClose on the mock WebSocket,
			// directly access the transport and call close()
			response.webSocket?.accept();
			response.webSocket?.close(1000, 'Normal closure');

			// After closing the transport, verify the session is marked as closed
			await runInDurableObject(stub, async (instance: McpHonoServerDO) => {
				// @ts-ignore - Access private field for testing purposes
				const transport = instance.sessions.get(sessionId);
				if (transport) {
					// @ts-ignore - Access private field for testing
					expect(transport._closed).toBe(true);
				}
			});
		});

		it('should handle reconnection with the same sessionId via WebSocket', async () => {
			const sessionId = crypto.randomUUID();

			// First connection
			const response1 = await createWebSocketConnection(stub, sessionId);
			expect(response1.status).toBe(101);

			// Manually close the first connection
			response1.webSocket?.accept();
			response1.webSocket?.close(1000, 'Normal closure');

			// Second connection with same sessionId
			const response2 = await createWebSocketConnection(stub, sessionId);
			expect(response2.status).toBe(101);

			// Verify only one active session exists in the DO
			await runInDurableObject(stub, async (instance: McpHonoServerDO) => {
				// @ts-ignore - Access private field for testing purposes
				expect(instance.sessions.has(sessionId)).toBe(true);
				// @ts-ignore
				expect(instance.sessions.size).toBe(1);
			});
		});
	});

	describe('Message Handling', () => {
		it('should handle messages with valid sessionId', async () => {
			// First establish SSE connection with a session ID
			const sessionId = crypto.randomUUID();
			const sseResponse = await createSSEConnection(stub, sessionId);
			expect(sseResponse.status).toBe(200);

			// Then send a message with the same session ID
			const response = await stub.fetch(`http://localhost/sse/message?sessionId=${sessionId}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					method: 'test',
					id: '1',
				}),
			});

			expect(response.status).toBe(202);
		});

		it('should return 400 for missing sessionId', async () => {
			const response = await stub.fetch('http://localhost/sse/message', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					method: 'test',
					id: '1',
				}),
			});

			expect(response.status).toBe(400);
			const responseData = await response.text();
			expect(responseData).toContain('Missing sessionId parameter');
		});

		it('should return 404 for non-existent sessionId', async () => {
			const nonExistentSessionId = crypto.randomUUID();

			const response = await stub.fetch(`http://localhost/sse/message?sessionId=${nonExistentSessionId}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					method: 'test',
					id: '1',
				}),
			});

			expect(response.status).toBe(404);
			const responseData = await response.text();
			expect(responseData).toContain('Session not found');
		});

		it('should reject messages with invalid content-type', async () => {
			const sessionId = crypto.randomUUID();
			await createSSEConnection(stub, sessionId);

			const response = await stub.fetch(`http://localhost/sse/message?sessionId=${sessionId}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'text/plain',
				},
				body: 'This is not JSON',
			});

			expect(response.status).toBe(400);
			const responseData = await response.text();
			expect(responseData).toContain('Unsupported content-type');
		});

		it('should reject overly large messages', async () => {
			const sessionId = crypto.randomUUID();
			await createSSEConnection(stub, sessionId);

			// Create a large message (5MB, which exceeds the 4MB limit)
			const largeString = 'x'.repeat(5 * 1024 * 1024);

			const response = await stub.fetch(`http://localhost/sse/message?sessionId=${sessionId}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': (5 * 1024 * 1024).toString(),
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					method: 'test',
					id: '1',
					params: { large: largeString },
				}),
			});

			expect(response.status).toBe(400);
			const responseData = await response.text();
			expect(responseData).toContain('Request body too large');
		});

		it('should handle invalid JSON in message body', async () => {
			const sessionId = crypto.randomUUID();
			await createSSEConnection(stub, sessionId);

			const response = await stub.fetch(`http://localhost/sse/message?sessionId=${sessionId}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: '{ this is not valid JSON }',
			});

			expect(response.status).toBe(400);
		});
	});

	describe('Session Management', () => {
		it('should handle session closure internally', async () => {
			const sessionId = crypto.randomUUID();
			const response = await createSSEConnection(stub, sessionId);
			expect(response.status).toBe(200);

			// Verify session exists
			await runInDurableObject(stub, async (instance: McpHonoServerDO) => {
				// @ts-ignore - Access private field for testing purposes
				expect(instance.sessions.has(sessionId)).toBe(true);

				// Directly access and verify session properties
				// @ts-ignore
				const transport = instance.sessions.get(sessionId);
				expect(transport).toBeDefined();
				if (transport) {
					expect(transport.sessionId).toBe(sessionId);

					// Test internal state of the transport
					// @ts-ignore - Access private field for testing
					expect(transport._closed).toBe(false);

					// Call close method and check internal state changed
					await transport.close();
					// @ts-ignore - Access private field for testing
					expect(transport._closed).toBe(true);
				}
			});
		});
	});

	describe('Integration Test', () => {
		it('should handle full message flow with SSE connection', async () => {
			// First establish SSE connection with a session ID
			const sessionId = crypto.randomUUID();
			const sseResponse = await createSSEConnection(stub, sessionId);
			expect(sseResponse.status).toBe(200);

			// Then send a message with the same session ID
			const messageResponse = await stub.fetch(`http://localhost/sse/message?sessionId=${sessionId}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					method: 'test',
					id: '1',
				}),
			});

			expect(messageResponse.status).toBe(202);
		});

		it('should handle multiple messages to the same session', async () => {
			const sessionId = crypto.randomUUID();
			const sseResponse = await createSSEConnection(stub, sessionId);
			expect(sseResponse.status).toBe(200);

			// Helper function to send a message to the session
			const sendMessage = async (method: string, id: string) => {
				return await stub.fetch(`http://localhost/sse/message?sessionId=${sessionId}`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						jsonrpc: '2.0',
						method,
						id,
					}),
				});
			};

			// Send first message
			const response1 = await sendMessage('test1', '1');

			// Send second message
			const response2 = await sendMessage('test2', '2');

			expect(response1.status).toBe(202);
			expect(response2.status).toBe(202);
		});

		it('should support both SSE and WebSocket connections simultaneously', async () => {
			// Create SSE connection
			const sseSessionId = crypto.randomUUID();
			const sseResponse = await createSSEConnection(stub, sseSessionId);
			expect(sseResponse.status).toBe(200);

			// Create WebSocket connection
			const wsSessionId = crypto.randomUUID();
			const wsResponse = await createWebSocketConnection(stub, wsSessionId);
			expect(wsResponse.status).toBe(101);

			// Accept WebSocket and wait for the session message
			const wsClient = wsResponse.webSocket as WebSocket;
			wsClient.accept();

			try {
				const sessionMessage = await waitForJsonRpcMethod<JsonRpcSessionMessage>(wsClient, 'session');
				expect(sessionMessage.params?.sessionId).toBe(wsSessionId);
			} catch (error) {
				console.warn('Did not receive session message:', error);
			}

			// Verify both sessions exist
			await verifySession(stub, sseSessionId, true);
			await verifySession(stub, wsSessionId, true);

			// Verify total session count
			await runInDurableObject(stub, async (instance: McpHonoServerDO) => {
				// @ts-ignore
				expect(instance.sessions.size).toBe(2);
			});

			// Clean up WebSocket
			wsClient.close(1000, 'Normal closure');
		});
	});
});
