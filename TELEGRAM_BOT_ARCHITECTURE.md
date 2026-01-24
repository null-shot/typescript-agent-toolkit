# Telegram Bot Architecture - Design Options

## Overview

We need to create a Telegram bot backend that:
1. Receives messages from Telegram
2. Forwards them to an agent
3. Gets responses from the agent
4. Sends responses back to Telegram

## Architecture Options

### Option 1: Self-Contained Agent with Telegram Bridge (Recommended)

**Structure:** `examples/telegram-bot-agent/`

```
examples/telegram-bot-agent/
├── src/
│   ├── index.ts              # Main worker with Telegram webhook handler
│   ├── agent.ts              # Agent class (extends AiSdkAgent)
│   ├── telegram-bridge.ts    # Telegram API wrapper
│   └── session-manager.ts    # Maps Telegram chatId to agent sessionId
├── package.json
├── wrangler.jsonc
└── .dev.vars
```

**Pros:**
- ✅ Simple, all-in-one solution
- ✅ Easy to deploy and test
- ✅ Follows existing agent pattern
- ✅ Each Telegram chat = separate agent session

**Cons:**
- ❌ Tightly coupled to one agent
- ❌ Can't reuse with other agents easily

**Flow:**
```
Telegram → Webhook → Worker → Telegram Bridge → Agent Durable Object → AI Provider
                ↓
         Telegram API (send message)
```

**Implementation:**
- Telegram webhook endpoint: `POST /webhook`
- Session mapping: `chatId` → `sessionId` (stored in KV or DO state)
- Streaming handling: Buffer response chunks, send when complete or at intervals

---

### Option 2: Separate Telegram Bridge Service

**Structure:** `packages/telegram-bridge/` + use existing agents

```
packages/telegram-bridge/
├── src/
│   ├── index.ts              # Telegram webhook handler
│   ├── telegram-client.ts    # Telegram Bot API client
│   ├── agent-client.ts       # HTTP client for agents
│   └── session-manager.ts    # Session management
└── package.json

examples/telegram-bot-agent/
└── src/
    └── index.ts              # Simple agent (reuses simple-prompt-agent)
```

**Pros:**
- ✅ Reusable bridge for any agent
- ✅ Separation of concerns
- ✅ Can switch agents without changing Telegram code
- ✅ Can be published as separate package

**Cons:**
- ❌ More complex setup
- ❌ Requires agent URL configuration
- ❌ Two separate deployments

**Flow:**
```
Telegram → Telegram Bridge Worker → HTTP → Agent Worker → Agent DO → AI
                ↓
         Telegram API
```

**Configuration:**
```env
TELEGRAM_BOT_TOKEN=...
AGENT_URL=http://localhost:8787  # or deployed agent URL
```

---

### Option 3: Hybrid - Telegram Bridge with Embedded Agent

**Structure:** `examples/telegram-bot-agent/` with bridge utilities

```
examples/telegram-bot-agent/
├── src/
│   ├── index.ts              # Worker entry point
│   ├── agent.ts              # Agent implementation
│   ├── telegram/
│   │   ├── webhook.ts        # Webhook handler
│   │   ├── client.ts         # Telegram API client
│   │   └── message-handler.ts # Message processing
│   └── bridge/
│       └── agent-bridge.ts   # Agent communication layer
└── package.json
```

**Pros:**
- ✅ Best of both worlds
- ✅ Can extract bridge later if needed
- ✅ Clean separation within one project
- ✅ Easy to understand and maintain

**Cons:**
- ❌ Still somewhat coupled
- ❌ Bridge code duplicated if used elsewhere

---

## Recommended Solution: Option 1 (Self-Contained)

### Why Option 1?

1. **Simplicity**: Matches existing agent examples pattern
2. **Deployment**: Single worker to deploy
3. **Session Management**: Natural mapping (chatId = sessionId)
4. **Development**: Easy to test locally with ngrok/webhook

### Implementation Details

#### Session Management
```typescript
// chatId (Telegram) → sessionId (Agent)
// Use KV or DO state to persist mapping
const sessionId = await getOrCreateSession(chatId);
```

#### Message Flow
```typescript
// 1. Receive Telegram webhook
app.post('/webhook', async (c) => {
  const update = await c.req.json();
  const chatId = update.message.chat.id;
  const text = update.message.text;
  
  // 2. Forward to agent
  const sessionId = await getSessionId(chatId);
  const agentResponse = await fetch(`${AGENT_URL}/agent/chat/${sessionId}`, {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: text }] })
  });
  
  // 3. Stream response and send to Telegram
  await streamToTelegram(chatId, agentResponse);
});
```

#### Streaming Handling
- Telegram has 4096 character limit per message
- Need to buffer and split long responses
- Send typing indicator while processing
- Handle tool calls (show as formatted text or buttons)

#### Webhook vs Polling
- **Webhook** (recommended): More efficient, real-time
- **Polling**: Simpler for development, less efficient

---

## File Structure (Option 1)

```
examples/telegram-bot-agent/
├── src/
│   ├── index.ts                    # Worker entry, webhook handler
│   ├── agent.ts                    # SimplePromptAgent (or reuse)
│   ├── telegram/
│   │   ├── client.ts               # Telegram Bot API wrapper
│   │   ├── webhook.ts              # Webhook validation & parsing
│   │   └── message-formatter.ts   # Format agent responses for Telegram
│   └── session.ts                  # Session management (chatId → sessionId)
├── package.json
├── wrangler.jsonc
├── .dev.vars
└── README.md
```

## Environment Variables

```env
# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_WEBHOOK_SECRET=optional_secret

# Agent (if using external agent)
AGENT_URL=http://localhost:8787  # Optional, defaults to same worker

# AI Provider
AI_PROVIDER=openai
OPENAI_API_KEY=...
```

## Development Setup

```bash
# 1. Create bot with @BotFather
# 2. Get token
# 3. Set webhook (or use polling for dev)

# Local development with ngrok
ngrok http 8787
# Set webhook: https://api.telegram.org/bot<TOKEN>/setWebhook?url=<ngrok_url>/webhook

# Run
cd examples/telegram-bot-agent
pnpm dev
```

## Key Considerations

1. **Rate Limiting**: Telegram has rate limits (30 messages/second)
2. **Message Length**: Split long responses into multiple messages
3. **Error Handling**: Graceful error messages to users
4. **Privacy**: Don't log sensitive user data
5. **Session Persistence**: Use KV or DO state for session mapping
6. **Webhook Security**: Validate webhook requests (optional but recommended)

## Next Steps

1. Create `examples/telegram-bot-agent/` directory
2. Copy agent structure from `simple-prompt-agent`
3. Add Telegram webhook handler
4. Implement message forwarding
5. Add response streaming/splitting
6. Test with local ngrok setup
