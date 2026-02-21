# Single Worker

A single Cloudflare Worker that gives you a full AI playground out of the box: chat UI, two agents, six MCP tool servers (including image generation and text-to-speech), customizable system prompts -- all in one deploy.

**Zero external dependencies.** Uses Workers AI (free tier) by default -- no API keys needed.

## What You Get

- **Chat UI** at `/` with dark theme, markdown rendering, code blocks, image display
- **System Prompt Templates** -- switch between personas or write your own. Saved in browser localStorage
- **Auto Voice** -- toggle in system prompt modal to auto-generate speech for every response
- **2 AI Agents:**
  - `Simple Prompt Agent` -- general chat with customizable system prompt
  - `Dependent Agent` -- agent with MCP tools (image gen, TTS, todos, expenses, etc.)
- **6 MCP Tool Servers:**
  - `ImageMcpServer` -- generate images via Workers AI (Flux)
  - `VoiceMcpServer` -- text-to-speech via Workers AI (MeloTTS)
  - `TodoMcpServer` -- create, list, complete, delete todos
  - `ExpenseMcpServer` -- submit, approve, reject, list expenses
  - `EnvVariableMcpServer` -- greeting tool (env var demo)
  - `SecretMcpServer` -- number guessing game
- **Multi-provider AI** -- Workers AI (free), Anthropic, OpenAI, DeepSeek, Google, xAI

## Quick Start (3 steps)

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) (`npm install -g pnpm`)
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)

### 1. Clone and install

```bash
git clone <repo-url>
cd <repo>

# Install all dependencies and build workspace packages
pnpm install && pnpm run build
```

`dist/` is gitignored, so the workspace packages (`@nullshot/agent`, `@nullshot/mcp`) must be built once before wrangler can bundle them.

### 2. Deploy

```bash
# Login to Cloudflare (first time only)
pnpm exec wrangler login

# Deploy from the single-worker directory
cd examples/single-worker
pnpm deploy
```

That's it. Workers AI is free and requires no API keys.

Your worker is live at `https://single-worker.YOUR-SUBDOMAIN.workers.dev`

> **Free tier note:** Default model is Llama 3.1 8B (fast, fits within DO free tier 30s limit). For larger models like Llama 3.3 70B, you need the Workers Paid plan ($5/mo) — set `MODEL_ID` in `wrangler.jsonc` to `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.

## Local Development

```bash
cd examples/single-worker
pnpm dev
# Open http://localhost:8787
```

## Optional: Use a Different AI Provider

Default is `workers-ai` (free, Llama 3.1 8B). To use a bigger model or a different provider:

1. Change `AI_PROVIDER` in `wrangler.jsonc`:

```jsonc
"vars": {
  "AI_PROVIDER": "openai",    // or: anthropic, deepseek, google, grok
  "MODEL_ID": "gpt-4o-mini",  // optional model override
}
```

2. Set the API key as a secret:

```bash
pnpm exec wrangler secret put OPEN_AI_API_KEY
# paste your key when prompted
```

Supported providers and their secret names:

| Provider | `AI_PROVIDER` | Secret |
|----------|--------------|--------|
| Workers AI | `workers-ai` | *(none needed)* |
| OpenAI | `openai` | `OPEN_AI_API_KEY` |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` |
| Google | `google` | `GOOGLE_API_KEY` |
| xAI/Grok | `grok` | `GROK_API_KEY` |

## Architecture

```
Browser (Chat UI)
  |
  v
Cloudflare Worker (Hono router)
  |
  |-- GET  /                          -> Playground HTML
  |-- POST /agent/simple-prompt/chat  -> SimplePromptAgent (Durable Object)
  |-- POST /agent/dependent/chat      -> DependentAgent (Durable Object)
  |                                        |-- uses MCP tools via ToolboxService
  |                                        |-- extracts image/audio from tool results
  |-- POST /api/tts                   -> VoiceMcpServer /tts endpoint
  |-- GET  /media/image/:id           -> ImageMcpServer (serves generated PNGs)
  |-- GET  /media/audio/:id           -> VoiceMcpServer (serves generated audio)
  |-- ALL  /mcp/{todo,expense,...}/*   -> MCP Servers (external MCP access)
  |-- GET  /health                    -> Health check
```

Everything runs inside **one worker**. Agents call MCP servers through internal Durable Object bindings -- zero subrequests, zero latency overhead.

## Project Structure

```
examples/single-worker/
  src/
    index.ts          -- Hono routes, playground UI, media serving, worker export
    agents.ts         -- SimplePromptAgent + DependentAgent (Durable Objects)
    mcp-servers.ts    -- 6 MCP servers (Todo, Expense, EnvVar, Secret, Image, Voice)
  wrangler.jsonc      -- Worker config + Durable Object bindings
  .dev.vars.example   -- API key template for local dev
```

## Packages

- `@nullshot/agent` -- Agent base classes, Playground UI generator, ToolboxService
- `@nullshot/mcp` -- MCP server base class (`McpHonoServerDO`)
- `ai` + `@ai-sdk/*` -- Vercel AI SDK for multi-provider LLM
- `hono` -- HTTP framework
- `workers-ai-provider` -- Workers AI adapter for Vercel AI SDK
