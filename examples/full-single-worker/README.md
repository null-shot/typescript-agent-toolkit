# Single Worker Example

**The simplest way to deploy an AI Agent with MCP tools on Cloudflare Workers**

This example demonstrates the **single-worker architecture**:

- **One worker handles everything** — Agent, MCP servers, Telegram Bot, Dashboard
- **0 subrequests** — All components communicate via Durable Objects
- **Auto-discovery** — ToolboxService automatically finds and connects to MCP servers
- **PIN-protected Dashboard** — Telegram Bot sends a PIN to unlock the Manager Dashboard

---

## Table of Contents

1. [Quick Start (Local Dev)](#quick-start-local-dev)
2. [Deploy with CLI Wizard](#deploy-with-cli-wizard)
3. [Manual Deploy](#manual-deploy)
4. [Telegram Bot Setup](#telegram-bot-setup)
5. [Dashboard Authentication](#dashboard-authentication)
6. [API Endpoints](#api-endpoints)
7. [Available MCP Tools](#available-mcp-tools)
8. [AI Providers](#ai-providers)
9. [Architecture](#architecture)
10. [Customization](#customization)
11. [Testing](#testing)
12. [Troubleshooting](#troubleshooting)

---

## Quick Start (Local Dev)

### Prerequisites

- Node.js >= 20
- pnpm (package manager)
- A Cloudflare account (for deploy, not needed for local)
- An API key from at least one AI provider

### 1. Install dependencies

```bash
# From the repo root
pnpm install

# Or just this example
cd examples/full-single-worker
pnpm install
```

### 2. Configure environment

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` — at minimum set an AI provider and API key:

```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
```

### 3. Run locally

```bash
pnpm dev
# → http://localhost:8800
```

### 4. Open the Playground

Open http://localhost:8800 — you'll see the chat UI with agent selector.

Try:

- "Create a todo: buy milk"
- "Show all my todos"
- "Submit an expense: $42 for lunch"
- "What's 42?" (secret number guessing)

---

## Deploy with CLI Wizard

The `nullshot deploy` wizard handles everything automatically:

```bash
# From the repo root
pnpm nullshot deploy
```

The wizard will:

1. **Select AI Agents** — SimplePromptAgent, DependentAgent
2. **Select MCP Servers** — todo, expense, env-variable, secret
3. **Playground UI** — yes/no
4. **Telegram Bot** — prompts for bot token and webhook secret
5. **AI Provider** — Anthropic, OpenAI, Google, DeepSeek, xAI
6. **Auto-create KV namespace** for Telegram sessions
7. **Set secrets** via `wrangler secret put`
8. **Deploy** to Cloudflare Workers
9. **Configure Telegram webhook** automatically

After deploy you get a URL like `https://nullshot-worker.your-subdomain.workers.dev`

### What the wizard sets up

| Resource                  | How                                             |
| ------------------------- | ----------------------------------------------- |
| Durable Objects           | Automatically from selected agents/MCPs         |
| KV Namespace (`SESSIONS`) | Auto-created via `wrangler kv namespace create` |
| AI Provider API Key       | `wrangler secret put` (encrypted)               |
| Telegram Bot Token        | `wrangler secret put` (encrypted)               |
| Telegram Webhook          | Auto-set via Telegram API after deploy          |

### Skip secrets (redeploy)

```bash
pnpm nullshot deploy --skip-secrets
```

---

## Manual Deploy

### 1. Create KV namespace

```bash
wrangler kv namespace create SESSIONS
# Copy the ID and update wrangler.jsonc
```

### 2. Set secrets

```bash
# AI provider key
wrangler secret put ANTHROPIC_API_KEY
# or OPEN_AI_API_KEY, GOOGLE_API_KEY, DEEPSEEK_API_KEY, GROK_API_KEY

# Telegram (if using)
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

### 3. Deploy

```bash
pnpm run deploy              # Default
pnpm run deploy:staging      # Staging env
pnpm run deploy:prod         # Production env
pnpm run deploy:openai       # OpenAI provider
pnpm run deploy:deepseek     # DeepSeek provider
```

### 4. Set up Telegram webhook

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-worker.workers.dev/telegram/webhook&secret_token=<YOUR_WEBHOOK_SECRET>&allowed_updates=%5B%22message%22,%22channel_post%22,%22callback_query%22,%22my_chat_member%22,%22chat_member%22%5D"
```

---

## Telegram Bot Setup

### Create a bot

1. Open Telegram, search for **@BotFather**
2. Send `/newbot`, follow the prompts
3. Copy the bot token (looks like `1234567890:ABCdefGHIjklMNOpqr`)

### Add to `.dev.vars` (local)

```env
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqr
TELEGRAM_WEBHOOK_SECRET=any-random-string
```

### Set webhook (after deploy)

The CLI wizard does this automatically. For manual setup:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-worker.workers.dev/telegram/webhook&secret_token=<SECRET>"
```

### Bot commands

| Command     | Description                       |
| ----------- | --------------------------------- |
| `/start`    | Initialize bot, get dashboard PIN |
| `/pin`      | Regenerate dashboard PIN          |
| `/help`     | Show all commands                 |
| `/agent`    | Switch AI agent                   |
| `/setup`    | Configure bot settings            |
| `/channels` | List connected channels           |
| `/post`     | Post to a channel                 |
| `/schedule` | Schedule a post                   |
| `/moderate` | Moderation settings               |
| `/mychats`  | Show bot's groups/channels        |

---

## Dashboard Authentication

The Manager Dashboard is protected by a PIN code.

### First-Time Setup (Bootstrap Flow)

After deploying, you need to complete these steps **in order**:

1. **Set the webhook** — The bot can't receive messages until the webhook is configured.
   The webhook endpoint is accessible without a PIN during initial setup:

   ```bash
   curl -X POST "https://your-worker.workers.dev/api/dashboard/webhook" \
     -H "Content-Type: application/json" \
     -d '{"auto": true}'
   ```

   Or use the CLI wizard: `pnpm nullshot deploy`

2. **Send `/start`** to the bot in a **private Telegram chat**.
   The bot responds with a welcome message and a 6-digit PIN (first time only).

   > **Note:** If `ADMIN_CHAT_IDS` is set, only listed user IDs receive a PIN.

3. **Open the Dashboard** — Go to your worker URL → Dashboard tab.
   Enter the PIN to unlock the dashboard.

### Regenerate PIN

Send `/pin` to the bot. The old PIN is immediately invalidated.

### Admin Whitelist

Set `ADMIN_CHAT_IDS` (env var or in `wrangler.jsonc`) to restrict who can manage the bot:

```bash
# Single admin
wrangler secret put ADMIN_CHAT_IDS
# Enter: 123456789

# Multiple admins (comma-separated)
wrangler secret put ADMIN_CHAT_IDS
# Enter: 123456789,987654321
```

If `ADMIN_CHAT_IDS` is empty or not set, **any user** can generate a PIN — this is fine for development but not recommended for production.

To find your Telegram user ID, send `/start` to [@userinfobot](https://t.me/userinfobot).

### Security

- **PIN hashing** — PIN is stored as SHA-256 hash in KV (not plaintext)
- **Rate limiting** — Max 5 PIN attempts per 15 minutes, then locked out
- **Admin whitelist** — `ADMIN_CHAT_IDS` restricts PIN generation to authorized users
- **Webhook verification** — `TELEGRAM_WEBHOOK_SECRET` validates incoming updates
- All `/api/dashboard/*` endpoints require valid `X-Dashboard-Pin` header
- `POST /api/auth/login` validates PIN with rate limiting
- `GET /api/auth/status` checks if PIN is configured
- Dashboard has a Logout button to clear saved PIN

---

## API Endpoints

### Public

| Endpoint          | Description         |
| ----------------- | ------------------- |
| `GET /`           | Playground UI       |
| `GET /health`     | Health check        |
| `GET /api/info`   | Worker metadata     |
| `GET /api/agents` | Available agents    |
| `GET /api/tools`  | Available MCP tools |

### Agent Chat

| Endpoint                                     | Description                     |
| -------------------------------------------- | ------------------------------- |
| `POST /agent/simple-prompt/chat/:sessionId?` | Simple Prompt Agent             |
| `POST /agent/dependent/chat/:sessionId?`     | Dependent Agent (with tools)    |
| `POST /agent/chat/:sessionId?`               | Default agent (backward compat) |

### MCP Servers (SSE)

| Endpoint                  | Description              |
| ------------------------- | ------------------------ |
| `ALL /mcp/todo/*`         | Todo MCP Server          |
| `ALL /mcp/expense/*`      | Expense MCP Server       |
| `ALL /mcp/env-variable/*` | Environment Variable MCP |
| `ALL /mcp/secret/*`       | Secret Number MCP        |

### Auth (no PIN required)

| Endpoint               | Description                      |
| ---------------------- | -------------------------------- |
| `POST /api/auth/login` | Validate PIN `{ pin: "123456" }` |
| `GET /api/auth/status` | Check if PIN is configured       |

### Dashboard (PIN required — `X-Dashboard-Pin` header)

| Endpoint                                  | Description           |
| ----------------------------------------- | --------------------- |
| `GET /api/dashboard`                      | Full dashboard data   |
| `GET /api/dashboard/bot-settings`         | Bot configuration     |
| `PUT /api/dashboard/bot-settings/name`    | Update bot name       |
| `GET /api/dashboard/settings/:chatId`     | Chat settings         |
| `POST /api/dashboard/settings/moderation` | Update moderation     |
| `GET /api/dashboard/webhook`              | Webhook status        |
| `POST /api/dashboard/webhook`             | Set webhook           |
| `DELETE /api/dashboard/webhook`           | Remove webhook        |
| `DELETE /api/dashboard/scheduled/:key`    | Cancel scheduled post |

### Telegram Webhook

| Endpoint                 | Description                                  |
| ------------------------ | -------------------------------------------- |
| `POST /telegram/webhook` | Telegram webhook (validated by secret token) |

---

## Available MCP Tools

The Dependent Agent auto-discovers all MCP tools:

### Todo MCP (4 tools)

| Tool            | Description            |
| --------------- | ---------------------- |
| `create_todo`   | Create a new todo item |
| `list_todos`    | List all todos         |
| `complete_todo` | Mark todo as done      |
| `delete_todo`   | Delete a todo          |

### Expense MCP (4 tools)

| Tool              | Description                 |
| ----------------- | --------------------------- |
| `submit_expense`  | Submit expense for approval |
| `approve_expense` | Approve expense             |
| `reject_expense`  | Reject expense              |
| `list_expenses`   | List all expenses           |

### Environment Variable MCP (1 tool)

| Tool       | Description                       |
| ---------- | --------------------------------- |
| `greeting` | Greet with env-based default name |

### Secret MCP (1 tool)

| Tool           | Description                           |
| -------------- | ------------------------------------- |
| `guess_number` | Guess the secret number (default: 42) |

---

## AI Providers

Set `AI_PROVIDER` in `.dev.vars` (local) or as a Cloudflare secret (deployed):

| Provider  | `AI_PROVIDER` value  | Default Model             | API Key var         |
| --------- | -------------------- | ------------------------- | ------------------- |
| Anthropic | `anthropic`          | `claude-3-haiku-20240307` | `ANTHROPIC_API_KEY` |
| OpenAI    | `openai`             | `gpt-4o-mini`             | `OPEN_AI_API_KEY`   |
| Google    | `google` or `gemini` | `gemini-2.0-flash`        | `GOOGLE_API_KEY`    |
| DeepSeek  | `deepseek`           | `deepseek-chat`           | `DEEPSEEK_API_KEY`  |
| xAI       | `grok` or `xai`      | `grok-beta`               | `GROK_API_KEY`      |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Single Worker                              │
│                                                                    │
│  ┌────────────┐  ┌────────────────┐  ┌────────────────────────┐  │
│  │ Playground  │  │ SimplePrompt   │  │   MCP Servers (DO)     │  │
│  │     UI      │  │    Agent (DO)  │  │                        │  │
│  │  + Auth     │  │                │  │  Todo    Expense       │  │
│  │  + Dashboard│  │  AI SDK        │  │  EnvVar  Secret        │  │
│  └────────────┘  │  Streaming     │  │                        │  │
│                   └────────────────┘  └────────────────────────┘  │
│                                              ▲                     │
│  ┌────────────┐  ┌────────────────┐          │ Auto-discovery     │
│  │ Telegram   │  │ Dependent      │──────────┘                     │
│  │    Bot     │  │    Agent (DO)  │  ToolboxService                │
│  │  Webhook   │  │  Multi-step    │                                │
│  └────────────┘  └────────────────┘                                │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ KV: SESSIONS — bot sessions, chat data, scheduled posts     │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

---

## Testing

```bash
# Run all MCP server tests
pnpm test

# Watch mode
pnpm test:watch
```

Tests cover all 4 MCP servers (34 tests total):

- `test/todo-mcp.test.ts` — CRUD operations
- `test/expense-mcp.test.ts` — Submit, approve, reject, list
- `test/env-variable-mcp.test.ts` — Greeting with default/custom names
- `test/secret-mcp.test.ts` — Number guessing (higher/lower/correct)

---

## Customization

### Add a new MCP server

1. Add a Durable Object class extending `McpHonoServerDO`:

```typescript
export class MyMcpServer extends McpHonoServerDO<Env> {
  getImplementation() {
    return { name: "MyMcpServer", version: "1.0.0" };
  }
  configureServer(server: McpServer): void {
    server.tool(
      "my_tool",
      "Description",
      {
        param: z.string().describe("A parameter"),
      },
      async ({ param }) => {
        return { content: [{ type: "text", text: `Result: ${param}` }] };
      },
    );
  }
}
```

2. Add to `wrangler.jsonc`:

```jsonc
"durable_objects": {
  "bindings": [
    // ... existing
    { "name": "MY_MCP", "class_name": "MyMcpServer" }
  ]
}
```

3. Add route and export in `index.ts` — the agent will **auto-discover** it!

### Change Playground theme

```typescript
setupPlaygroundRoutes(app, {
  agents,
  title: "My AI Agent",
  primaryColor: "#10b981",
  secondaryColor: "#059669",
});
```

---

## Troubleshooting

### "No PIN configured" in Dashboard

1. Make sure the webhook is set first (see [Bootstrap Flow](#first-time-setup-bootstrap-flow))
2. Send `/start` to the bot in a **private chat** (not a group)
3. If `ADMIN_CHAT_IDS` is set, make sure your Telegram user ID is in the list

### Bot doesn't respond to /start

1. Check webhook is set: `curl https://your-worker.workers.dev/api/dashboard/webhook`
2. If no webhook, set it: `curl -X POST https://your-worker.workers.dev/api/dashboard/webhook -H "Content-Type: application/json" -d '{"auto": true}'`
3. Verify `TELEGRAM_BOT_TOKEN` is set as a secret
4. Check logs: `wrangler tail`

### "Too many attempts" on PIN login

PIN login is rate-limited (5 attempts per 15 minutes). Wait 15 minutes or regenerate the PIN with `/pin` in Telegram.

### "Failed to load dashboard"

1. Check if PIN is correct
2. Try Logout → re-enter PIN
3. Check browser console for errors

### Health check shows "degraded"

Visit `GET /health` to see which component is failing:

- `kv: error` — SESSIONS KV namespace not configured
- `ai: error` — AI provider API key not set
- `telegram: skipped` — No Telegram token (optional)

### KV namespace errors on deploy

```bash
# Create manually
wrangler kv namespace create SESSIONS
# Update the ID in wrangler.jsonc
```

### Tests fail

```bash
# Make sure dependencies are installed
cd examples/full-single-worker
pnpm install

# Run tests (requires @cloudflare/vitest-pool-workers)
pnpm test
```

---

## License

MIT
