# Agent Starter Template

A Cloudflare Workers-based conversational AI agent template built with Hono, Anthropic's Claude, and the Xava Labs Agent SDK. This template provides a production-ready foundation for building scalable AI agents that can handle multiple concurrent conversations with session management.

## Features

- 🚀 **Cloudflare Workers**: Serverless deployment with global edge distribution
- 🧠 **Anthropic Claude Integration**: Powered by Claude 3 Haiku for intelligent conversations
- 💬 **Session Management**: Persistent conversations using Cloudflare Durable Objects
- 🔄 **Streaming Responses**: Real-time response streaming for better user experience
- 🌐 **CORS Enabled**: Ready for web applications with proper CORS configuration
- 🛠️ **MCP Tools Ready**: Extensible with Model Context Protocol (MCP) tools
- 📦 **TypeScript**: Full type safety and excellent developer experience

## Architecture

The agent uses Cloudflare Durable Objects to maintain conversation state across requests. Each conversation session gets its own isolated Durable Object instance, ensuring:

- **Persistent Memory**: Conversations maintain context across multiple interactions
- **Scalability**: Each session runs independently and can scale automatically
- **Global Distribution**: Sessions can be accessed from any Cloudflare edge location

## Quick Start

### Prerequisites

- Node.js 22+ and pnpm
- Cloudflare account with Workers enabled
- Anthropic API key

### Installation

1. **Clone and install dependencies:**

   ```bash
   git clone <your-repo-url>
   cd agent-starter
   pnpm install
   ```

2. **Set up environment variables:**

   For local development, create a `.dev.vars` file:

   ```bash
   cp .dev.vars.example .dev.vars
   ```

   Then edit `.dev.vars` and add your API keys:

   ```
   AI_PROVIDER=anthropic
   AI_PROVIDER_API_KEY=your_anthropic_api_key_here
   MODEL_ID=claude-sonnet-4-20250514
   ```

   For production deployment, use Cloudflare Workers secrets:

   ```bash
   # Add your Anthropic API key to Cloudflare Workers secrets
   npx wrangler secret put AI_PROVIDER_API_KEY
   ```

3. **Start development server:**

   ```bash
   pnpm dev
   ```

   This will automatically start:
   - The agent service (via `nullshot dev` in local mode, no Cloudflare login required)
   - The Playground UI on port 3000, which connects to your agent

   **Note**: The agent runs in local mode, so no Cloudflare login is required for local development.

   To start only the agent (without UI):

   ```bash
   pnpm dev:agent-only
   ```

4. **Deploy to production:**
   ```bash
   pnpm deploy
   ```

## Usage

### API Endpoints

The agent exposes a single endpoint that handles all chat interactions:

```
POST /agent/chat/:sessionId?
```

- `sessionId` (optional): Unique identifier for the conversation session. If not provided, a new UUID will be generated.

### Example: Basic Chat Interaction

**Start a new conversation:**

```bash
curl -X POST https://your-worker.your-subdomain.workers.dev/agent/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Hello! Can you help me understand quantum computing?"
      }
    ]
  }'
```

**Continue an existing conversation:**

```bash
curl -X POST https://your-worker.your-subdomain.workers.dev/agent/chat/my-session-123 \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Hello! Can you help me understand quantum computing?"
      },
      {
        "role": "assistant",
        "content": "I'd be happy to help you understand quantum computing! Quantum computing is a revolutionary approach to computation that leverages the principles of quantum mechanics..."
      },
      {
        "role": "user",
        "content": "Can you give me a simple analogy?"
      }
    ]
  }'
```

### Example: JavaScript/TypeScript Client

```typescript
class AgentClient {
  constructor(private baseUrl: string) {}

  async sendMessage(
    message: string,
    sessionId?: string
  ): Promise<ReadableStream> {
    const url = sessionId
      ? `${this.baseUrl}/agent/chat/${sessionId}`
      : `${this.baseUrl}/agent/chat`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: message }],
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.body!;
  }

  async *streamResponse(stream: ReadableStream): AsyncGenerator<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        yield chunk;
      }
    } finally {
      reader.releaseLock();
    }
  }
}

// Usage
const client = new AgentClient(
  "https://your-worker.your-subdomain.workers.dev"
);

async function chatExample() {
  const stream = await client.sendMessage(
    "What's the weather like?",
    "session-123"
  );

  for await (const chunk of client.streamResponse(stream)) {
    console.log(chunk); // Process streaming response
  }
}
```

### Example: React Hook

```typescript
import { useState, useCallback } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function useAgent(baseUrl: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());

  const sendMessage = useCallback(
    async (content: string) => {
      const userMessage: Message = { role: "user", content };
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      try {
        const response = await fetch(`${baseUrl}/agent/chat/${sessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [...messages, userMessage],
          }),
        });

        if (!response.ok) throw new Error("Failed to send message");

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let assistantMessage = "";

        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          assistantMessage += chunk;

          setMessages((prev) => [
            ...prev.slice(0, -1),
            { role: "assistant", content: assistantMessage },
          ]);
        }
      } catch (error) {
        console.error("Error sending message:", error);
      } finally {
        setIsLoading(false);
      }
    },
    [baseUrl, sessionId, messages]
  );

  return { messages, sendMessage, isLoading, sessionId };
}
```

## Configuration

### Environment Variables

Configure these in your `wrangler.jsonc` or as Cloudflare Workers secrets:

- `ANTHROPIC_API_KEY`: Your Anthropic API key (secret)
- `AI_PROVIDER`: Set to "anthropic" (configured in wrangler.jsonc)

### Customizing the Agent

The agent behavior can be customized by modifying the `SimplePromptAgent` class in `src/index.ts`:

```typescript
async processMessage(sessionId: string, messages: AIUISDKMessage): Promise<Response> {
  const result = await this.streamText(sessionId, {
    model: this.model,
    system: 'Your custom system prompt here', // Customize the agent's personality
    messages: messages.messages,
    maxSteps: 10, // Adjust reasoning steps
    // Add tools, temperature, etc.
  });

  return result.toDataStreamResponse();
}
```

### Adding MCP Tools

Uncomment and configure MCP tools for extended capabilities:

```typescript
// In the constructor
super(state, env, model, [
  new ToolboxService(), // Uncomment to enable MCP toolbox
]);

// In processMessage
const result = await this.streamText(sessionId, {
  // ... other options
  experimental_toolCallStreaming: true, // Enable tool streaming
});
```

## Development

### Local Development

The development setup automatically runs:
- Agent service (via `nullshot dev` in local mode, no Cloudflare login required)
- Playground UI on port 3000 (automatically connects to the agent)

```bash
# Start development server with hot reload (agent + UI)
pnpm dev

# Start only the agent (without UI)
pnpm dev:agent-only

# Generate TypeScript types
pnpm cf-typegen
```

**Note**: All development commands use local mode (`--local` flag), so no Cloudflare authentication is required for local testing.

### Testing

Test your agent locally:

```bash
# Test with curl
curl -X POST http://localhost:8787/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello!"}]}'
```

### Deployment

```bash
# Deploy to Cloudflare Workers
pnpm deploy

# View logs
npx wrangler tail
```

## Project Structure

```
├── src/
│   └── index.ts              # Main agent implementation
├── package.json              # Dependencies and scripts
├── wrangler.jsonc           # Cloudflare Workers configuration
├── tsconfig.json            # TypeScript configuration
├── worker-configuration.d.ts # Generated type definitions
└── mcp.json                 # MCP tools configuration
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For issues and questions:

- Check the [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/)
- Review the [nullshot Agent SDK documentation](https://github.com/nullshot/typescript-agent-framework)
- Open an issue in this repository
