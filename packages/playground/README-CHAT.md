# AI Agent Chat Playground

A beautiful, mobile-responsive chat interface built with AI Elements and Next.js for connecting to AI agents.

## Features

- 🎨 Beautiful animated background inspired by nullshot.ai
- 💬 Floating chat interface with AI Elements components
- 🔄 Agent switching with dropdown selector
- 📱 Mobile responsive design
- 🛠️ Tool calling support
- 🎯 Real-time connection status
- ✨ Smooth animations and transitions

## Environment Setup

Create a `.env.local` file in the playground directory with the following variables:

```env
# Default agent configuration
NEXT_PUBLIC_DEFAULT_AGENT_URL=http://localhost:8787
NEXT_PUBLIC_DEFAULT_AGENT_NAME=Local Agent

# Additional agents (optional, comma-separated)
NEXT_PUBLIC_ADDITIONAL_AGENTS=Production Agent|https://your-production-agent.com,Staging Agent|https://your-staging-agent.com
```

## Installation

1. **Install AI Elements**:

   ```bash
   npx ai-elements@latest
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```

## Usage

1. **Default Connection**: The chat automatically connects to your default agent (localhost:8787 by default)

2. **Agent Selection**: Use the dropdown in the chat header to switch between different agents

3. **Chat Interface**:
   - Click the floating chat button to open the interface
   - Type messages and receive responses from your agent
   - Use the minimize/maximize buttons to control the chat size
   - Copy, like, or retry messages using the action buttons

4. **Tool Support**: The interface automatically displays tool calls and their results when your agent uses functions

## Agent Requirements

Your agent should expose the following endpoints:

1. **Chat Endpoint**: `POST /agent/chat/:sessionId?`

   ```typescript
   {
     messages: Array<{
       role: "user" | "assistant" | "system";
       content: string;
     }>;
   }
   ```

   - If no sessionId provided, agent creates one automatically
   - Returns streaming text response

2. **Health Check**: `GET /` (root endpoint)
   - Any response (including 404) indicates agent is alive
   - Used for connection status indicator

The chat interface calls your agent directly from the browser using AI SDK's DefaultChatTransport - no server-side proxy or API routes needed!

## Customization

### Design System

All colors and spacing use CSS variables defined in `src/app/globals.css`. Modify these variables to match your brand:

- `--gradient-animated-1`: Primary animated background gradient
- `--chat-background`: Chat container background
- `--message-user-bg`: User message background color
- `--message-ai-bg`: AI message background color

### Agent Configuration

Modify `src/lib/config.ts` to customize agent parsing and default configuration.

### Animations

Background animations can be customized in `src/components/animated-background.tsx`.

## AI Elements Integration

Once AI Elements is installed, replace the placeholder components in `src/components/floating-chat.tsx`:

```typescript
// Replace these imports:
import {
  Conversation,
  Message,
  PromptInput,
  Tool,
  Actions,
} from "@/components/ai-elements";

// And update the component implementations to use AI Elements
```

## Mobile Responsiveness

The chat interface adapts to different screen sizes:

- **Mobile**: Full-screen overlay
- **Tablet**: Larger floating window
- **Desktop**: Fixed-size floating chat box

## Development Notes

- The interface uses Framer Motion for smooth animations
- Backdrop blur effects provide glassmorphism styling
- Connection status is checked every 30 seconds
- Messages auto-scroll to bottom on new content
