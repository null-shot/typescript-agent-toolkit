# 🌐 NullShot - Typescript Agent Framework

<div align="center">
  <h3>Building the future of AI Agent Interoperability</h3>
  <p><i>Pre-Alpha: This project is in active development.</i></p>
</div>

[![Discord](https://img.shields.io/discord/1358691448173625468?style=flat)](https://discord.gg/acwpp6zWEc)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Welcome to a new paradigm in AI development. MCP provides the foundation for building intelligent, interoperable agents that can communicate, evolve, and generate value at the edge of the network.

## Vision

We're extending [Cloudflare's vision for AI Agents](https://blog.cloudflare.com/making-cloudflare-the-best-platform-for-ai-agents) with a focus on web3 and MCPs as plugins:

- 🤝 AI Agents as teammates/organizations generating revenue and performing advanced operations
- 💰 Cost-effective shared hosting options
- 🔒 Secure sensitive assets (trading agents, treasuries, etc.)
- 📈 Self-improving agents based on collective usage
- 💸 Drive MCP usage revenue to open source contributors
- 💼 Monetization avenues for closed-source MCP use cases
- ⚙️ Seamless configuration options
- 🚀 Quick iteration on ideas locally and in-cloud
- 🔓 No vendor lock-in, self-hosting and personal account options

## Project Status

This project is in pre-alpha and actively evolving. Current focus areas:

### Ready for Use

- ✅ Core MCP Framework
- ✅ Multi Session & Authentication Patterns
- ✅ Official MCP WebSocket Support and HTTP Streaming Support
- ✅ Agent Framework (AI SDK)
- ✅ Seamless MCP Plugins (mcp.json) for Agents
- ✅ Agent MCP Dependency Management
- ✅ MCP Webhook / External Service Support
- ✅ Playground UI for LLMs + MCPs

### In Development

- ☁️ Cloudflare Service Examples (KV, D1, DO state, Analytics, Workflows, Schema Migrations)
- 🤖 LangChain and Agent SDK examples coming soon
- 📄 Cloudflare Pages (SSE / Fullstack) Examples
- 🔑 Authentication (OAuth, JWT)

## Quick Start

### Deploy a Single Worker (recommended)

The fastest way to get a fully working AI Agent with MCP tools, Telegram Bot, and a web UI:

```bash
# Clone and install
git clone https://github.com/nullshot/typescript-agent-vibework.git
cd typescript-agent-vibework
pnpm install && pnpm build

# Launch the deploy wizard
pnpm nullshot deploy
```

The wizard walks you through:

1. **Select AI Agents** — SimplePromptAgent (chat), DependentAgent (with tools)
2. **Select MCP Servers** — todo, expense, env-variable, secret (and more)
3. **Playground UI** — web chat interface with agent switcher
4. **Telegram Bot** — optional, prompts for bot token
5. **AI Provider** — Anthropic, OpenAI, Google Gemini, DeepSeek, xAI

It automatically creates KV namespaces, sets secrets, deploys to Cloudflare Workers, and configures the Telegram webhook.

> **Want to run locally first?** See the [Single Worker Example](examples/single-worker/) for local dev setup.

### Or: start from scratch

Use the CLI to scaffold individual components:

```bash
# Install CLI globally
npm install -g @nullshot/cli

# Create a new MCP server
nullshot create mcp

# Create a new Agent
nullshot create agent

# Initialize MCP configuration in existing project
nullshot init

# Install MCP dependencies
nullshot install

# Run in development mode
nullshot dev
```

## 🤖 AI Provider Support

This framework supports 6 major AI providers with dynamic model fetching and official SDK integration:

### Supported Providers

| Provider        | Latest Models                                    | SDK                   | Dynamic | API Key    |
|:----------------|:-------------------------------------------------|:----------------------|:--------|:-----------|
| **OpenAI**      | GPT-4o, GPT-4o-mini, GPT-3.5-turbo             | `@ai-sdk/openai`     | ✅      | ✅         |
| **Anthropic**   | Claude Opus 4.1, Claude Sonnet 4, Claude 3.7   | `@ai-sdk/anthropic`  | ✅      | ✅         |
| **DeepSeek**    | DeepSeek-Chat, DeepSeek-Coder                   | `@ai-sdk/deepseek`   | ✅      | ✅         |
| **Workers AI**  | Llama 3.1/3.2, Gemma 2, Mistral 7B (~49 models) | `workers-ai-provider` | ✅      | Cloudflare |
| **Gemini**      | Gemini 1.5 Pro Latest, Gemini 1.5 Flash Latest | `@ai-sdk/google`     | ✅      | ✅         |
| **Grok**        | Grok-4, Grok-3, Grok-3-mini, Grok-2-1212       | `@ai-sdk/xai`        | ✅      | ✅         |

### Key Features

- **🔄 Dynamic Model Fetching**: Real-time model lists from provider APIs with intelligent fallbacks
- **🎯 Official SDK Integration**: Uses official AI SDK providers for consistent, reliable integration
- **💾 Smart Caching**: Model lists cached for 30 minutes with API key validation
- **🔧 Provider-Aware UI**: Auto-loading saved API keys and intelligent model selection
- **📡 Streaming Support**: Real-time responses across all providers
- **⚡ Fallback Handling**: Graceful degradation when APIs are unavailable

### Implementation Examples

- **Next.js Web App**: [`examples/playground-showcase`](examples/playground-showcase) - Full-featured chat interface
- **Cloudflare Workers Agent**: [`examples/simple-prompt-agent`](examples/simple-prompt-agent) - Server-side AI agent
- **React Components**: [`packages/playground`](packages/playground) - Reusable UI components

## Documentation

Comprehensive documentation is available at [Null Shot Docs](https://nullshot.ai/docs):

- **[Project Overview](https://nullshot.ai/docs)** - Get started with Null Shot
- **[Agent Framework - Getting Started](https://nullshot.ai/en/docs/developers/agents-framework/overview)** - Build AI agents with Cloudflare Workers
- **[MCP Framework Overview](https://nullshot.ai/en/docs/developers/mcp-framework/overview)** - Model Context Protocol implementation
- **[Platform Overview](https://nullshot.ai/en/docs/developers/platform/overview)** - Understanding the platform architecture
- **[Common Services](https://nullshot.ai/en/docs/developers/services/overview)** - Cloudflare services integration
- **[Playground](https://nullshot.ai/en/docs/developers/playground)** - Interactive development environment

## Release Process

This repository uses an automated release workflow following semantic versioning:

1. **Pull Request Testing** - When you create a PR, it automatically runs tests and a semantic-release dry run
2. **Automated Publishing** - When merged to main, changed packages are automatically published to npm
3. **Versioning** - Package versions are determined by [Conventional Commits](https://www.conventionalcommits.org/) standards

For detailed information about our release process, see [.github/RELEASE_PROCESS.md](.github/RELEASE_PROCESS.md).

## Contributing

We welcome contributions! Our vision is to create a collaborative ecosystem where AI and human developers work together. Soon, we'll have an AI agent to audit and govern contributions based on our shared vision.

If you're interested in contributing, please:

1. Join our [Discord community](https://discord.gg/acwpp6zWEc)
2. Watch this repository for updates
3. Star the project if you find it interesting

## 🧪 Testing & Development

### Updated Toolkit - How to Test

This repository includes working examples for MCP servers, AI agents, and playground interfaces.

#### Prerequisites

```bash
# Install dependencies at root
pnpm install

# Build all packages
pnpm build
```

#### MCP Server Examples

| Example | Description | Test Command |
|---------|-------------|--------------|
| `crud-mcp` | CRUD operations with D1 | `cd examples/crud-mcp && pnpm dev` |
| `kv-mcp` | Workers KV storage | `cd examples/kv-mcp && pnpm dev` |
| `analytics-mcp` | Analytics Engine integration | `cd examples/analytics-mcp && pnpm dev` |
| `email-mcp` | Email sending via MailChannels | `cd examples/email-mcp && pnpm dev` |
| `image-mcp` | Image generation with Workers AI | `cd examples/image-mcp && pnpm dev` |
| `vectorize-mcp` | Vector search with Vectorize | `cd examples/vectorize-mcp && pnpm dev` |
| `browser-mcp` | Browser automation | `cd examples/browser-mcp && pnpm dev` |
| `secret-mcp` | Secrets management | `cd examples/secret-mcp && pnpm dev` |
| `env-variable-mcp` | Environment variables | `cd examples/env-variable-mcp && pnpm dev` |

#### Single Worker (all-in-one)

| Example | Description | Test Command |
|---------|-------------|--------------|
| **`single-worker`** | **All agents + MCPs + Telegram + Dashboard in one worker** | `cd examples/single-worker && pnpm dev` |

This is what `nullshot deploy` generates. See [examples/single-worker/README.md](examples/single-worker/README.md) for full docs.

#### AI Agent Examples

| Example | Description | Test Command |
|---------|-------------|--------------|
| `simple-prompt-agent` | Basic AI chat agent | `cd examples/simple-prompt-agent && pnpm dev` |
| `dependent-agent` | Agent with MCP dependencies | `cd examples/dependent-agent && pnpm dev` |
| `telegram-bot-agent` | Telegram bot integration | `cd examples/telegram-bot-agent && pnpm dev` |
| `queues-agent` | Async processing with Queues | `cd examples/queues-agent && pnpm dev` |

#### Playground Interfaces

```bash
# Main Playground (Next.js 15 + shadcn/ui)
cd packages/playground && pnpm dev
# Open http://localhost:3000

# Lightweight Playground (Hono Worker - deployable to Cloudflare)
cd examples/playground-worker && pnpm dev
# Open http://localhost:8790
```

#### Running Tests

```bash
# Run all tests
pnpm test

# Run tests for specific package
cd packages/mcp && pnpm test

# Watch mode
pnpm test:watch
```

#### Deploy to Cloudflare

```bash
# Deploy everything as a single worker (recommended)
pnpm nullshot deploy

# Or deploy individual examples
cd examples/<example-name>
pnpm run deploy
```

### Environment Variables

Create `.dev.vars` file in each example directory with required secrets:

```bash
# AI Provider Keys (choose one or more)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
XAI_API_KEY=xai-...
GOOGLE_GENERATIVE_AI_API_KEY=...
DEEPSEEK_API_KEY=...

# For telegram-bot-agent
TELEGRAM_BOT_TOKEN=...
AGENT_WORKER_URL=https://your-agent.workers.dev
```

## License

MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">
  <i>Built with ❤️ by the Xava DAO Community</i>
</div>
