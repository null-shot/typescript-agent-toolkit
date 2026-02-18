import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
} from "cloudflare:test"
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StubSSEClientTransport } from "./stub-sse-transport"

interface ToolResponse {
	content: Array<{
		type: string
		text: string
	}>
}

describe("Single Worker — EnvVariableMcpServer", () => {
	let client: Client
	let ctx: ExecutionContext

	beforeEach(async () => {
		ctx = createExecutionContext()
		client = new Client({ name: "test-client", version: "1.0.0" })
	})

	afterEach(async () => {
		try {
			if (client && typeof client.close === "function") {
				await client.close()
			}
		} catch {
			// ignore close errors
		}
	})

	function createTransport() {
		const sessionId = crypto.randomUUID()
		const url = new URL(`http://localhost/sse?sessionId=${sessionId}`)
		const id = env.ENV_VARIABLE_MCP.idFromName(sessionId)
		const stub = env.ENV_VARIABLE_MCP.get(id)
		return new StubSSEClientTransport(url, stub)
	}

	it("should connect to the EnvVariableMcpServer", async () => {
		const transport = createTransport()
		await client.connect(transport)

		await waitOnExecutionContext(ctx)
	})

	it("should return correct server version", async () => {
		const transport = createTransport()
		await client.connect(transport)

		const serverInfo = await client.getServerVersion()
		expect(serverInfo).toBeDefined()
		expect(serverInfo?.name).toBe("EnvVariableMcpServer")
		expect(serverInfo?.version).toBe("1.0.0")

		await waitOnExecutionContext(ctx)
	})

	it("should list 1 tool: greeting", async () => {
		const transport = createTransport()
		await client.connect(transport)

		const tools = await client.listTools()
		expect(tools.tools).toHaveLength(1)

		const greetingTool = tools.tools[0]
		expect(greetingTool.name).toBe("greeting")
		expect(greetingTool.description).toContain("greeting")

		await waitOnExecutionContext(ctx)
	})

	it("should greet with DEFAULT_NAME env var when no name provided", async () => {
		const transport = createTransport()
		await client.connect(transport)

		const result = (await client.callTool({
			name: "greeting",
			arguments: {},
		})) as ToolResponse

		expect(result.content).toHaveLength(1)
		expect(result.content[0].type).toBe("text")
		// DEFAULT_NAME is set to "World" in wrangler.jsonc vars
		expect(result.content[0].text).toBe("Hello World!")

		await waitOnExecutionContext(ctx)
	})

	it("should greet with custom name when provided", async () => {
		const transport = createTransport()
		await client.connect(transport)

		const result = (await client.callTool({
			name: "greeting",
			arguments: { name: "Alice" },
		})) as ToolResponse

		expect(result.content).toHaveLength(1)
		expect(result.content[0].type).toBe("text")
		expect(result.content[0].text).toBe("Hello Alice!")

		await waitOnExecutionContext(ctx)
	})

	it("should greet with different custom names", async () => {
		const transport = createTransport()
		await client.connect(transport)

		const names = ["Bob", "Charlie", "Diana"]

		for (const name of names) {
			const result = (await client.callTool({
				name: "greeting",
				arguments: { name },
			})) as ToolResponse

			expect(result.content[0].text).toBe(`Hello ${name}!`)
		}

		await waitOnExecutionContext(ctx)
	})
})
