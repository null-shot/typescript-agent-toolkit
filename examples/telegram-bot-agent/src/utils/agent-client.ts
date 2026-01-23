/**
 * Agent Client
 * 
 * Handles communication with the agent worker
 * Supports streaming responses for real-time updates
 * 
 * Best Practices:
 * - Streaming for better UX
 * - Error handling and retries
 * - Timeout handling
 * - SSE format parsing
 */

/**
 * Stream response from agent and call callback for each chunk
 * 
 * @param agentUrl - Agent worker URL (fallback if service binding not available)
 * @param sessionId - Agent session ID
 * @param messages - Array of messages (with history)
 * @param onChunk - Callback for each text chunk
 * @param agentService - Optional service binding (preferred over HTTP)
 */
export async function streamAgentResponse(
	agentUrl: string,
	sessionId: string,
	messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
	onChunk: (chunk: string) => Promise<void>,
	agentService?: Fetcher
): Promise<void> {
	// Use service binding if available, otherwise fallback to HTTP
	const useServiceBinding = !!agentService;
	// Service bindings need absolute URL with any domain (it's ignored)
	const url = useServiceBinding 
		? `https://service-binding/agent/chat/${sessionId}`  // Service binding uses absolute URL (domain ignored)
		: `${agentUrl}/agent/chat/${sessionId}`;

	// Prepare payload in AIUISDKMessage format
	// Agent expects: { id: string, messages: ModelMessage[] }
	const payload = {
		id: sessionId, // Use sessionId as message ID
		messages,
	};

	// Retry logic for handling temporary errors (like 1042)
	const maxRetries = 3;
	let response: Response | null = null;
	
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			if (attempt > 1) {
				console.log(`🔄 Retry attempt ${attempt}/${maxRetries}...`);
				// Exponential backoff: 1s, 2s, 4s
				await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 2)));
			}
			
			console.log(`📤 Sending request to agent (attempt ${attempt}/${maxRetries}): ${url}`);
			console.log(`📦 Payload:`, JSON.stringify(payload, null, 2));
			console.log(`📦 Payload size:`, JSON.stringify(payload).length, 'bytes');
			console.log(`📦 Full request details:`, {
				url,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				bodyLength: JSON.stringify(payload).length
			});
			
			const requestStartTime = Date.now();
			
			// For Service Binding, we need to ensure the URL is absolute
			// Service bindings work with any domain, but URL must be absolute
			const finalUrl = useServiceBinding && !url.startsWith('http')
				? `https://service-binding${url.startsWith('/') ? '' : '/'}${url}`
				: url;
			
			console.log(`📡 Using ${useServiceBinding ? 'Service Binding' : 'HTTP fetch'}`);
			console.log(`📡 Final URL: ${finalUrl}`);
			
			const request = new Request(finalUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"User-Agent": "TelegramBot/1.0",
				},
				body: JSON.stringify(payload),
			});
			
			// Call fetch with proper context - Service Binding fetch must be called directly
			// Cannot store fetch in variable as it loses 'this' context
			if (useServiceBinding && agentService) {
				response = await agentService.fetch(request).catch((error: unknown) => {
					const requestDuration = Date.now() - requestStartTime;
					console.error(`❌ Service Binding fetch error after ${requestDuration}ms:`, error);
					if (error instanceof Error) {
						console.error(`❌ Error name:`, error.name);
						console.error(`❌ Error message:`, error.message);
					}
					throw error;
				});
			} else {
				response = await fetch(request, {
					signal: AbortSignal.timeout(60000), // 60 second timeout
				}).catch((error: unknown) => {
					const requestDuration = Date.now() - requestStartTime;
					console.error(`❌ Fetch error after ${requestDuration}ms:`, error);
					if (error instanceof Error) {
						console.error(`❌ Error name:`, error.name);
						console.error(`❌ Error message:`, error.message);
					}
					throw error;
				});
			}
			
			const requestDuration = Date.now() - requestStartTime;
			console.log(`📥 Request completed in ${requestDuration}ms`);

			// TypeScript: response is guaranteed non-null here since catch throws
			if (!response) {
				throw new Error('No response received');
			}

			console.log(`📥 Agent response status: ${response.status} ${response.statusText}`);

			if (!response.ok) {
				const errorText = await response.text().catch(() => "");
				console.error(`❌ Agent error response: ${errorText}`);
				console.error(`❌ Request URL: ${url}`);
				console.error(`❌ Request method: POST`);
				console.error(`❌ Request headers:`, {
					"Content-Type": "application/json"
				});
				console.error(`❌ Request payload:`, JSON.stringify(payload, null, 2));
				
				// Retry on 404/1042 errors (temporary Cloudflare errors)
				if ((response.status === 404 || errorText.includes('1042')) && attempt < maxRetries) {
					console.warn(`⚠️ Got 404/1042 error, will retry...`);
					response = null; // Reset response for retry
					continue; // Retry
				}
				
				throw new Error(`Agent request failed: ${response.status} ${response.statusText}. Response: ${errorText}`);
			}
			
			// Success! Break out of retry loop
			break;
		} catch (error) {
			response = null; // Reset response for retry
			if (attempt < maxRetries) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.warn(`⚠️ Request failed, will retry... (${errorMessage})`);
				continue;
			}
			// Last attempt failed, throw error
			throw error;
		}
	}
	
	if (!response) {
		throw new Error('Failed to get response from agent after all retries');
	}

	try {
		// Handle streaming response (SSE format)
		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error("No response body");
		}

		const decoder = new TextDecoder();
		let buffer = "";
		let hasReceivedData = false;

		while (true) {
			const { done, value } = await reader.read();

			if (done) {
				break;
			}

			// Decode chunk
			buffer += decoder.decode(value, { stream: true });
			hasReceivedData = true;

			// Parse different formats
			// Format 1: 0:"text" (AI SDK toTextStreamResponse format)
			// Format 2: data: {"type":"text-delta","delta":"..."} (SSE format)
			// Format 3: Plain text (fallback)
			
			// First, try to match format 0:"text" (may span multiple chunks)
			// But only if buffer starts with digit and colon
			if (buffer.match(/^\d+:"/)) {
				const textFormatMatch = buffer.match(/^(\d+):"(.*)"$/s);
				if (textFormatMatch) {
					const fullText = textFormatMatch[2]
						.replace(/\\"/g, '"')
						.replace(/\\n/g, "\n")
						.replace(/\\r/g, "\r")
						.replace(/\\\\/g, "\\");
					console.log(`📝 Full text response (format 0:"text"): "${fullText.substring(0, 100)}${fullText.length > 100 ? '...' : ''}"`);
					await onChunk(fullText);
					buffer = "";
					continue;
				}
			}

			// Try line-by-line parsing for SSE format
			const lines = buffer.split("\n");
			buffer = lines.pop() || ""; // Keep incomplete line in buffer

			for (const line of lines) {
				if (line.trim() === "") continue; // Skip empty lines
				
				// Format: data: {...}
				if (line.startsWith("data: ")) {
					try {
						const data = JSON.parse(line.slice(6));
						console.log(`📦 Parsed SSE data:`, data);
						if (data.type === "text-delta" && data.delta) {
							console.log(`📝 Text delta chunk: "${data.delta}"`);
							await onChunk(data.delta);
						} else if (data.type === "finish") {
							console.log(`✅ Stream finished`);
							return;
						}
					} catch (e) {
						console.warn(`⚠️ Failed to parse SSE line: ${line}`, e);
					}
				}
				// Format: 0:"text" (single line)
				else if (line.match(/^\d+:"/)) {
					const match = line.match(/^(\d+):"(.*)"$/);
					if (match) {
						const text = match[2]
							.replace(/\\"/g, '"')
							.replace(/\\n/g, "\n")
							.replace(/\\r/g, "\r")
							.replace(/\\\\/g, "\\");
						if (text) {
							console.log(`📝 Text chunk (format 0:"text"): "${text}"`);
							await onChunk(text);
						}
					}
				}
				// Plain text (fallback - if no format detected)
				else if (line.trim() && !line.startsWith("data:") && !line.match(/^\d+:/)) {
					console.log(`📝 Plain text chunk: "${line}"`);
					await onChunk(line);
				}
			}
			
			// If buffer still has content and we're done reading, it might be plain text
			// This handles cases where the entire response is plain text without newlines
			if (buffer.trim() && !buffer.match(/^\d+:"/) && !buffer.startsWith("data: ")) {
				console.log(`📝 Buffer contains plain text: "${buffer.substring(0, 100)}${buffer.length > 100 ? '...' : ''}"`);
				// Process plain text from buffer
				await onChunk(buffer.trim());
				buffer = "";
			}
		}
		
		// After stream ends, process any remaining buffer content
		if (buffer.trim()) {
			console.log(`📝 Processing final buffer (${buffer.length} chars): "${buffer.substring(0, 100)}${buffer.length > 100 ? '...' : ''}"`);
			
			// Try format 0:"text" first (if starts with digit and colon)
			if (buffer.match(/^\d+:"/)) {
				const textFormatMatch = buffer.match(/^(\d+):"(.*)"$/s);
				if (textFormatMatch) {
					const fullText = textFormatMatch[2]
						.replace(/\\"/g, '"')
						.replace(/\\n/g, "\n")
						.replace(/\\r/g, "\r")
						.replace(/\\\\/g, "\\");
					console.log(`📝 Final text response (format 0:"text"): "${fullText.substring(0, 100)}${fullText.length > 100 ? '...' : ''}"`);
					await onChunk(fullText);
					hasReceivedData = true;
				}
			}
			// Try SSE format
			else if (buffer.startsWith("data: ")) {
				try {
					const data = JSON.parse(buffer.slice(6));
					if (data.type === "text-delta" && data.delta) {
						console.log(`📝 Final SSE delta: "${data.delta}"`);
						await onChunk(data.delta);
						hasReceivedData = true;
					}
				} catch (e) {
					console.warn(`⚠️ Failed to parse SSE buffer:`, e);
				}
			}
			// Plain text fallback (most common case for production)
			else {
				console.log(`📝 Final plain text response: "${buffer.substring(0, 100)}${buffer.length > 100 ? '...' : ''}"`);
				await onChunk(buffer.trim());
				hasReceivedData = true;
			}
		}

		// If no data was received at all, something is wrong
		if (!hasReceivedData) {
			console.warn(`⚠️ No data received from agent response`);
		}
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw new Error("Request timeout - agent took too long to respond");
		}
		throw error;
	}
}

/**
 * Send message to agent and get full response (non-streaming)
 * 
 * @param agentUrl - Agent worker URL
 * @param sessionId - Agent session ID
 * @param messageText - User message text
 * @returns Full response text
 */
export async function sendAgentMessage(
	agentUrl: string,
	sessionId: string,
	messages: Array<{ role: "user" | "assistant" | "system"; content: string }>
): Promise<string> {
	let fullResponse = "";

	await streamAgentResponse(agentUrl, sessionId, messages, async (chunk: string) => {
		fullResponse += chunk;
	});

	return fullResponse;
}
