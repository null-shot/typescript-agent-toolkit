# AGENTS.md - MCP Package

## Build/Run Commands
- Build: `pnpm run build` (uses tsc)
- Dev mode: `pnpm run dev` (wrangler dev)
- Run tests: `pnpm run test` (vitest)
- Run single test: `pnpm run test src/mcp/sse-transport.test.ts`
- Typecheck: `pnpm run type-check` (tsc --noEmit)
- Deploy: `pnpm run deploy` (wrangler deploy)

## Code Style Guidelines
- Use double quotes for strings, no semicolons
- Use tabs for indentation, strict TypeScript
- No unused locals/parameters, exact optional property types
- Use ES2021 target and ES2022 modules for Cloudflare Workers
- Import paths use relative paths for local imports

## Naming Conventions
- Files: kebab-case, Types: PascalCase
- Functions/variables: camelCase, Constants: UPPER_SNAKE_CASE
- Test files: *.test.ts, Tools/Resources: snake_case

## Error Handling & Testing
- Use try/catch for async operations with meaningful messages
- Use vitest with Cloudflare Workers pool, tests alongside source files
- Tests run with isolated storage disabled for Durable Objects

## Development Practices
- Follow MCP patterns from ../../.cursor/rules/mcp-development.mdc
- Extend McpHonoServerDO, use Zod schemas with .describe()
- Always call super.setupRoutes() when overriding setupRoutes()