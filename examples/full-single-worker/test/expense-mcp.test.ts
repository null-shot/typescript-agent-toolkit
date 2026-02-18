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

describe("Single Worker — ExpenseMcpServer", () => {
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
		const id = env.EXPENSE_MCP.idFromName(sessionId)
		const stub = env.EXPENSE_MCP.get(id)
		return new StubSSEClientTransport(url, stub)
	}

	it("should connect to the ExpenseMcpServer", async () => {
		const transport = createTransport()
		await client.connect(transport)

		await waitOnExecutionContext(ctx)
	})

	it("should return correct server version", async () => {
		const transport = createTransport()
		await client.connect(transport)

		const serverInfo = await client.getServerVersion()
		expect(serverInfo).toBeDefined()
		expect(serverInfo?.name).toBe("ExpenseMcpServer")
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
			"approve_expense",
			"list_expenses",
			"reject_expense",
			"submit_expense",
		])

		await waitOnExecutionContext(ctx)
	})

	it("should submit an expense", async () => {
		const transport = createTransport()
		await client.connect(transport)

		const result = (await client.callTool({
			name: "submit_expense",
			arguments: {
				user: "alice",
				amount: 42.5,
				description: "Team lunch",
			},
		})) as ToolResponse

		expect(result.content).toHaveLength(1)
		expect(result.content[0].type).toBe("text")
		expect(result.content[0].text).toContain("Expense submitted")
		expect(result.content[0].text).toContain("$42.5")
		expect(result.content[0].text).toContain("alice")
		expect(result.content[0].text).toContain("Team lunch")
		expect(result.content[0].text).toContain("pending")

		await waitOnExecutionContext(ctx)
	})

	it("should approve an expense", async () => {
		const transport = createTransport()
		await client.connect(transport)

		// Submit first
		const submitResult = (await client.callTool({
			name: "submit_expense",
			arguments: {
				user: "bob",
				amount: 100,
				description: "Conference ticket",
			},
		})) as ToolResponse

		// Extract id from response
		const idMatch = submitResult.content[0].text.match(/id: ([^\),]+)/)
		expect(idMatch).not.toBeNull()
		const expenseId = idMatch![1]

		// Approve
		const result = (await client.callTool({
			name: "approve_expense",
			arguments: { id: expenseId },
		})) as ToolResponse

		expect(result.content[0].text).toContain("Approved")
		expect(result.content[0].text).toContain("$100")
		expect(result.content[0].text).toContain("bob")

		await waitOnExecutionContext(ctx)
	})

	it("should reject an expense", async () => {
		const transport = createTransport()
		await client.connect(transport)

		// Submit
		const submitResult = (await client.callTool({
			name: "submit_expense",
			arguments: {
				user: "charlie",
				amount: 999,
				description: "Luxury item",
			},
		})) as ToolResponse

		const idMatch = submitResult.content[0].text.match(/id: ([^\),]+)/)
		const expenseId = idMatch![1]

		// Reject
		const result = (await client.callTool({
			name: "reject_expense",
			arguments: { id: expenseId },
		})) as ToolResponse

		expect(result.content[0].text).toContain("Rejected")
		expect(result.content[0].text).toContain("$999")
		expect(result.content[0].text).toContain("charlie")

		await waitOnExecutionContext(ctx)
	})

	it("should list expenses with status breakdown", async () => {
		const transport = createTransport()
		await client.connect(transport)

		// Create some expenses
		const s1 = (await client.callTool({
			name: "submit_expense",
			arguments: { user: "u1", amount: 10, description: "Expense A" },
		})) as ToolResponse

		const s2 = (await client.callTool({
			name: "submit_expense",
			arguments: { user: "u2", amount: 20, description: "Expense B" },
		})) as ToolResponse

		// Approve first one
		const id1Match = s1.content[0].text.match(/id: ([^\),]+)/)
		await client.callTool({
			name: "approve_expense",
			arguments: { id: id1Match![1] },
		})

		// Reject second one
		const id2Match = s2.content[0].text.match(/id: ([^\),]+)/)
		await client.callTool({
			name: "reject_expense",
			arguments: { id: id2Match![1] },
		})

		// List
		const result = (await client.callTool({
			name: "list_expenses",
			arguments: {},
		})) as ToolResponse

		expect(result.content[0].text).toContain("Expenses")
		expect(result.content[0].text).toContain("Total: $30")
		expect(result.content[0].text).toContain("[approved]")
		expect(result.content[0].text).toContain("[rejected]")

		await waitOnExecutionContext(ctx)
	})

	it("should return 'No expenses found' when empty", async () => {
		const transport = createTransport()
		await client.connect(transport)

		const result = (await client.callTool({
			name: "list_expenses",
			arguments: {},
		})) as ToolResponse

		expect(result.content[0].text).toBe("No expenses found.")

		await waitOnExecutionContext(ctx)
	})

	it("should handle approve/reject of non-existent expense", async () => {
		const transport = createTransport()
		await client.connect(transport)

		const approveResult = (await client.callTool({
			name: "approve_expense",
			arguments: { id: "non-existent" },
		})) as ToolResponse
		expect(approveResult.content[0].text).toContain("Expense not found")

		const rejectResult = (await client.callTool({
			name: "reject_expense",
			arguments: { id: "non-existent" },
		})) as ToolResponse
		expect(rejectResult.content[0].text).toContain("Expense not found")

		await waitOnExecutionContext(ctx)
	})
})
