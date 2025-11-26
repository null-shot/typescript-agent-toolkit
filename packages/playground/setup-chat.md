# Setup Instructions for AI Agent Chat Playground

## Quick Start

### 1. Install Dependencies

```bash
cd packages/playground
npm install
```

### 2. Install AI Elements

```bash
npx ai-elements@latest
```

This will:

- Install the AI Elements component library
- Set up shadcn/ui if not already configured
- Add necessary AI Elements components to your project

### 3. Environment Configuration

Create a `.env.local` file in the `packages/playground` directory:

```bash
# Default agent configuration
NEXT_PUBLIC_DEFAULT_AGENT_URL=http://localhost:8787
NEXT_PUBLIC_DEFAULT_AGENT_NAME=Local Agent

# Additional agents (optional)
NEXT_PUBLIC_ADDITIONAL_AGENTS=Production Agent|https://your-production-agent.com,Staging Agent|https://your-staging-agent.com
```

### 4. Start Development Server

```bash
npm run dev
```

Visit `http://localhost:3000` to see your AI agent playground.

## AI Elements Integration

After installing AI Elements, update the imports in `src/components/floating-chat.tsx`:

```typescript
// Replace placeholder implementations with:
import {
  Conversation,
  Message,
  PromptInput,
  Tool,
  Actions,
  Response,
  Loader,
} from "@/components/ai-elements";
```

Then update the component implementations to use the actual AI Elements components instead of the custom implementations.

## Agent Connection

The chat interface expects your agent to have:

1. **Chat Endpoint**: `POST /api/chat`

   ```typescript
   // Request format
   {
     messages: Array<{
       role: "user" | "assistant" | "system";
       content: string;
     }>;
   }
   ```

2. **Health Check** (optional): `GET /health`
   - Returns 200 OK if agent is healthy
   - Used for connection status indicator

## Customization

### Colors and Theming

Edit CSS variables in `src/app/globals.css`:

- `--gradient-animated-1`: Main background gradient
- `--chat-background`: Chat container background
- `--message-user-bg`: User message color
- `--message-ai-bg`: AI message color

### Background Animation

Modify `src/components/animated-background.tsx` to change:

- Number and size of floating orbs
- Animation speed and patterns
- Grid overlay opacity

### Agent Configuration

Update `src/lib/config.ts` to change:

- Default agent settings
- Agent parsing logic
- Connection handling

## Mobile Responsiveness

The interface automatically adapts:

- **Mobile (< 640px)**: Full-screen overlay
- **Tablet (640px - 1024px)**: Large floating window
- **Desktop (> 1024px)**: Fixed-size chat box

## Troubleshooting

### Common Issues

1. **Agent not connecting**: Check that your agent is running on the specified URL
2. **CORS errors**: Ensure your agent allows requests from localhost:3000
3. **AI Elements not working**: Make sure you've run `npx ai-elements@latest`

### Development

- Check browser console for connection errors
- Verify environment variables are loaded correctly
- Test agent endpoints directly with curl or Postman

## Next Steps

1. Install AI Elements and integrate the components
2. Configure your actual agent endpoints
3. Customize the design to match your brand
4. Add more tool functions as needed
5. Deploy to Cloudflare Pages or Vercel

