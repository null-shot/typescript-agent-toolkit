import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { WorkerStreamableHTTPClientTransport } from "@nullshot/test-utils/mcp/WorkerStreamableHTTPClientTransport";
import { Expense } from "../src/repository";

// Define response type for clarity
interface ToolResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
  expense?: Expense;
  expenses?: Expense[];
}

describe("Expense MCP Client Integration Tests", () => {
  const baseUrl = "http://localhost";
  let client: Client;
  let ctx: ExecutionContext;
  // Store expenses created in tests
  let testExpenses: { [key: string]: string } = {};

  beforeEach(async () => {
    console.log(`--------- STARTING EXPENSE MCP TEST ---------`);
    ctx = createExecutionContext();

    client = new Client({
      name: "test-client",
      version: "1.0.0",
    });

    console.log(`Created MCP Client for Expense testing`);
  });

  afterEach(async () => {
    console.log(`--------- ENDING EXPENSE MCP TEST ---------`);
    try {
      // Only call close if client is properly initialized
      if (client && typeof client.close === "function") {
        await client.close();
        console.log(`Client closed successfully`);
      }
    } catch (err) {
      console.warn(`Error closing client:`, err);
    }
  });

  function createTransport(ctx: ExecutionContext) {
    const url = new URL(`${baseUrl}/mcp`);
    return new WorkerStreamableHTTPClientTransport(url, ctx);
  }

  it("should initialize the client properly", () => {
    expect(client).toBeDefined();
    const clientOptions = client.constructor.name;
    expect(clientOptions).toBe("Client");
  });

  it("should successfully connect to the expense MCP server", async () => {
    console.log(`Testing StreamableHTTP transport connection`);

    const transport = createTransport(ctx);
    await client.connect(transport);

    await waitOnExecutionContext(ctx);
    console.log(`Client connection test passed!`);
  });

  it("should return server version matching the implementation", async () => {
    console.log(`Testing server version`);

    const transport = createTransport(ctx);
    await client.connect(transport);

    const serverInfo = await client.getServerVersion();

    expect(serverInfo).not.toBeUndefined();

    if (serverInfo) {
      expect(serverInfo.name).toBe("ExpenseMcpServer");
      expect(serverInfo.version).toBe("1.0.0");
    }

    await waitOnExecutionContext(ctx);
    console.log(`Server version test passed!`);
  });

  it("should submit a new expense", async () => {
    const transport = createTransport(ctx);
    await client.connect(transport);

    const response = (await client.callTool({
      name: "submitExpense",
      arguments: {
        user: "testuser",
        amount: 50.0,
        description: "Test lunch expense",
      },
    })) as ToolResponse;

    expect(response).not.toBeUndefined();
    expect(Array.isArray(response.content)).toBe(true);
    expect(response.content.length).toBeGreaterThan(0);

    const firstContent = response.content[0];
    expect(firstContent.type).toBe("text");
    expect(firstContent.text).toContain(
      "Expense submitted successfully with ID:"
    );

    // Extract expense ID for later tests
    const idMatch = firstContent.text.match(/ID: (.+)/);
    if (idMatch) {
      testExpenses.mainExpense = idMatch[1];
    }

    await waitOnExecutionContext(ctx);
    console.log(`Submit expense test passed!`);
  });

  it("should approve an expense", async () => {
    const transport = createTransport(ctx);
    await client.connect(transport);

    // First submit an expense
    const submitResponse = (await client.callTool({
      name: "submitExpense",
      arguments: {
        user: "testuser",
        amount: 75.0,
        description: "Test approval expense",
      },
    })) as ToolResponse;

    const idMatch = submitResponse.content[0].text.match(/ID: (.+)/);
    const expenseId = idMatch![1];

    // Now approve it
    const response = (await client.callTool({
      name: "approveExpense",
      arguments: {
        id: expenseId,
      },
    })) as ToolResponse;

    expect(response).not.toBeUndefined();
    expect(response.content[0].text).toContain(
      `Expense ${expenseId} approved successfully`
    );

    await waitOnExecutionContext(ctx);
    console.log(`Approve expense test passed!`);
  });

  it("should reject an expense", async () => {
    const transport = createTransport(ctx);
    await client.connect(transport);

    // First submit an expense
    const submitResponse = (await client.callTool({
      name: "submitExpense",
      arguments: {
        user: "testuser",
        amount: 100.0,
        description: "Test rejection expense",
      },
    })) as ToolResponse;

    const idMatch = submitResponse.content[0].text.match(/ID: (.+)/);
    const expenseId = idMatch![1];

    // Now reject it
    const response = (await client.callTool({
      name: "rejectExpense",
      arguments: {
        id: expenseId,
      },
    })) as ToolResponse;

    expect(response).not.toBeUndefined();
    expect(response.content[0].text).toContain(
      `Expense ${expenseId} rejected successfully`
    );

    await waitOnExecutionContext(ctx);
    console.log(`Reject expense test passed!`);
  });

  it("should list all expenses", async () => {
    const transport = createTransport(ctx);
    await client.connect(transport);

    // Submit a few expenses first
    await client.callTool({
      name: "submitExpense",
      arguments: { user: "user1", amount: 25.0, description: "Expense 1" },
    });

    await client.callTool({
      name: "submitExpense",
      arguments: { user: "user2", amount: 35.0, description: "Expense 2" },
    });

    // Now list them
    const response = (await client.callTool({
      name: "listExpenses",
      arguments: {},
    })) as ToolResponse;

    expect(response).not.toBeUndefined();
    expect(response.content[0].text).toContain("Found");
    expect(response.content[0].text).toContain("expenses:");

    await waitOnExecutionContext(ctx);
    console.log(`List expenses test passed!`);
  });

  it("should handle non-existent expense operations", async () => {
    const transport = createTransport(ctx);
    await client.connect(transport);

    const nonExistentId = "non-existent-id";

    // Try to approve non-existent expense
    const approveResponse = (await client.callTool({
      name: "approveExpense",
      arguments: {
        id: nonExistentId,
      },
    })) as ToolResponse;

    expect(approveResponse.content[0].text).toContain(
      `Expense with ID ${nonExistentId} not found`
    );

    await waitOnExecutionContext(ctx);
    console.log(`Non-existent expense test passed!`);
  });
});
