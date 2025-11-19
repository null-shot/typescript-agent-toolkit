# AGENTS.md

## Build/Run Commands

- Build: `pnpm run build` (uses tsc)
- Dev mode: `pnpm run dev` (tsx watch)
- Run tests: `pnpm run test` (vitest)
- Run single test: `pnpm run test <test-file-pattern>`
- Test watch mode: `pnpm run test:watch`
- Lint: `pnpm run lint` (eslint)
- Lint fix: `pnpm run lint:fix`
- Typecheck: `pnpm run typecheck` (tsc --noEmit)
- Format: `pnpm run format` (prettier)
- Format check: `pnpm run format:check`

## Code Style Guidelines

- Use double quotes for strings
- No semicolons
- Use tabs for indentation (TSConfig sets this)
- Strict TypeScript with all strict flags enabled
- No unused locals/parameters
- Exact optional property types
- No implicit returns/fallthrough cases
- No unchecked indexed access
- Use ESNext target and modules
- Import paths use `@/*` alias for src/
- Declaration files and source maps generated
- Resolve JSON modules enabled

## Naming Conventions

- Files: kebab-case
- Types: PascalCase
- Functions/variables: camelCase
- Constants: UPPER_SNAKE_CASE
- Test files: \*.test.ts

## Error Handling

- Use custom error classes from utils/errors.ts
- Always provide meaningful error messages
- Use logger.ts for consistent logging
- Handle dry-run mode in all mutating operations

## Testing

- Use vitest with globals
- Place tests alongside source files
- Use .test.ts extension
- Mock filesystem with memfs where needed

## Development Practices

- Use yarn for package management
- Follow workspaces pattern with packages in `packages/{project}`
- All code compatible with Cloudflare Workers runtime
- Use TypeScript for all code with proper typing
- Follow ES modules format
- Use `async`/`await` for asynchronous code
- Write tests for all functionality
- Use Wrangler for deployments to Cloudflare Workers

## Project Structure

- `packages/`: Contains all project packages
  - `mcp/`: Main MCP implementation for Cloudflare Workers
  - `test-utils/`: Utilities for testing
- `examples/`: Contains example implementations
  - `crud-mcp/`: Example CRUD application using MCP framework
  - `simple-prompt-agent/`: Example agent with only a prompt for chatting
- Main package: packages/mcp/src/index.ts
- MCP Server implementation: packages/mcp/src/mcp/server.ts
- Example application: examples/crud-mcp/src/index.ts

## Development Workflow

1. Install dependencies at root level: `pnpm install`
2. Build all packages: `pnpm build`
3. Run tests: `pnpm test`
4. For specific packages, navigate to directory and use specific scripts

