import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocketTransport } from '../src/mcp/websocket-transport';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

describe('WebSocketTransport', () => {
	let transport: WebSocketTransport;
	let mockWebSocket: {
		send: ReturnType<typeof vi.fn>;
		close: ReturnType<typeof vi.fn>;
	};
	const testSessionId = 'test-session-123';

	beforeEach(() => {
		// Create mock WebSocket
		mockWebSocket = {
			send: vi.fn(),
			close: vi.fn(),
		};

		// Create transport with mock WebSocket
		transport = new WebSocketTransport(mockWebSocket, testSessionId);
	});

	describe('constructor', () => {
		it('should initialize with the provided WebSocket and sessionId', () => {
			expect(transport.sessionId).toBe(testSessionId);
		});
	});

	describe('send', () => {
		it('should stringify and send JSON-RPC messages', async () => {
			const message: JSONRPCMessage = {
				jsonrpc: '2.0',
				method: 'test',
				params: { foo: 'bar' },
			};

			await transport.send(message);

			expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
			expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify(message));
		});

		it('should propagate errors to the error handler', async () => {
			const message: JSONRPCMessage = {
				jsonrpc: '2.0',
				method: 'test',
				params: { foo: 'bar' },
			};

			const error = new Error('Send error');
			mockWebSocket.send.mockImplementation(() => {
				throw error;
			});

			const errorHandler = vi.fn();
			transport.onerror = errorHandler;

			await expect(transport.send(message)).rejects.toThrow('Send error');
			expect(errorHandler).toHaveBeenCalledWith(error);
		});
	});

	describe('close', () => {
		it('should close the WebSocket with default parameters', async () => {
			await transport.close();

			expect(mockWebSocket.close).toHaveBeenCalledWith(1000, 'Normal closure');
		});

		it('should close the WebSocket with provided parameters', async () => {
			await transport.close(1001, 'Going away');

			expect(mockWebSocket.close).toHaveBeenCalledWith(1001, 'Going away');
		});

		it('should call onclose handler', async () => {
			const closeHandler = vi.fn();
			transport.onclose = closeHandler;

			await transport.close();

			expect(closeHandler).toHaveBeenCalled();
		});

		it('should handle errors during close', async () => {
			const error = new Error('Close error');
			mockWebSocket.close.mockImplementation(() => {
				throw error;
			});

			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			await transport.close();

			expect(consoleSpy).toHaveBeenCalledWith('Error closing WebSocket:', error);
		});

		it('should only close the connection once', async () => {
			await transport.close();
			await transport.close();

			expect(mockWebSocket.close).toHaveBeenCalledTimes(1);
		});
	});

	describe('handleMessage', () => {
		it('should parse JSON string messages and call onmessage', () => {
			const message: JSONRPCMessage = {
				jsonrpc: '2.0',
				method: 'test',
				params: { foo: 'bar' },
			};

			const messageHandler = vi.fn();
			transport.onmessage = messageHandler;

			transport.handleMessage(JSON.stringify(message));

			expect(messageHandler).toHaveBeenCalledWith(message);
		});

		it('should handle ArrayBuffer messages', () => {
			const message: JSONRPCMessage = {
				jsonrpc: '2.0',
				method: 'test',
				params: { foo: 'bar' },
			};

			const messageHandler = vi.fn();
			transport.onmessage = messageHandler;

			// Convert string to ArrayBuffer
			const encoder = new TextEncoder();
			const uint8Array = encoder.encode(JSON.stringify(message));

			// Create a proper ArrayBuffer from the Uint8Array
			const arrayBuffer = new ArrayBuffer(uint8Array.length);
			const uint8View = new Uint8Array(arrayBuffer);
			uint8View.set(uint8Array);

			transport.handleMessage(arrayBuffer);

			expect(messageHandler).toHaveBeenCalledWith(message);
		});

		it('should call onerror on JSON parse errors', () => {
			const errorHandler = vi.fn();
			transport.onerror = errorHandler;

			transport.handleMessage('invalid-json');

			expect(errorHandler).toHaveBeenCalled();
			expect(errorHandler.mock.calls[0][0]).toBeInstanceOf(Error);
		});
	});

	describe('start', () => {
		it('should log debug message and send session message', async () => {
			const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

			await transport.start();

			expect(consoleSpy).toHaveBeenCalledWith(`WebSocket Transport started for session: ${testSessionId}`);
			expect(mockWebSocket.send).toHaveBeenCalledTimes(1);

			// Verify session message was sent
			const expectedMessage = {
				jsonrpc: '2.0',
				method: 'session',
				params: { sessionId: testSessionId },
			};
			expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify(expectedMessage));
		});

		it('should handle start errors', async () => {
			const error = new Error('Start error');
			mockWebSocket.send.mockImplementation(() => {
				throw error;
			});

			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const errorHandler = vi.fn();
			transport.onerror = errorHandler;

			await transport.start();

			expect(consoleSpy).toHaveBeenCalled();
			expect(errorHandler).toHaveBeenCalledWith(error);
		});
	});
});
