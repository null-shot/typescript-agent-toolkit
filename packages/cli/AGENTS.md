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
- Test files: *.test.ts

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