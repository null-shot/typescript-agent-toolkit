# @xava-labs/mcp-toolbox

A WebSocket server for managing MCP (Model Context Protocol) packages with SQLite persistence.

## Features

- 🚀 WebSocket API for MCP package management
- 📦 SQLite database integration
- 🧪 MCP server connection testing
- 🐳 Docker containerized
- ⚡ TypeScript with Node.js 22
- 🧶 pnpm package manager

## Quick Start

### Usage

```bash
# first, set .env file in packages/mcp-toolbox (you can reference .env.example)
cd ../playground
pnpm i
# stop here and go to Docker Commands if you want to just do a Docker build, or continue on here for local dev
pnpm dev
cd ../mcp-toolbox
pnpm dev
```

### Docker Commands

```bash
# Build the Docker image (run from packages/mcp-toolbox directory - make sure you have done `pnpm i` in ../playground dir listed above)
pnpm docker:build

# Run the container with all necessary environment variables and volume mounts (refer to package.json if you want to edit this command)
pnpm docker:run

# Build and run using docker-compose (recommended for development)
pnpm docker:dev
```

**Command Details:**

- **`docker:build`**: Builds the Docker image from the monorepo root with the correct build context
- **`docker:run`**: Runs the container with host network access, environment variables, and data volume mounting
- **`docker:dev`**: Uses docker-compose to build and run the container with all configurations from `docker-compose.yml`

> 📖 **For production deployment and GitHub Container Registry usage, see [DOCKER.md](./DOCKER.md)**

## WebSocket API

### Connection

```
ws://localhost:11990/ws
```

### Message Format

All messages must be valid JSON with this structure:

```json
{
  "verb": "add" | "delete" | "update" | "list",
  "data": { /* verb-specific data */ }
}
```

---

## API Reference

### 📦 `add` - Add MCP Package

**Request:**

```json
{
  "verb": "add",
  "data": {
    "unique-name": "my-mcp-server",
    "command": "npx",
    "args": ["-y", "some-mcp-package", "--stdio"],
    "env": {}
  }
}
```

**Success Response:**

```json
{
  "verb": "add",
  "success": true,
  "message": "MCP server 'my-mcp-server' added successfully",
  "data": {
    "id": 1,
    "name": "my-mcp-server",
    "command": "npx",
    "args": ["-y", "some-mcp-package", "--stdio"],
    "env": [],
    "installedAt": "2024-01-01T12:00:00.000Z"
  },
  "capabilities": {
    "tools": [{ "name": "tool1", "description": "..." }],
    "resources": [],
    "prompts": []
  },
  "totalCapabilities": 5,
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

**Error Response:**

```json
{
  "verb": "add",
  "success": false,
  "error": "Failed to connect to MCP server",
  "details": "Connection timeout after 10000ms",
  "message": "The MCP server could not be reached or is not responding correctly.",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

---

### 🔄 `update` - Update MCP Package Configuration

**Request:**

```json
{
  "verb": "update",
  "data": {
    "unique-name": "my-mcp-server",
    "command": "npx",
    "args": ["-y", "some-mcp-package", "--new-config", "--stdio"],
    "env": {
      "NEW_API_KEY": "updated-key-value"
    }
  }
}
```

**Success Response:**

```json
{
  "verb": "update",
  "success": true,
  "message": "MCP server 'my-mcp-server' updated successfully",
  "data": {
    "id": 1,
    "name": "my-mcp-server",
    "command": "npx",
    "args": ["-y", "some-mcp-package", "--new-config", "--stdio"],
    "env": ["NEW_API_KEY"],
    "updatedAt": "2024-01-01T12:00:00.000Z"
  },
  "capabilities": {
    "tools": [{ "name": "tool1", "description": "..." }],
    "resources": [],
    "prompts": []
  },
  "totalCapabilities": 5,
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

**Error Response:**

```json
{
  "verb": "update",
  "success": false,
  "error": "Package with unique-name 'my-mcp-server' not found",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

---

### 🗑️ `delete` - Remove MCP Package

**Request:**

```json
{
  "verb": "delete",
  "data": {
    "unique-name": "my-mcp-server"
  }
}
```

**Success Response:**

```json
{
  "verb": "delete",
  "success": true,
  "message": "Package 'my-mcp-server' removed successfully",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

**Error Response:**

```json
{
  "verb": "delete",
  "success": false,
  "error": "Package with unique-name 'my-mcp-server' not found",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

---

### 📋 `list` - List All Packages

**Request:**

```json
{
  "verb": "list"
}
```

**Response:**

```json
{
  "verb": "list",
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "my-mcp-server",
      "command": "npx",
      "args": ["-y", "some-mcp-package", "--stdio"],
      "env": [],
      "installedAt": "2024-01-01T12:00:00.000Z"
    }
  ],
  "count": 1,
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

---

## Behavior

### ✅ Success Flow

1. **`add`**: Tests MCP server connection before storing
2. **`update`**: Tests new configuration, disconnects old connection, updates database, reconnects with new config
3. **`delete`**: Removes from database if exists
4. **`list`**: Returns all stored packages

### ❌ Error Handling

- **Invalid JSON**: `"Invalid JSON format"`
- **Missing verb**: `"Invalid message format"`
- **Invalid verb**: `"Invalid message format"`
- **Validation errors**: `"Validation failed"` with details
- **MCP connection fails**: `"Failed to connect to MCP server"`
- **Duplicate name**: `"Package with unique-name 'X' already exists"` (add only)
- **Not found**: `"Package with unique-name 'X' not found"` (update/delete)
- **Update connection fails**: `"Failed to connect to MCP server with new configuration"`

### 🔄 MCP Connection Testing

- Tests actual connection to MCP server before storing
- Validates server exposes tools, resources, or prompts
- 10-second timeout for connections
- Only stores packages that successfully connect

---

## Examples

### JavaScript/Node.js

```javascript
const WebSocket = require("ws");
const ws = new WebSocket("ws://localhost:11990/ws");

ws.on("open", () => {
  // Add Figma MCP
  ws.send(
    JSON.stringify({
      verb: "add",
      data: {
        "unique-name": "figma-mcp",
        command: "npx",
        args: [
          "-y",
          "figma-developer-mcp",
          "--figma-api-key=YOUR-KEY",
          "--stdio",
        ],
        env: {},
      },
    }),
  );
});

ws.on("message", (data) => {
  const response = JSON.parse(data.toString());
  console.log("Response:", response);
});

// List packages
ws.send(JSON.stringify({ verb: "list" }));

// Update package configuration
ws.send(
  JSON.stringify({
    verb: "update",
    data: {
      "unique-name": "figma-mcp",
      command: "npx",
      args: ["-y", "figma-developer-mcp", "--figma-api-key=NEW-KEY", "--stdio"],
      env: { FIGMA_API_KEY: "NEW-KEY-VALUE" },
    },
  }),
);

// Delete package
ws.send(
  JSON.stringify({
    verb: "delete",
    data: { "unique-name": "figma-mcp" },
  }),
);
```

### Browser

```javascript
const ws = new WebSocket("ws://localhost:11990/ws");

ws.onopen = () => {
  console.log("Connected to MCP server");

  // List existing packages
  ws.send(JSON.stringify({ verb: "list" }));
};

ws.onmessage = (event) => {
  const response = JSON.parse(event.data);
  console.log("Server response:", response);
};
```

### curl (via websocat)

```bash
# Install websocat
curl -L https://github.com/vi/websocat/releases/latest/download/websocat.x86_64-unknown-linux-musl > websocat
chmod +x websocat

# Add package
echo '{"verb":"add","data":{"unique-name":"test","command":"echo","args":["hello"],"env":{}}}' | ./websocat ws://localhost:11990/ws

# Update package
echo '{"verb":"update","data":{"unique-name":"test","command":"echo","args":["updated-hello"],"env":{"NEW_VAR":"value"}}}' | ./websocat ws://localhost:11990/ws

# List packages
echo '{"verb":"list"}' | ./websocat ws://localhost:11990/ws

# Delete package
echo '{"verb":"delete","data":{"unique-name":"test"}}' | ./websocat ws://localhost:11990/ws
```

---

## Configuration

### Required ProxyId

The server requires a `proxyId` parameter to connect to the MCP proxy. This can be provided via:

1. **Command line argument** (recommended):

   ```bash
   node dist/index.js --proxy-id your-uuid-here
   ```

2. **Environment variable**:
   ```bash
   export PROXY_ID=your-uuid-here
   node dist/index.js
   ```

The proxyId should be the same UUID used by the playground and must match the proxyId used when connecting to the MCP proxy.

### Other Configuration

Configure via `.env`:

```env
PORT=11990
DB_PATH=./data/packages.db
MCP_PROXY_URL=ws://localhost:6050/api/remote-container/ws
PROXY_ID=your-uuid-here
```

## Development

```bash
# Start server with proxyId
pnpm dev --proxy-id your-uuid-here

# Or using environment variable
PROXY_ID=your-uuid-here pnpm dev

# Run tests
pnpm test:mcp

# Send test message
pnpm send

# Build for production
pnpm build

# Start production server with proxyId
pnpm start --proxy-id your-uuid-here
```

## Database

- **File**: `./data/packages.db` (SQLite)
- **Schema**: `packages` table with id, uniqueName, command, args, env, installedAt
- **Persistence**: Database file is mounted as volume in Docker

## Health Check

```bash
curl http://localhost:11990/
```

```json
{
  "status": "ok",
  "message": "MCP WebSocket Server",
  "websocket": "ws://localhost:11990/ws",
  "version": "0.1.0"
}
```

### Dedicated Health Endpoint

For monitoring and load balancers:

```bash
curl http://localhost:11990/health
```

```json
{
  "status": "ok",
  "message": "pong",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "uptime": 3600.5,
  "proxyId": "your-proxy-id",
  "mcpProxyConnected": true,
  "activeServers": 2
}
```
