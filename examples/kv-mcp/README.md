# NullShot Typescript MCP Template

A template repository for bootstrapping MCPs (Model Context Protocol) for the null-shot/typescript-agent-framework.

## Getting Started

### Setup the repository

**Option A: Use nullshot cli**


You can create a new project by following this interactive prompt:

```bash
npx @nullshot/cli create mcp
```

**Option B: Use deploy to cloudflare button**

The following button will create a new repo in your organization and setup teh CI/CD using Cloudflare:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/null-labs/mcp-template)

*NOTE: The configuration only needs `npm run deploy` for the Deploy command to work*

**Option C: Github Template**

1. Click the "Use this template" button at the top of this repository
2. Clone your new repository

The above will boostrap a serverless cloudflare compatible MCP Server with the following urls:

* /ws - Websocket connection endpoint
* /sse - SSE connection endpoint

## Features

- **WebSocket Client Support**: Includes official [WebSocket client](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/src/client/websocket.ts) for real-time bidirectional communication
- **SSE Client Support**: Includes [Server-Sent Events client](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/src/client/sse.ts) for server-to-client streaming
- **MCP Inspector**: Debug and monitor your MCP during development
- **Cloudflare Workers Integration**: Built on Cloudflare Workers for edge computing capabilities
- **Integration Testing Suite**: Websocket and SSE testing tools to do full integration testing with local miniflare services (D1/KV/etc) for ease of testing features without mocking.

## Available Scripts

- `pnpm run dev`: Runs both the MCP Inspector (port 6274) and Cloudflare Worker (port 8787) concurrently
- `pnpm start`: Runs only the Cloudflare Worker (port 8787)
- `pnpm test`: Runs tests with Vitest
- `pnpm run deploy`: Deploys your MCP to Cloudflare Workers
- `pnpm run cf-typegen`: Generates TypeScript types for Cloudflare Workers (run this everytime you add new changes to wrangler.jsonc)

## Usage Overview

There are two ways to leverage run an MCP Server with and without Hono for request routing.

### Environment Setup

Optionally you can create a `.dev.vars` which will will bootstrap local [enviornment variables](https://nullshot.ai/en/docs/developers/platform/environment-variables) or [secrets](https://nullshot.ai/en/docs/developers/platform/secret-manager).

When you run `pnpm cf-typegen` it generates `worker-configuration.d.ts` which creates an `Env` class for your code to access cloudflare bindings, env vars, and more.

### McpHonoServerDO Implementation

By default, the template uses `McpHonoServerDO` which combines the MCP server with [Hono](https://hono.dev), a fast and lightweight web framework. This provides a clean routing system and middleware capabilities.

### Customizing Routes with Hono

To add custom HTTP endpoints with `McpHonoServerDO`, extend the `setupRoutes` method:

```typescript
export class ExampleMcpServer extends McpHonoServerDO<Env> {
  // Other methods...

  protected setupRoutes(app: Hono<{ Bindings: Env }>): void {
    // Call the parent implementation to set up MCP routes
    super.setupRoutes(app);
    
    // Add your custom routes
    app.get('/api/status', (c) => {
      return c.json({ status: 'ok' });
    });
    
    app.post('/api/data', async (c) => {
      const body = await c.req.json();
      // Process data
      return c.json({ success: true });
    });
  }
}
```

### McpServerDO Implementation (Native Cloudflare Routing)

If you need more control over the HTTP request handling, you can directly extend `McpServerDO` instead. This gives you full control over the `fetch` method:

```typescript
export class CustomMcpServer extends McpServerDO<Env> {
  // Required abstract method implementations
  getImplementation(): Implementation {
    return {
      name: 'CustomMcpServer',
      version: '1.0.0',
    };
  }
  
  configureServer(server: McpServer): void {
    setupServerTools(server);
    setupServerResources(server);
    setupServerPrompts(server);
  }
  
  // Override the fetch method for complete control over routing
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Handle custom routes
    if (path === '/api/custom') {
      return new Response(JSON.stringify({ custom: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Pass through MCP-related requests to the parent implementation
    return super.fetch(request);
  }
}
```

This approach is useful when you need to:
- Handle specific routes with custom logic
- Implement complex middleware or authentication
- Intercept or modify requests before they reach the MCP handler
- Add custom WebSocket or SSE endpoints beyond the standard MCP implementation

### Creating Tools, Resources, and Prompts

The main server implementation is in `src/server.ts` and extends `McpHonoServerDO`:

```typescript
export class ExampleMcpServer extends McpHonoServerDO<Env> {
  // Required abstract method implementation
  getImplementation(): Implementation {
    return {
      name: 'ExampleMcpServer',
      version: '1.0.0',
    };
  }

  // Configure server by adding tools, resources, and prompts
  configureServer(server: McpServer): void {
    setupServerTools(server);
    setupServerResources(server);
    setupServerPrompts(server);
  }
}
```

To add functionality, use the following modules:

1. **Tools** (`src/tools.ts`): Define functions that clients can call

```typescript
export function setupServerTools(server: McpServer) {
  server.tool(
    'tool_name',           // Name of the tool
    'Tool description',    // Description
    {                      // Parameters schema using zod
      param1: z.string().describe('Parameter description'),
    },       
    async ({ param1 }) => {
      // Tool implementation
      return {
        content: [
          {
            type: "text",
            text: `Result: ${param1}`
          }
        ]
      };
    }
  );
}
```

2. **Resources** (`src/resources.ts`): Define persistent resources clients can access

```typescript
export function setupServerResources(server: McpServer) {
  server.resource(
    'resource_name',
    'resource://path/{id}',
    async (uri: URL) => {
      // Resource implementation
      return {
        contents: [
          {
            text: `Resource data`,
            uri: uri.href
          }
        ]
      };
    }
  );
}
```

3. **Prompts** (`src/prompts.ts`): Define prompt templates

```typescript
export function setupServerPrompts(server: McpServer) {
  server.prompt(
    'prompt_name',
    'Prompt description',
    () => ({
      messages: [{
        role: 'assistant',
        content: {
          type: 'text',
          text: `Your prompt text here`
        }
      }]
    })
  );
}
```

### Examples

* [CRUD MCP Example](https://github.com/null-shot/typescript-agent-framework/tree/main/examples/crud-mcp) - Leverage D1 Database
* [Expense MCP Example](https://github.com/null-shot/typescript-agent-framework/tree/main/examples/expense-mcp) - Leveraging Workflows
* [Dependent Agent](https://github.com/null-shot/typescript-agent-framework/tree/main/examples/dependent-agent) - AI Agent with MCP dependencies

## Related Resources

### Core Packages

- [MCP Package](https://github.com/xava-labs/typescript-agent-framework/tree/main/packages/mcp): The core MCP implementation with advanced features and testing utilities
- [TypeScript Agent Framework](https://github.com/xava-labs/typescript-agent-framework): Build intelligent agents powered by LLMs with the Agent Framework

### Docs

- [Overview](https://nullshot.ai/en/docs/developers/mcp-framework/overview)
- [Getting Started Guide](https://nullshot.ai/en/docs/developers/mcp-framework/getting-started)
- [Integration Testing](https://nullshot.ai/en/docs/developers/mcp-framework/integration-testing)

### Community

Join our community to get help, share ideas, and contribute to the project:

- [Discord](https://discord.gg/acwpp6zWEc): Join the `#typescript-framework` channel for feature requests, support, and discussions

### Contributing

We welcome contributions to improve this template! Here's how you can contribute:

1. **Fork the repository**: Create a fork to make your changes

2. **Create a branch**: Make your changes in a new branch
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Commit your changes**: Make meaningful commits
   ```bash
   git commit -m "Add feature: brief description"
   ```

4. **Push to your fork**: Push your changes to your fork
   ```bash
   git push origin feature/your-feature-name
   ```

5. **Create a pull request**: Open a PR with a detailed description of your changes

### Pull Request Guidelines

- Provide a clear, descriptive title for your PR
- Include a detailed description of what your PR does
- Reference any related issues
- Include screenshots or examples if applicable
- Ensure all tests pass
- Keep PRs focused on a single feature or fix

For larger changes or features, we recommend discussing them first in our Discord channel to ensure alignment with the project direction.

Or use the Deploy to Cloudflare button above to deploy directly from GitHub.

## License

[MIT](LICENSE)
