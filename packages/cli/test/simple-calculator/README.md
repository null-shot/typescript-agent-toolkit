# Nullshot Beta

A modern React 19 template with Vite, Tailwind CSS v4, and Cloudflare Workers.

## Features

- **React 19** - Latest React with new features
- **Vite** - Fast dev server with instant HMR
- **Tailwind CSS v4** - Utility-first styling
- **TypeScript** - Type-safe development
- **Hono** - Lightweight API framework for Workers
- **React Query** - Data fetching and caching

## Local Development

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev
```

## File Structure

```
src/
├── react-app/
│   ├── app.tsx       # Main React component
│   ├── main.tsx      # Client entry point
│   └── globals.css   # Tailwind + global styles
└── worker/
    └── index.ts      # Hono API routes + asset serving
```

## API Routes

Routes are defined in `/src/worker/index.ts`:

- `GET /api/health` - Health check
- `GET /api/` - API info
- `POST /api/echo` - Echo request body
- `GET /api/data` - Example data endpoint

All other routes serve the React SPA.
