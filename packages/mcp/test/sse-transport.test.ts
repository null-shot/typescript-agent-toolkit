import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SSETransport } from '../src/mcp/sse-transport';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

// Mock WritableStreamDefaultWriter
function createMockWriter() {
	const write = vi.fn().mockResolvedValue(undefined);
	return {
		write,
		close: vi.fn().mockResolvedValue(undefined),
		releaseLock: vi.fn(),
	} as unknown as WritableStreamDefaultWriter & { write: typeof write };
}

const getWriteMock = (writer: any) => vi.mocked(writer.write);

describe('SSETransport', () => {
	describe('start method', () => {
		it('should correctly append sessionId to a simple relative endpoint', async () => {
			const mockWriter = createMockWriter();
			const endpoint = 'https://example.com/messages';
			const sessionId = 'test-session';
			const transport = new SSETransport(mockWriter, sessionId, endpoint);

			await transport.start();

			const writeMock = getWriteMock(mockWriter);
			expect(writeMock).toHaveBeenCalledTimes(1);
			const callArg = new TextDecoder().decode(writeMock.mock.calls[0][0]);
			expect(callArg).toContain('event: endpoint');
			expect(callArg).toContain(`/messages?sessionId=${sessionId}`);
		});

		it('should correctly append sessionId to an endpoint with existing query parameters', async () => {
			const mockWriter = createMockWriter();
			const endpoint = 'https://example.com/messages?foo=bar&baz=qux';
			const sessionId = 'test-session';
			const transport = new SSETransport(mockWriter, sessionId, endpoint);

			await transport.start();

			const writeMock = getWriteMock(mockWriter);
			const callArg = new TextDecoder().decode(writeMock.mock.calls[0][0]);
			expect(callArg).toContain('event: endpoint');
			expect(callArg).toContain('/messages?foo=bar&baz=qux&sessionId=test-session');
		});

		it('should correctly handle the root path endpoint "/"', async () => {
			const mockWriter = createMockWriter();
			const endpoint = 'https://example.com/';
			const sessionId = 'test-session';
			const transport = new SSETransport(mockWriter, sessionId, endpoint);

			await transport.start();

			const writeMock = getWriteMock(mockWriter);
			const callArg = new TextDecoder().decode(writeMock.mock.calls[0][0]);
			expect(callArg).toContain('event: endpoint');
			expect(callArg).toContain('/?sessionId=test-session');
		});
	});

	describe('handlePostMessage method', () => {
		let transport: SSETransport;
		let mockWriter: WritableStreamDefaultWriter & { write: ReturnType<typeof vi.fn> };
		const sessionId = 'test-session';
		const endpoint = 'https://example.com/test';

		beforeEach(async () => {
			mockWriter = createMockWriter();
			transport = new SSETransport(mockWriter, sessionId, endpoint);
			await transport.start();
		});

		it('should handle valid JSON messages', async () => {
			const mockMessage: JSONRPCMessage = {
				jsonrpc: '2.0',
				method: 'test',
				id: '1',
			};
			const onMessageSpy = vi.fn();
			transport.onmessage = onMessageSpy;

			const req = new Request('https://example.com', {
				method: 'POST',
				body: JSON.stringify(mockMessage),
				headers: { 'Content-Type': 'application/json' },
			});

			const response = await transport.handlePostMessage(req);
			expect(response.status).toBe(202);
			expect(onMessageSpy).toHaveBeenCalledWith(mockMessage);
		});

		it('should reject invalid JSON', async () => {
			const req = new Request('https://example.com', {
				method: 'POST',
				body: 'not-json',
				headers: { 'Content-Type': 'application/json' },
			});
			const onErrorSpy = vi.fn();
			transport.onerror = onErrorSpy;
			const response = await transport.handlePostMessage(req);
			expect(response.status).toBe(400);
			expect(onErrorSpy).toHaveBeenCalled();
		});
	});

	describe('send method', () => {
		it('should send messages', async () => {
			const mockWriter = createMockWriter();
			const sessionId = 'test-session';
			const endpoint = 'https://example.com/test';
			const transport = new SSETransport(mockWriter, sessionId, endpoint);
			await transport.start();

			const message: JSONRPCMessage = {
				jsonrpc: '2.0',
				method: 'test',
				id: '1',
			};

			await transport.send(message);
			const writeMock = getWriteMock(mockWriter);
			const callArg = new TextDecoder().decode(writeMock.mock.calls[1][0]);
			expect(callArg).toContain('event: message');
			expect(callArg).toContain(JSON.stringify(message));
		});

		it('should call onerror if send() fails to write', async () => {
			const mockWriter = createMockWriter();
			const endpoint = 'https://example.com/messages';
			const sessionId = 'test-session';
			const transport = new SSETransport(mockWriter, sessionId, endpoint);
			await transport.start();
			const error = new Error('send failed');
			mockWriter.write.mockRejectedValueOnce(error);
			const onErrorSpy = vi.fn();
			transport.onerror = onErrorSpy;
			await expect(transport.send({ jsonrpc: '2.0' as const, method: 'test', id: '1' })).rejects.toThrow('send failed');
			expect(onErrorSpy).toHaveBeenCalledWith(error);
		});
	});

	describe('close method', () => {
		it('should call onclose handler when closed', async () => {
			const mockWriter = createMockWriter();
			const sessionId = 'test-session';
			const endpoint = 'https://example.com/test';
			const transport = new SSETransport(mockWriter, sessionId, endpoint);
			const onCloseSpy = vi.fn();
			transport.onclose = onCloseSpy;

			await transport.close();
			expect(onCloseSpy).toHaveBeenCalled();
		});
	});

	describe('edge cases', () => {
		it('should call onerror if start() fails to write', async () => {
			const mockWriter = createMockWriter();
			const error = new Error('write failed');
			mockWriter.write.mockRejectedValueOnce(error);
			const endpoint = 'https://example.com/messages';
			const sessionId = 'test-session';
			const transport = new SSETransport(mockWriter, sessionId, endpoint);
			const onErrorSpy = vi.fn();
			transport.onerror = onErrorSpy;
			await transport.start();
			expect(onErrorSpy).toHaveBeenCalledWith(error);
		});

		it('should only call onclose once if close() is called multiple times', async () => {
			const mockWriter = createMockWriter();
			const endpoint = 'https://example.com/messages';
			const sessionId = 'test-session';
			const transport = new SSETransport(mockWriter, sessionId, endpoint);
			const onCloseSpy = vi.fn();
			transport.onclose = onCloseSpy;
			await transport.close();
			await transport.close();
			expect(onCloseSpy).toHaveBeenCalledTimes(1);
		});

		it('should return 400 and call onerror for handlePostMessage with invalid content', async () => {
			const mockWriter = createMockWriter();
			const endpoint = 'https://example.com/messages';
			const sessionId = 'test-session';
			const transport = new SSETransport(mockWriter, sessionId, endpoint);
			await transport.start();
			const req = new Request('https://example.com', {
				method: 'POST',
				body: 'Test text',
				headers: { 'Content-Type': 'application/json' },
			});
			const onErrorSpy = vi.fn();
			transport.onerror = onErrorSpy;
			const response = await transport.handlePostMessage(req);
			expect(response.status).toBe(400);
			expect(onErrorSpy).toHaveBeenCalled();
		});

		it('should return 400 and call onerror for handlePostMessage with empty body', async () => {
			const mockWriter = createMockWriter();
			const endpoint = 'https://example.com/messages';
			const sessionId = 'test-session';
			const transport = new SSETransport(mockWriter, sessionId, endpoint);
			await transport.start();
			const req = new Request('https://example.com', {
				method: 'POST',
				body: '',
				headers: { 'Content-Type': 'application/json' },
			});
			const onErrorSpy = vi.fn();
			transport.onerror = onErrorSpy;
			const response = await transport.handlePostMessage(req);
			expect(response.status).toBe(400);
			expect(onErrorSpy).toHaveBeenCalled();
		});

		it('should call onerror and not throw for start() with malformed URL', async () => {
			const mockWriter = createMockWriter();
			const endpoint = 'not a url';
			const sessionId = 'test-session';
			const transport = new SSETransport(mockWriter, sessionId, endpoint);
			const onErrorSpy = vi.fn();
			transport.onerror = onErrorSpy;
			await transport.start();
			expect(onErrorSpy).toHaveBeenCalled();
		});

		it('should send multiple messages in order', async () => {
			const mockWriter = createMockWriter();
			const endpoint = 'https://example.com/messages';
			const sessionId = 'test-session';
			const transport = new SSETransport(mockWriter, sessionId, endpoint);
			await transport.start();
			const messages = [
				{ jsonrpc: '2.0' as const, method: 'a', id: '1' },
				{ jsonrpc: '2.0' as const, method: 'b', id: '2' },
				{ jsonrpc: '2.0' as const, method: 'c', id: '3' },
			];
			for (const msg of messages) {
				await transport.send(msg);
			}
			const writeMock = getWriteMock(mockWriter);
			expect(writeMock.mock.calls.length).toBe(1 + messages.length); // 1 for start, rest for send
			for (let i = 0; i < messages.length; i++) {
				const callArg = new TextDecoder().decode(writeMock.mock.calls[i + 1][0]);
				expect(callArg).toContain(JSON.stringify(messages[i]));
			}
		});
	});
});
