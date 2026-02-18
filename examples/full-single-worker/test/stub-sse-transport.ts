import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"

/**
 * SSE client transport that routes requests directly to a Durable Object stub.
 *
 * This bypasses worker-level routing and tests the MCP server DO directly,
 * avoiding URL resolution issues when MCP servers are behind path prefixes
 * (e.g., /mcp/todo/*) in a single-worker architecture.
 */
export class StubSSEClientTransport extends SSEClientTransport {
	private stub: DurableObjectStub

	constructor(url: URL, stub: DurableObjectStub) {
		const fetchOverride: typeof fetch = async (
			fetchUrl: RequestInfo | URL,
			fetchInit: RequestInit = {}
		) => {
			console.log(`[StubTransport] Fetching: ${fetchUrl}`)
			const request = new Request(fetchUrl.toString(), {
				...fetchInit,
				headers: {
					...fetchInit?.headers,
				},
			})
			return await stub.fetch(request)
		}

		super(url, {
			eventSourceInit: {
				fetch: fetchOverride,
			},
		})
		this.stub = stub
	}

	/**
	 * Override send to route POST messages directly to the DO stub
	 */
	async send(message: JSONRPCMessage): Promise<void> {
		console.log(
			`[StubTransport] Sending message: ${JSON.stringify(message)}`
		)
		// @ts-ignore - Accessing private property
		const endpoint = this._endpoint

		if (!endpoint) {
			throw new Error("Not connected")
		}

		try {
			const headers = new Headers()
			headers.set("content-type", "application/json")

			const request = new Request(endpoint.toString(), {
				method: "POST",
				headers,
				body: JSON.stringify(message),
			})

			const response = await this.stub.fetch(request)

			if (!response.ok) {
				const text = await response.text().catch(() => null)
				throw new Error(
					`Error POSTing to endpoint (HTTP ${response.status}): ${text}`
				)
			}
		} catch (error) {
			this.onerror?.(error as Error)
			throw error
		}
	}
}
