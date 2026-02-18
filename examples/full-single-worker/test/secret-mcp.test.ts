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

describe("Single Worker — SecretMcpServer", () => {
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
		const id = env.SECRET_MCP.idFromName(sessionId)
		const stub = env.SECRET_MCP.get(id)
		return new StubSSEClientTransport(url, stub)
	}

	it("should connect to the SecretMcpServer", async () => {
		const transport = createTransport()
		await client.connect(transport)

		await waitOnExecutionContext(ctx)
	})

	it("should return correct server version", async () => {
		const transport = createTransport()
		await client.connect(transport)

		const serverInfo = await client.getServerVersion()
		expect(serverInfo).toBeDefined()
		expect(serverInfo?.name).toBe("SecretMcpServer")
		expect(serverInfo?.version).toBe("1.0.0")

		await waitOnExecutionContext(ctx)
	})

	it("should list 1 tool: guess_number", async () => {
		const transport = createTransport()
		await client.connect(transport)

		const tools = await client.listTools()
		expect(tools.tools).toHaveLength(1)

		const guessTool = tools.tools[0]
		expect(guessTool.name).toBe("guess_number")
		expect(guessTool.description).toContain("secret number")

		// Verify parameter schema
		const properties = (guessTool.inputSchema as any)?.properties
		expect(properties).toHaveProperty("guess")
		expect(properties.guess.type).toBe("number")

		await waitOnExecutionContext(ctx)
	})

	it("should respond correctly for correct guess (42)", async () => {
		const transport = createTransport()
		await client.connect(transport)

		// SECRET_NUMBER is "42" in wrangler.jsonc vars
		const result = (await client.callTool({
			name: "guess_number",
			arguments: { guess: 42 },
		})) as ToolResponse

		expect(result.content).toHaveLength(1)
		expect(result.content[0].type).toBe("text")
		expect(result.content[0].text).toContain("correct")
		expect(result.content[0].text).toContain("42")

		await waitOnExecutionContext(ctx)
	})

	it("should hint 'Try higher!' for a low guess", async () => {
		const transport = createTransport()
		await client.connect(transport)

		const result = (await client.callTool({
			name: "guess_number",
			arguments: { guess: 10 },
		})) as ToolResponse

		expect(result.content[0].text).toContain("wrong")
		expect(result.content[0].text).toContain("Try higher!")

		await waitOnExecutionContext(ctx)
	})

	it("should hint 'Try lower!' for a high guess", async () => {
		const transport = createTransport()
		await client.connect(transport)

		const result = (await client.callTool({
			name: "guess_number",
			arguments: { guess: 99 },
		})) as ToolResponse

		expect(result.content[0].text).toContain("wrong")
		expect(result.content[0].text).toContain("Try lower!")

		await waitOnExecutionContext(ctx)
	})

	it("should handle edge case guesses", async () => {
		const transport = createTransport()
		await client.connect(transport)

		const testCases = [
			{ guess: 0, expectHigher: true },
			{ guess: -100, expectHigher: true },
			{ guess: 1000, expectHigher: false },
			{ guess: 41, expectHigher: true },
			{ guess: 43, expectHigher: false },
		]

		for (const { guess, expectHigher } of testCases) {
			const result = (await client.callTool({
				name: "guess_number",
				arguments: { guess },
			})) as ToolResponse

			expect(result.content[0].text).toContain("wrong")
			if (expectHigher) {
				expect(result.content[0].text).toContain("Try higher!")
			} else {
				expect(result.content[0].text).toContain("Try lower!")
			}
		}

		await waitOnExecutionContext(ctx)
	})

	it("should return correct guess exactly at 42", async () => {
		const transport = createTransport()
		await client.connect(transport)

		// Test boundary: 41 is wrong, 42 is correct, 43 is wrong
		const result41 = (await client.callTool({
			name: "guess_number",
			arguments: { guess: 41 },
		})) as ToolResponse
		expect(result41.content[0].text).toContain("wrong")

		const result42 = (await client.callTool({
			name: "guess_number",
			arguments: { guess: 42 },
		})) as ToolResponse
		expect(result42.content[0].text).toContain("correct")

		const result43 = (await client.callTool({
			name: "guess_number",
			arguments: { guess: 43 },
		})) as ToolResponse
		expect(result43.content[0].text).toContain("wrong")

		await waitOnExecutionContext(ctx)
	})
})
