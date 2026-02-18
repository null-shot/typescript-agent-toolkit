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

describe("Single Worker — TodoMcpServer", () => {
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
		const id = env.TODO_MCP.idFromName(sessionId)
		const stub = env.TODO_MCP.get(id)
		return new StubSSEClientTransport(url, stub)
	}

	it("should connect to the TodoMcpServer", async () => {
		const transport = createTransport()
		await client.connect(transport)

		await waitOnExecutionContext(ctx)
	})

	it("should return correct server version", async () => {
		const transport = createTransport()
		await client.connect(transport)

		const serverInfo = await client.getServerVersion()
		expect(serverInfo).toBeDefined()
		expect(serverInfo?.name).toBe("TodoMcpServer")
		expect(serverInfo?.version).toBe("1.0.0")

		await waitOnExecutionContext(ctx)
	})

	it("should list 4 tools", async () => {
		const transport = createTransport()
		await client.connect(transport)

		const tools = await client.listTools()
		expect(tools.tools).toHaveLength(4)

		const names = tools.tools.map((t) => t.name).sort()
		expect(names).toEqual([
			"complete_todo",
			"create_todo",
			"delete_todo",
			"list_todos",
		])

		await waitOnExecutionContext(ctx)
	})

	it("should create a todo", async () => {
		const transport = createTransport()
		await client.connect(transport)

		const result = (await client.callTool({
			name: "create_todo",
			arguments: { text: "Buy groceries" },
		})) as ToolResponse

		expect(result.content).toHaveLength(1)
		expect(result.content[0].type).toBe("text")
		expect(result.content[0].text).toContain("Created todo: Buy groceries")
		expect(result.content[0].text).toContain("id:")

		await waitOnExecutionContext(ctx)
	})

	it("should list todos after creating one", async () => {
		const transport = createTransport()
		await client.connect(transport)

		// Create a todo first
		await client.callTool({
			name: "create_todo",
			arguments: { text: "Test listing" },
		})

		const result = (await client.callTool({
			name: "list_todos",
			arguments: {},
		})) as ToolResponse

		expect(result.content).toHaveLength(1)
		expect(result.content[0].text).toContain("Todos:")
		expect(result.content[0].text).toContain("Test listing")

		await waitOnExecutionContext(ctx)
	})

	it("should return 'No todos found' when empty", async () => {
		const transport = createTransport()
		await client.connect(transport)

		const result = (await client.callTool({
			name: "list_todos",
			arguments: {},
		})) as ToolResponse

		expect(result.content[0].text).toBe("No todos found.")

		await waitOnExecutionContext(ctx)
	})

	it("should complete a todo", async () => {
		const transport = createTransport()
		await client.connect(transport)

		// Create a todo
		const createResult = (await client.callTool({
			name: "create_todo",
			arguments: { text: "Complete me" },
		})) as ToolResponse

		// Extract ID from "Created todo: Complete me (id: <uuid>)"
		const idMatch = createResult.content[0].text.match(/id: ([^\)]+)/)
		expect(idMatch).not.toBeNull()
		const todoId = idMatch![1]

		// Complete the todo
		const result = (await client.callTool({
			name: "complete_todo",
			arguments: { id: todoId },
		})) as ToolResponse

		expect(result.content[0].text).toContain("Completed: Complete me")

		// Verify in list
		const listResult = (await client.callTool({
			name: "list_todos",
			arguments: {},
		})) as ToolResponse
		expect(listResult.content[0].text).toContain("[x]")

		await waitOnExecutionContext(ctx)
	})

	it("should handle completing non-existent todo", async () => {
		const transport = createTransport()
		await client.connect(transport)

		const result = (await client.callTool({
			name: "complete_todo",
			arguments: { id: "non-existent-id" },
		})) as ToolResponse

		expect(result.content[0].text).toContain("Todo not found")

		await waitOnExecutionContext(ctx)
	})

	it("should delete a todo", async () => {
		const transport = createTransport()
		await client.connect(transport)

		// Create a todo
		const createResult = (await client.callTool({
			name: "create_todo",
			arguments: { text: "Delete me" },
		})) as ToolResponse

		const idMatch = createResult.content[0].text.match(/id: ([^\)]+)/)
		const todoId = idMatch![1]

		// Delete
		const result = (await client.callTool({
			name: "delete_todo",
			arguments: { id: todoId },
		})) as ToolResponse

		expect(result.content[0].text).toContain("Deleted: Delete me")

		// Verify deleted
		const listResult = (await client.callTool({
			name: "list_todos",
			arguments: {},
		})) as ToolResponse
		expect(listResult.content[0].text).toBe("No todos found.")

		await waitOnExecutionContext(ctx)
	})

	it("should handle deleting non-existent todo", async () => {
		const transport = createTransport()
		await client.connect(transport)

		const result = (await client.callTool({
			name: "delete_todo",
			arguments: { id: "non-existent-id" },
		})) as ToolResponse

		expect(result.content[0].text).toContain("Todo not found")

		await waitOnExecutionContext(ctx)
	})

	it("should persist todos across tool calls in same session", async () => {
		const transport = createTransport()
		await client.connect(transport)

		// Create multiple todos
		await client.callTool({
			name: "create_todo",
			arguments: { text: "Todo A" },
		})
		await client.callTool({
			name: "create_todo",
			arguments: { text: "Todo B" },
		})
		await client.callTool({
			name: "create_todo",
			arguments: { text: "Todo C" },
		})

		const result = (await client.callTool({
			name: "list_todos",
			arguments: {},
		})) as ToolResponse

		expect(result.content[0].text).toContain("Todo A")
		expect(result.content[0].text).toContain("Todo B")
		expect(result.content[0].text).toContain("Todo C")

		await waitOnExecutionContext(ctx)
	})
})
