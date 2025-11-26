# AGENTS.md

## Build/Run Commands
- Dev: `pnpm run dev` (Next.js with Turbopack)
- Build: `pnpm run build` (Next.js build)
- Start: `pnpm run start` (Production server)
- Lint: `pnpm run lint` (Next.js ESLint)
- Deploy: `pnpm run deploy` (Cloudflare Workers)
- Preview: `pnpm run preview` (Cloudflare preview)
- Type gen: `pnpm run cf-typegen` (Cloudflare types)

## Code Style Guidelines
- Use double quotes for strings
- No semicolons
- Strict TypeScript with all strict flags
- Import paths use `@/*` alias for src/
- React 19 with TypeScript
- Next.js 15 App Router
- Tailwind CSS v4 with CSS variables
- shadcn/ui components in New York style
- Use lucide-react for icons
- No unused locals/parameters
- No implicit returns/fallthrough cases

## Naming Conventions
- Files: kebab-case
- Types: PascalCase
- Functions/variables: camelCase
- React components: PascalCase
- Constants: UPPER_SNAKE_CASE

## Project Structure
- `src/app/`: Next.js App Router pages
- `src/components/`: React components
- `src/components/ui/`: shadcn/ui components
- `src/components/ai-elements/`: AI SDK components
- `public/`: Static assets and avatars

## Key Technologies
- Next.js 15 with App Router
- React 19
- TypeScript with strict mode
- Tailwind CSS v4
- Cloudflare Workers deployment
- AI SDK for chat functionality
- Radix UI components
- Zod for validation