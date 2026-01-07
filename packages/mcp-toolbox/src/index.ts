import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import WebSocket from "ws";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebSocketTransport } from "@nullshot/mcp/dist/mcp/websocket-transport.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createPackageRepository,
  PackageRepository,
} from "./persistence/index.js";

// Environment configuration
const PORT = parseInt(process.env.PORT || "11990");
const DB_PATH = process.env.DB_PATH || "./data/packages.db";

// Parse command line arguments for proxyId and MCP proxy URL
const args = process.argv.slice(2);

// Extract proxyId from command line or environment
const proxyIdArgIndex = args.findIndex(
  (arg) => arg === "--proxy-id" || arg === "-p"
);
const PROXY_ID =
  proxyIdArgIndex !== -1 && args[proxyIdArgIndex + 1]
    ? args[proxyIdArgIndex + 1]
    : process.env.PROXY_ID;

// Extract mcp-server-host from command line or environment
const mcpServerHostArgIndex = args.findIndex(
  (arg) => arg === "--mcp-server-host"
);
const MCP_SERVER_HOST =
  mcpServerHostArgIndex !== -1 && args[mcpServerHostArgIndex + 1]
    ? args[mcpServerHostArgIndex + 1]
    : process.env.MCP_SERVER_HOST || "localhost:6050";

if (!PROXY_ID) {
  console.error("❌ ERROR: proxyId is required!");
  console.error("Please provide a proxyId using one of these methods:");
  console.error("  1. Command line: --proxy-id YOUR_UUID_HERE");
  console.error("  2. Environment variable: PROXY_ID=YOUR_UUID_HERE");
  console.error("");
  console.error(
    "Example: node dist/index.js --proxy-id 12345678-1234-1234-1234-123456789abc"
  );
  console.error("");
  console.error("Optional arguments:");
  console.error(
    "  --mcp-server-host HOST:PORT   Set MCP server host (default: localhost:6050)"
  );
  process.exit(1);
}

// Construct MCP_PROXY_URL with proxyId and configurable host
const BASE_MCP_PROXY_URL =
  process.env.MCP_PROXY_URL || `ws://${MCP_SERVER_HOST}/remote-container/ws`;
const url = new URL(BASE_MCP_PROXY_URL);
url.searchParams.set("proxyId", PROXY_ID);
const MCP_PROXY_URL = url.toString();

console.log(`🔗 Using proxyId: ${PROXY_ID}`);
console.log(`🔗 MCP Server Host: ${MCP_SERVER_HOST}`);
console.log(`🔗 MCP Proxy URL: ${MCP_PROXY_URL}`);

// Ensure data directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

// Initialize package repository
const packageRepo: PackageRepository = createPackageRepository(
  "sqlite",
  DB_PATH
);

// MCP Client Management
const mcpClients = new Map<string, Client>();

// Validation schemas
const AddRequestSchema = z.object({
  "unique-name": z.string().min(1, "unique-name is required"),
  command: z.string().min(1, "command is required"),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string(), z.string()).optional().default({}),
});

const DeleteRequestSchema = z.object({
  "unique-name": z.string().min(1, "unique-name is required"),
});

const UpdateRequestSchema = z.object({
  "unique-name": z.string().min(1, "unique-name is required"),
  command: z.string().min(1, "command is required"),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string(), z.string()).optional().default({}),
});

const WebSocketMessageSchema = z.object({
  verb: z.enum(["add", "delete", "update", "list"]),
  data: z.any().optional(),
});

// Enhanced message type detection schemas
const McpMessageSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().optional(),
  params: z.any().optional(),
  result: z.any().optional(),
  error: z.any().optional(),
});

const AdminVerbMessageSchema = z.object({
  verb: z.enum(["add", "delete", "update", "list"]),
  data: z.any().optional(),
  timestamp: z.string().optional(),
  clientId: z.string().optional(),
});

// Message type detection functions
function isMcpMessage(message: any): boolean {
  try {
    McpMessageSchema.parse(message);
    return true;
  } catch {
    return false;
  }
}

function isAdminVerbMessage(message: any): boolean {
  try {
    AdminVerbMessageSchema.parse(message);
    return true;
  } catch {
    return false;
  }
}

// Helper function to connect to an MCP server and maintain persistent connection
async function connectToMcpServer(
  uniqueName: string,
  command: string,
  args: string[],
  env: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  try {
    // Create transport with environment variables
    const transport = new StdioClientTransport({
      command,
      args,
      env: { ...(process.env as Record<string, string>), ...env },
    });

    // Create client
    const client = new Client({
      name: `mcp-proxy-client-${uniqueName}`,
      version: "1.0.0",
    });

    // Connect
    await client.connect(transport);

    // Store the client for later use
    mcpClients.set(uniqueName, client);

    console.log(`✅ Connected to MCP server: ${uniqueName}`);
    return { success: true };
  } catch (error) {
    console.error(`❌ Failed to connect to MCP server ${uniqueName}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

// Helper function to disconnect from an MCP server
async function disconnectFromMcpServer(uniqueName: string): Promise<void> {
  const client = mcpClients.get(uniqueName);
  if (client) {
    try {
      await client.close();
      mcpClients.delete(uniqueName);
      console.log(`🔌 Disconnected from MCP server: ${uniqueName}`);
    } catch (error) {
      console.warn(`⚠️ Error disconnecting from ${uniqueName}:`, error);
      mcpClients.delete(uniqueName); // Remove it anyway
    }
  }
}

// Helper function to test MCP server connection (temporary, for validation)
async function testMcpServerConnection(
  command: string,
  args: string[],
  env: Record<string, string>,
  timeoutMs = 100000
) {
  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;

  try {
    // Create transport with environment variables
    transport = new StdioClientTransport({
      command,
      args,
      env: { ...(process.env as Record<string, string>), ...env },
    });

    // Create client
    client = new Client({
      name: "mcp-server-tester",
      version: "1.0.0",
    });

    // Connect with timeout
    const connectPromise = client.connect(transport);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Connection timeout after ${timeoutMs}ms`)),
        timeoutMs
      )
    );

    await Promise.race([connectPromise, timeoutPromise]);

    // Test the connection by listing capabilities
    const [toolsResult, resourcesResult, promptsResult] =
      await Promise.allSettled([
        client.listTools().catch(() => ({ tools: [] })),
        client.listResources().catch(() => ({ resources: [] })),
        client.listPrompts().catch(() => ({ prompts: [] })),
      ]);

    // Extract results
    const tools =
      toolsResult.status === "fulfilled" ? toolsResult.value.tools : [];
    const resources =
      resourcesResult.status === "fulfilled"
        ? resourcesResult.value.resources
        : [];
    const prompts =
      promptsResult.status === "fulfilled" ? promptsResult.value.prompts : [];

    return {
      success: true,
      capabilities: {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
        })),
        resources: resources.map((resource) => ({
          name: resource.name,
          description: resource.description,
          uri: resource.uri,
        })),
        prompts: prompts.map((prompt) => ({
          name: prompt.name,
          description: prompt.description,
        })),
      },
      totalCapabilities: tools.length + resources.length + prompts.length,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unknown connection error",
      capabilities: null,
      totalCapabilities: 0,
    };
  } finally {
    // Clean up connections
    try {
      if (client) {
        await client.close();
      }
      if (transport) {
        await transport.close();
      }
    } catch (cleanupError) {
      console.warn("Error during cleanup:", cleanupError);
    }
  }
}

// Initialize existing servers from database
async function initializeExistingServers() {
  try {
    const packages = await packageRepo.findAll();
    console.log(`🔄 Initializing ${packages.length} existing MCP servers...`);

    for (const pkg of packages) {
      console.log(
        `🔄 Connecting to ${pkg.uniqueName}: ${pkg.command} ${pkg.args.join(
          " "
        )}`
      );
      const result = await connectToMcpServer(
        pkg.uniqueName,
        pkg.command,
        pkg.args,
        pkg.env
      );

      if (!result.success) {
        console.warn(
          `⚠️ Failed to connect to existing server ${pkg.uniqueName}: ${result.error}`
        );
      } else {
        console.log(`✅ Successfully connected to ${pkg.uniqueName}`);

        // Test the connection by listing tools
        try {
          const client = mcpClients.get(pkg.uniqueName);
          if (client) {
            console.log(`🔍 Testing tools list for ${pkg.uniqueName}...`);
            const toolsResponse = await client.listTools();
            console.log(
              `🔍 ${pkg.uniqueName} has ${toolsResponse.tools.length} tools:`,
              toolsResponse.tools.map((t) => t.name)
            );
          }
        } catch (error) {
          console.warn(`⚠️ Error testing tools for ${pkg.uniqueName}:`, error);
        }
      }
    }

    console.log(
      `✅ Initialized ${mcpClients.size}/${packages.length} MCP servers`
    );
    console.log(`🔍 Active MCP clients:`, Array.from(mcpClients.keys()));
  } catch (error) {
    console.error("❌ Error initializing existing servers:", error);
  }
}

// WebSocket message handlers
async function handleAddCommand(data: any) {
  try {
    const validatedData = AddRequestSchema.parse(data);

    // Check if package already exists
    const existing = await packageRepo.findByUniqueName(
      validatedData["unique-name"]
    );
    if (existing) {
      return {
        success: false,
        error: `Package with unique-name '${validatedData["unique-name"]}' already exists`,
      };
    }

    console.log(
      `Testing MCP server connection: ${validatedData.command}`,
      validatedData.args
    );

    // Test MCP server connection before storing
    const connectionTest = await testMcpServerConnection(
      validatedData.command,
      validatedData.args,
      validatedData.env as Record<string, string>
    );

    if (!connectionTest.success) {
      console.error(
        `MCP server connection failed for ${validatedData["unique-name"]}:`,
        connectionTest.error
      );
      return {
        success: false,
        error: "Failed to connect to MCP server",
        details: connectionTest.error,
        message:
          "The MCP server could not be reached or is not responding correctly.",
      };
    }

    // If we have no capabilities at all, it might not be a valid MCP server
    if (connectionTest.totalCapabilities === 0) {
      console.warn(
        `MCP server ${validatedData["unique-name"]} connected but has no capabilities`
      );
      return {
        success: false,
        error: "MCP server has no capabilities",
        message:
          "The server connected successfully but does not expose any tools, resources, or prompts.",
      };
    }

    // Connection successful, store in database
    const pkg = await packageRepo.create({
      uniqueName: validatedData["unique-name"],
      command: validatedData.command,
      args: validatedData.args,
      env: validatedData.env as Record<string, string>,
    });

    // Create persistent connection for proxy functionality
    const connectionResult = await connectToMcpServer(
      pkg.uniqueName,
      pkg.command,
      pkg.args,
      pkg.env
    );

    if (!connectionResult.success) {
      console.warn(
        `⚠️ Failed to create persistent connection for ${pkg.uniqueName}: ${connectionResult.error}`
      );
    }

    console.log(`Successfully added MCP server: ${pkg.uniqueName}`);

    return {
      success: true,
      message: `MCP server '${pkg.uniqueName}' added successfully`,
      data: {
        id: pkg.id,
        name: pkg.uniqueName,
        command: pkg.command,
        args: pkg.args,
        env: Object.keys(pkg.env),
        installedAt: pkg.installedAt,
      },
      capabilities: connectionTest.capabilities,
      totalCapabilities: connectionTest.totalCapabilities,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: "Validation failed",
        details: error.issues,
      };
    }

    console.error("Add command error:", error);
    return {
      success: false,
      error: "Internal server error",
    };
  }
}

async function handleUpdateCommand(data: any) {
  try {
    const validatedData = UpdateRequestSchema.parse(data);

    // Check if package exists
    const existing = await packageRepo.findByUniqueName(
      validatedData["unique-name"]
    );
    if (!existing) {
      return {
        success: false,
        error: `Package with unique-name '${validatedData["unique-name"]}' not found`,
      };
    }

    console.log(
      `Testing updated MCP server connection: ${validatedData.command}`,
      validatedData.args
    );

    // Test new MCP server configuration before updating
    const connectionTest = await testMcpServerConnection(
      validatedData.command,
      validatedData.args,
      validatedData.env as Record<string, string>
    );

    if (!connectionTest.success) {
      console.error(
        `Updated MCP server connection failed for ${validatedData["unique-name"]}:`,
        connectionTest.error
      );
      return {
        success: false,
        error: "Failed to connect to MCP server with new configuration",
        details: connectionTest.error,
        message:
          "The updated MCP server configuration could not be reached or is not responding correctly.",
      };
    }

    // If we have no capabilities at all, it might not be a valid MCP server
    if (connectionTest.totalCapabilities === 0) {
      console.warn(
        `Updated MCP server ${validatedData["unique-name"]} connected but has no capabilities`
      );
      return {
        success: false,
        error: "Updated MCP server has no capabilities",
        message:
          "The server connected successfully but does not expose any tools, resources, or prompts.",
      };
    }

    // Disconnect from the old configuration
    await disconnectFromMcpServer(validatedData["unique-name"]);

    // Update in database
    const updatedPkg = await packageRepo.updateByUniqueName(
      validatedData["unique-name"],
      {
        command: validatedData.command,
        args: validatedData.args,
        env: validatedData.env as Record<string, string>,
      }
    );

    if (!updatedPkg) {
      return {
        success: false,
        error: `Failed to update package '${validatedData["unique-name"]}' in database`,
      };
    }

    // Create new persistent connection with updated configuration
    const connectionResult = await connectToMcpServer(
      updatedPkg.uniqueName,
      updatedPkg.command,
      updatedPkg.args,
      updatedPkg.env
    );

    if (!connectionResult.success) {
      console.warn(
        `⚠️ Failed to create persistent connection for updated ${updatedPkg.uniqueName}: ${connectionResult.error}`
      );
    }

    console.log(`Successfully updated MCP server: ${updatedPkg.uniqueName}`);

    return {
      success: true,
      message: `MCP server '${updatedPkg.uniqueName}' updated successfully`,
      data: {
        id: updatedPkg.id,
        name: updatedPkg.uniqueName,
        command: updatedPkg.command,
        args: updatedPkg.args,
        env: Object.keys(updatedPkg.env),
        updatedAt: new Date().toISOString(),
      },
      capabilities: connectionTest.capabilities,
      totalCapabilities: connectionTest.totalCapabilities,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: "Validation failed",
        details: error.issues,
      };
    }

    console.error("Update command error:", error);
    return {
      success: false,
      error: "Internal server error",
    };
  }
}

async function handleDeleteCommand(data: any) {
  try {
    const validatedData = DeleteRequestSchema.parse(data);

    // Disconnect from the MCP server first
    await disconnectFromMcpServer(validatedData["unique-name"]);

    const removed = await packageRepo.deleteByUniqueName(
      validatedData["unique-name"]
    );

    if (!removed) {
      return {
        success: false,
        error: `Package with unique-name '${validatedData["unique-name"]}' not found`,
      };
    }

    console.log(`Removed package: ${validatedData["unique-name"]}`);

    return {
      success: true,
      message: `Package '${validatedData["unique-name"]}' removed successfully`,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: "Validation failed",
        details: error.issues,
      };
    }

    console.error("Delete command error:", error);
    return {
      success: false,
      error: "Internal server error",
    };
  }
}

async function handleListCommand() {
  try {
    const packages = await packageRepo.findAll();
    const count = await packageRepo.count();

    return {
      success: true,
      data: packages.map((pkg) => ({
        id: pkg.id,
        name: pkg.uniqueName,
        command: pkg.command,
        args: pkg.args,
        env: Object.keys(pkg.env),
        installedAt: pkg.installedAt,
        connected: mcpClients.has(pkg.uniqueName),
      })),
      count,
    };
  } catch (error) {
    console.error("List command error:", error);
    return {
      success: false,
      error: "Internal server error",
    };
  }
}

// Initialize Hono app
const app = new Hono();

// Add CORS middleware to allow cross-origin requests
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Health check endpoint
app.get("/", (c) => {
  return c.json({
    status: "ok",
    message: "MCP WebSocket Server",
    websocket: `ws://localhost:${PORT}/ws`,
    version: "0.1.0",
    activeServers: mcpClients.size,
  });
});

// Dedicated health endpoint for monitoring/load balancers
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    message: "pong",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    proxyId: PROXY_ID,
    mcpProxyConnected: globalWs?.readyState === WebSocket.OPEN,
    activeServers: mcpClients.size,
  });
});

// Global WebSocket instance to prevent multiple connections
let globalWs: WebSocket | null = null;
let isConnecting = false;

// Operation lock to prevent race conditions
let operationInProgress = false;
let operationType: string | null = null;

// Enhanced admin verb message handler
async function handleAdminVerbMessage(messageData: any, ws: WebSocket) {
  try {
    // Validate message structure
    const validatedMessage = AdminVerbMessageSchema.parse(messageData);

    // Check if we should defer list requests during add/delete operations
    if (validatedMessage.verb === "list" && operationInProgress) {
      console.log(
        `⏳ Deferring list request - ${operationType} operation in progress`
      );
      // Don't process list requests while add/delete is in progress
      // The auto-sent list after the operation will provide the updated state
      return;
    }

    let result: any;

    // Handle different verbs
    switch (validatedMessage.verb) {
      case "add":
        operationInProgress = true;
        operationType = "add";
        console.log("🔒 Starting add operation - locking list requests");
        try {
          result = await handleAddCommand(validatedMessage.data);
        } finally {
          operationInProgress = false;
          operationType = null;
          console.log("🔓 Add operation completed - unlocking list requests");
        }
        break;
      case "update":
        operationInProgress = true;
        operationType = "update";
        console.log("🔒 Starting update operation - locking list requests");
        try {
          result = await handleUpdateCommand(validatedMessage.data);
        } finally {
          operationInProgress = false;
          operationType = null;
          console.log(
            "🔓 Update operation completed - unlocking list requests"
          );
        }
        break;
      case "delete":
        operationInProgress = true;
        operationType = "delete";
        console.log("🔒 Starting delete operation - locking list requests");
        try {
          result = await handleDeleteCommand(validatedMessage.data);
        } finally {
          operationInProgress = false;
          operationType = null;
          console.log(
            "🔓 Delete operation completed - unlocking list requests"
          );
        }
        break;
      case "list":
        result = await handleListCommand();
        break;
      default:
        result = {
          success: false,
          error: `Unknown verb: ${validatedMessage.verb}`,
        };
    }

    // Send response back to MCP proxy with error handling
    if (ws.readyState !== WebSocket.OPEN) {
      console.warn(
        "⚠️ Cannot send response - WebSocket not open, readyState:",
        ws.readyState
      );
      console.log("🔄 Triggering reconnection due to closed WebSocket");
      setTimeout(() => connectToMcpProxy(), 100);
      return;
    }

    try {
      ws.send(
        JSON.stringify({
          verb: validatedMessage.verb,
          ...result,
          timestamp: new Date().toISOString(),
        })
      );
      console.log("📤 Sent admin response to MCP proxy");
    } catch (error) {
      console.error("❌ Failed to send admin response to MCP proxy:", error);
      console.log("🔄 Connection may be broken, attempting reconnect...");
      // Trigger immediate reconnection
      setTimeout(() => connectToMcpProxy(), 100);
      return; // Don't try to send auto-updated list if initial send failed
    }

    // Auto-send updated list after successful add/update/delete operations
    if (
      (validatedMessage.verb === "add" ||
        validatedMessage.verb === "update" ||
        validatedMessage.verb === "delete") &&
      result.success
    ) {
      console.log(
        "🔄 Auto-sending updated server list after successful",
        validatedMessage.verb
      );

      if (ws.readyState !== WebSocket.OPEN) {
        console.warn(
          "⚠️ Cannot send auto-updated list - WebSocket not open, readyState:",
          ws.readyState
        );
        console.log(
          "🔄 Triggering reconnection due to closed WebSocket during list update"
        );
        setTimeout(() => connectToMcpProxy(), 100);
        return;
      }

      try {
        const listResult = await handleListCommand();
        ws.send(
          JSON.stringify({
            verb: "list",
            ...listResult,
            timestamp: new Date().toISOString(),
          })
        );
        console.log("📤 Sent auto-updated server list");
      } catch (error) {
        console.error("❌ Error sending auto-updated list:", error);
        console.log(
          "🔄 Connection may be broken during list update, attempting reconnect..."
        );
        // Trigger immediate reconnection
        setTimeout(() => connectToMcpProxy(), 100);
      }
    }
  } catch (error) {
    console.error(
      "❌ Error processing admin verb message from MCP proxy:",
      error
    );

    let errorMessage = "Failed to process admin command";
    let details = undefined;

    if (error instanceof z.ZodError) {
      errorMessage = "Invalid admin message format";
      details = error.issues;
    }

    ws.send(
      JSON.stringify({
        success: false,
        error: errorMessage,
        details,
        timestamp: new Date().toISOString(),
      })
    );
  }
}

// Updated connectToMcpProxy function with enhanced message handling
async function connectToMcpProxy() {
  if (isConnecting) {
    console.log("⚠️ Connection already in progress, skipping...");
    return;
  }

  if (globalWs && globalWs.readyState === WebSocket.OPEN) {
    console.log("⚠️ Already connected to MCP proxy, skipping...");
    return;
  }

  let transport: any = null; // Declare at function scope

  try {
    isConnecting = true;
    console.log(`Connecting to MCP proxy at: ${MCP_PROXY_URL}`);
    console.log(`💾 Database: ${DB_PATH}`);

    const ws = new WebSocket(MCP_PROXY_URL);
    globalWs = ws;

    ws.on("open", () => {
      isConnecting = false;
      console.log("✅ Connected to MCP proxy server");
      console.log("🔍 WebSocket readyState:", ws.readyState);

      const mcpServer = new Server(
        {
          name: "mcp-proxy-server",
          version: "1.0.0",
        },
        {
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
          },
        }
      );

      setupMcpServerHandlers(mcpServer);

      transport = new WebSocketTransport(ws as any, PROXY_ID!);

      console.log("🔍 Connecting MCP server to transport...");
      mcpServer.connect(transport);
      console.log("🔍 MCP server connected to transport");

      // Add logging to the transport to see message flow
      const originalSend = transport.send;
      transport.send = function (message: any) {
        const isRequest = "method" in message;
        const isResponse = "result" in message || "error" in message;

        console.log("📤 Transport sending message:", {
          messageType: isRequest
            ? "request"
            : isResponse
              ? "response"
              : "unknown",
          method: "method" in message ? message.method : undefined,
          id: "id" in message ? message.id : undefined,
          hasResult: "result" in message && !!message.result,
          hasError: "error" in message && !!message.error,
          resultType: "result" in message ? typeof message.result : undefined,
          resultToolsCount:
            "result" in message && message.result && message.result.tools
              ? message.result.tools.length
              : undefined,
        });

        // Log the actual message being sent (truncated for readability)
        const messageStr = JSON.stringify(message);
        console.log(
          "📤 Actual message being sent:",
          messageStr.substring(0, 300) + (messageStr.length > 300 ? "..." : "")
        );

        return originalSend.call(this, message);
      };

      // Add error handling to the server
      mcpServer.onerror = (error: any) => {
        console.error("❌ MCP Server error:", error);
      };

      // Send initial identification message
      ws.send(
        JSON.stringify({
          type: "client_ready",
          clientId: "mcp-package-manager",
          timestamp: new Date().toISOString(),
        })
      );
    });

    ws.on("message", async (data: Buffer) => {
      let messageData: any;

      try {
        messageData = JSON.parse(data.toString());
      } catch (error) {
        console.error("❌ Failed to parse WebSocket message as JSON:", error);
        ws.send(
          JSON.stringify({
            success: false,
            error: "Invalid JSON format",
            timestamp: new Date().toISOString(),
          })
        );
        return;
      }

      console.log("📨 Received message from MCP proxy:", messageData);
      console.log("🔍 Message analysis:", {
        hasJsonrpc: !!messageData.jsonrpc,
        hasMethod: !!messageData.method,
        hasResult: !!messageData.result,
        hasError: !!messageData.error,
        hasId: !!messageData.id,
        hasVerb: !!messageData.verb,
        messageType: messageData.jsonrpc
          ? "MCP"
          : messageData.verb
            ? "ADMIN"
            : "UNKNOWN",
        keys: Object.keys(messageData),
      });

      // Simplified message routing - only two types
      if (isMcpMessage(messageData)) {
        if (transport) {
          console.log(
            "🔄 Processing MCP protocol message:",
            messageData.method || (messageData.result ? "response" : "unknown")
          );
          console.log("🔍 MCP message details:", {
            id: messageData.id,
            method: messageData.method,
            hasResult: !!messageData.result,
            hasError: !!messageData.error,
            resultType: messageData.result
              ? typeof messageData.result
              : undefined,
          });
          console.log("🔍 Transport exists, calling handleMessage...");
          transport.handleMessage(data.toString());
          console.log("🔍 handleMessage completed");
        } else {
          console.log("❌ Transport is null, cannot handle MCP message");
        }
        return;
      }

      if (isAdminVerbMessage(messageData)) {
        // Handle admin/management verb commands
        console.log("⚙️ Processing admin verb command:", messageData.verb);
        await handleAdminVerbMessage(messageData, ws);
        return;
      }

      // Unknown message type
      console.warn("⚠️ Received unknown message type:", messageData);
      ws.send(
        JSON.stringify({
          success: false,
          error:
            "Unknown message type - expected MCP protocol message or admin verb command",
          receivedKeys: Object.keys(messageData),
          timestamp: new Date().toISOString(),
        })
      );
    });

    ws.on("close", (code, reason) => {
      isConnecting = false;
      globalWs = null;
      console.log("❌ Disconnected from MCP proxy server");
      console.log("🔍 Close code:", code);
      console.log("🔍 Close reason:", reason.toString());
      console.log("🔍 WebSocket readyState:", ws.readyState);

      // Implement reconnection logic
      setTimeout(() => {
        console.log("🔄 Attempting to reconnect to MCP proxy...");
        connectToMcpProxy(); // Recursive reconnection
      }, 5000);
    });

    ws.on("error", (error: Error) => {
      isConnecting = false;
      globalWs = null;
      console.error("❌ WebSocket connection error:", error);
      // Try to reconnect after error
      setTimeout(() => {
        console.log("🔄 Attempting to reconnect after error...");
        connectToMcpProxy();
      }, 5000);
    });
  } catch (error) {
    isConnecting = false;
    globalWs = null;
    console.error("Failed to connect to MCP proxy:", error);
    // Retry connection
    setTimeout(() => {
      console.log("🔄 Retrying connection...");
      connectToMcpProxy();
    }, 5000);
  }
}

// Setup MCP server request handlers for proxy functionality
function setupMcpServerHandlers(mcpServer: Server) {
  // List tools from all connected upstream servers with namespacing
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    console.log("🔍 ListTools handler called");
    const allTools = [];

    console.log(`🔍 Listing tools from ${mcpClients.size} connected servers`);
    console.log("🔍 Connected server names:", Array.from(mcpClients.keys()));

    for (const [serverName, client] of mcpClients) {
      console.log(`🔍 Processing server: ${serverName}`);
      try {
        console.log(`🔍 Calling listTools on ${serverName}...`);
        const response = await client.listTools();
        console.log(`🔍 ${serverName} returned:`, response);

        // Prefix each tool name with server name to avoid conflicts
        const namespacedTools = response.tools.map((tool) => ({
          ...tool,
          name: `${serverName}__${tool.name}`,
          description: `[${serverName}] ${tool.description || ""}`,
        }));
        allTools.push(...namespacedTools);
        console.log(`  ✅ ${serverName}: ${response.tools.length} tools`);
      } catch (error) {
        console.error(`  ❌ Error listing tools from ${serverName}:`, error);
      }
    }

    console.log(`📋 Total tools available: ${allTools.length}`);
    console.log(
      "🔍 All tools:",
      allTools.map((t) => ({
        name: t.name,
        description: t.description?.substring(0, 100) + "...",
      }))
    );
    console.log("🔍 Returning tools response...");
    const result = { tools: allTools };
    console.log("🔍 Final tools response:", JSON.stringify(result, null, 2));
    return result;
  });

  // List resources from all connected upstream servers with namespacing
  mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => {
    const allResources = [];

    console.log(
      `🔍 Listing resources from ${mcpClients.size} connected servers`
    );

    for (const [serverName, client] of mcpClients) {
      try {
        const response = await client.listResources();
        // Prefix each resource name with server name
        const namespacedResources = response.resources.map((resource) => ({
          ...resource,
          name: `${serverName}__${resource.name}`,
          description: `[${serverName}] ${resource.description || ""}`,
          uri: `${serverName}://${resource.uri}`, // Namespace the URI too
        }));
        allResources.push(...namespacedResources);
        console.log(
          `  ✅ ${serverName}: ${response.resources.length} resources`
        );
      } catch (error) {
        console.error(
          `  ❌ Error listing resources from ${serverName}:`,
          error
        );
      }
    }

    console.log(`📋 Total resources available: ${allResources.length}`);
    return { resources: allResources };
  });

  // List prompts from all connected upstream servers with namespacing
  mcpServer.setRequestHandler(ListPromptsRequestSchema, async () => {
    const allPrompts = [];

    console.log(`🔍 Listing prompts from ${mcpClients.size} connected servers`);

    for (const [serverName, client] of mcpClients) {
      try {
        const response = await client.listPrompts();
        // Prefix each prompt name with server name
        const namespacedPrompts = response.prompts.map((prompt) => ({
          ...prompt,
          name: `${serverName}__${prompt.name}`,
          description: `[${serverName}] ${prompt.description || ""}`,
        }));
        allPrompts.push(...namespacedPrompts);
        console.log(`  ✅ ${serverName}: ${response.prompts.length} prompts`);
      } catch (error) {
        console.error(`  ❌ Error listing prompts from ${serverName}:`, error);
      }
    }

    console.log(`📋 Total prompts available: ${allPrompts.length}`);
    return { prompts: allPrompts };
  });

  // Route tool calls to appropriate upstream server
  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const namespacedToolName = request.params.name;

    console.log(`🔧 Calling tool: ${namespacedToolName}`);

    // Parse server name and original tool name from namespaced name
    const parts = namespacedToolName.split("__");
    if (parts.length !== 2) {
      const error = `Invalid tool name format: ${namespacedToolName}. Expected format: serverName__toolName`;
      console.error(`❌ ${error}`);
      throw new Error(error);
    }

    const [serverName, originalToolName] = parts;
    const client = mcpClients.get(serverName);

    if (!client) {
      const error = `Server ${serverName} not found for tool ${namespacedToolName}`;
      console.error(`❌ ${error}`);
      throw new Error(error);
    }

    try {
      console.log(`  🎯 Routing to ${serverName}.${originalToolName}`);
      // Call the tool with the original (non-namespaced) name
      const result = await client.callTool({
        ...request.params,
        name: originalToolName,
      });
      console.log(`  ✅ Tool call successful: ${namespacedToolName}`);
      return result;
    } catch (error: any) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const fullError = `Error calling tool ${namespacedToolName}: ${errorMessage}`;
      console.error(`  ❌ ${fullError}`);
      throw new Error(fullError);
    }
  });
}

// Start the HTTP server
serve(
  {
    fetch: app.fetch,
    port: PORT,
  },
  () => {
    console.log(`🚀 HTTP server started on port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}`);
  }
);

// Initialize existing servers and connect to MCP proxy
async function startup() {
  console.log("🔄 Starting up MCP proxy server...");
  await initializeExistingServers();
  await connectToMcpProxy();
  console.log("✅ MCP proxy server startup complete");
}

startup().catch(console.error);

// Graceful shutdown handling
function gracefulShutdown(signal: string) {
  console.log(
    `\n🛑 Received ${signal} signal, initiating graceful shutdown...`
  );

  // Close all MCP client connections
  const shutdownPromises = Array.from(mcpClients.entries()).map(
    async ([name, client]) => {
      try {
        console.log(`🔌 Closing connection to ${name}`);
        await client.close();
      } catch (error) {
        console.warn(`⚠️ Error closing connection to ${name}:`, error);
      }
    }
  );

  Promise.all(shutdownPromises)
    .then(() => {
      console.log("✅ All MCP client connections closed");

      if (globalWs && globalWs.readyState === WebSocket.OPEN) {
        console.log("📤 Sending shutdown notification to MCP proxy");

        try {
          // Send goodbye message to proxy
          globalWs.send(
            JSON.stringify({
              type: "client_shutdown",
              clientId: "mcp-package-manager",
              message: "Server shutting down gracefully",
              timestamp: new Date().toISOString(),
            })
          );

          // Give a moment for the message to send, then close
          setTimeout(() => {
            console.log("🔌 Closing WebSocket connection");
            globalWs?.close(1000, "Server shutdown");
            globalWs = null;

            console.log("✅ Graceful shutdown complete");
            process.exit(0);
          }, 500);
        } catch (error) {
          console.error("❌ Error during graceful shutdown:", error);
          globalWs?.close();
          globalWs = null;
          process.exit(1);
        }
      } else {
        console.log("✅ No active WebSocket connection, exiting immediately");
        process.exit(0);
      }
    })
    .catch((error) => {
      console.error("❌ Error during MCP client shutdown:", error);
      process.exit(1);
    });
}

// Handle process signals for graceful shutdown
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGUSR2", () => gracefulShutdown("SIGUSR2")); // For nodemon

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("💥 Uncaught Exception:", error);
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("💥 Unhandled Rejection at:", promise, "reason:", reason);
  gracefulShutdown("UNHANDLED_REJECTION");
});
