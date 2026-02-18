# Telegram Bot Agent

A Telegram bot backend that connects to AI agents, providing an alternative to the web frontend (Playground).

**Built with:**
- 🎯 [Grammy](https://grammy.dev/) - Modern, type-safe Telegram Bot framework (2025 best practice)
- ⚡ Cloudflare Workers - Edge computing platform
- 🔒 TypeScript - Full type safety
- 📦 Hono - Fast web framework

## Architecture

```
Telegram User → Telegram Bot API → Telegram Bot Worker → Agent Worker → AI Provider
                                      ↓
                              Telegram API (send response)
```

## Features

- ✅ **Grammy Integration** - Modern, type-safe Telegram Bot library
- ✅ **Multi-Agent Support** - Switch between multiple AI agents with `/agent` command
- ✅ **Webhook-based** - No polling, real-time message handling
- ✅ **Streaming Responses** - Real-time updates as agent responds
- ✅ **Session Management** - Persistent sessions via KV storage (per-agent isolation)
- ✅ **Long Messages** - Automatic splitting (Telegram 4096 char limit)
- ✅ **Error Handling** - Graceful error messages to users
- ✅ **Type Safety** - Full TypeScript support
- ✅ **Cloudflare Optimized** - Built for edge computing

## Setup

### 1. Create Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` command
3. Follow instructions to create your bot
4. Copy the bot token (looks like: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Configure Environment

Copy the example file and add your bot token:

```bash
cd examples/telegram-bot-agent
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` and add your bot token:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
AGENT_URL=http://localhost:8787
```

**Note:** Wrangler automatically reads `.dev.vars` in local development. The token is already configured to be read from `env.TELEGRAM_BOT_TOKEN` in the code.

### 3. Start Agent (if using external agent)

If you want to connect to `simple-prompt-agent`, start it first:

```bash
cd examples/simple-prompt-agent
pnpm dev
```

This will start the agent on `http://localhost:8787`.

### 4. Start Telegram Bot

```bash
cd examples/telegram-bot-agent
pnpm dev
```

### 5. Set Webhook (for production)

For local development, you can use polling or set up a webhook with ngrok:

```bash
# Install ngrok: https://ngrok.com/
ngrok http 8789

# Set webhook (replace with your ngrok URL)
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-ngrok-url.ngrok.io/webhook"
```

For production deployment:

```bash
# After deploying
pnpm deploy

# Set webhook to your deployed URL
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-bot.workers.dev/webhook"
```

## Usage

1. Find your bot on Telegram (search for the username you set)
2. Start a conversation with `/start`
3. Send messages - they will be forwarded to the agent
4. Receive AI responses in Telegram

## Development

### Local Development with Polling

For local development, you can use polling instead of webhooks:

```typescript
// In src/index.ts, uncomment polling mode
// This will periodically check for new messages
```

### Testing

```bash
# Test webhook endpoint
curl -X POST http://localhost:8789/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "update_id": 1,
    "message": {
      "message_id": 1,
      "from": {"id": 123, "first_name": "Test"},
      "chat": {"id": 123},
      "text": "Hello"
    }
  }'
```

## Deployment

```bash
# Deploy to Cloudflare
pnpm deploy

# Set secrets (for production - .dev.vars is only for local dev)
wrangler secret put TELEGRAM_BOT_TOKEN
# Enter your bot token when prompted

# Set webhook
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-bot.workers.dev/webhook"
```

**Note:** 
- `.dev.vars` is used for **local development only**
- For **production**, use `wrangler secret put TELEGRAM_BOT_TOKEN`
- The code reads from `env.TELEGRAM_BOT_TOKEN` in both cases

## Configuration

### Environment Variables

- `TELEGRAM_BOT_TOKEN` - Your Telegram bot token (required)
- `AGENT_URL` - Default agent URL (fallback if no agent selected)
- `AGENTS` - List of available agents (format below)
- `TELEGRAM_WEBHOOK_SECRET` - Optional secret for webhook validation

### Multiple Agents Configuration

The `AGENTS` environment variable allows users to select from multiple AI agents:

```bash
# Format: "name1|url1|description1,name2|url2|description2"

# Example with two agents:
AGENTS="Simple Agent|https://simple-prompt-agent.workers.dev|Default AI assistant,Queue Agent|https://queues-agent.workers.dev|Async processing agent"
```

Set via wrangler:
```bash
wrangler secret put AGENTS
# Paste the agents string when prompted
```

### Bot Commands

- `/start` - Start conversation, shows current agent
- `/help` - Show available commands
- `/agent` - Select AI agent (shows inline keyboard)
- `/status` - Check current agent connection
- `/clear` - Clear conversation history

### Agent URL Options

1. **Local Agent**: `http://localhost:8787` (for development)
2. **Deployed Agent**: `https://simple-prompt-agent.workers.dev` (for production)
3. **Multiple Agents**: Configure `AGENTS` env var for agent selection

## Architecture Details

### Session Management

Each Telegram chat gets a unique agent session:
- `chatId` (Telegram) → `sessionId` (Agent)
- Sessions are stored in KV or Durable Object state
- Each user has their own conversation context

### Message Flow

1. User sends message in Telegram
2. Telegram sends webhook to `/webhook` endpoint
3. Bot extracts `chatId` and message text
4. Bot gets/creates `sessionId` for this chat
5. Bot forwards message to agent: `POST /agent/chat/:sessionId`
6. Agent processes and returns streaming response
7. Bot buffers response chunks
8. Bot sends complete response to Telegram

### Long Messages

Telegram has a 4096 character limit per message. The bot automatically:
- Splits long responses into multiple messages
- Sends typing indicator while processing
- Handles tool calls (formats as text)

## Troubleshooting

### Bot not responding

1. Check bot token is correct in `.dev.vars`
2. Verify webhook is set correctly
3. Check worker logs: `wrangler tail`
4. Ensure agent is running and accessible

### Webhook errors

- Verify webhook URL is accessible (not behind firewall)
- Check webhook secret matches (if configured)
- Ensure HTTPS is used (Telegram requires it)

### Agent connection errors

- Verify `AGENT_URL` is correct
- Check agent is running
- Test agent endpoint directly: `curl http://localhost:8787/`

## Next Steps

- [x] Add support for inline keyboards (agent selection)
- [x] Add command handlers (`/start`, `/help`, `/agent`, `/status`, `/clear`)
- [x] Multi-agent support with `/agent` command
- [ ] Add support for images and files
- [ ] Add rate limiting
- [ ] Add user authentication
