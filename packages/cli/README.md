# Nullshot CLI

A comprehensive TypeScript CLI for managing Model Context Protocol (MCP) servers and AI Agents with Cloudflare Workers, featuring dependency management, multi-config deployment, and automated service orchestration.

## 🚀 Features

- 🎯 **MCP Server & Agent Management**: Install and manage MCP servers and AI Agents from GitHub repositories
- 🔧 **Multi-Config Development**: Orchestrate multiple services with `wrangler dev` using multi-config approach
- 📦 **Smart Dependency Management**: Automatic detection of package managers (npm, yarn, pnpm)
- ⚙️ **Service Bindings**: Auto-generate Cloudflare Workers service bindings for inter-service communication
- 🗃️ **D1 Database Migrations**: Automatic detection and execution of D1 database migrations across dependencies
- 🔄 **Automated Workflows**: Integrated development workflows with npm script generation
- 🔍 **Dry Run Mode**: Preview all changes before execution
- ✅ **Schema Validation**: Type-safe configuration with comprehensive validation
- 📝 **Modern Config**: Support for JSON configuration files
- 🌍 **Working Directory Support**: `--cwd` option for flexible project management
- 💬 **Jam Inspection**: Read room messages, logs, and error reports from the CLI

## 📦 Installation

```bash
npm install -g @nullshot/cli
# or
yarn global add @nullshot/cli
# or
pnpm add -g @nullshot/cli
```

## 🏁 Quick Start

### 1. Configure Your Services

Create an `mcp.json` configuration file:

```json
{
  "mcpServers": {
    "filesystem": {
      "source": "github:modelcontextprotocol/servers#filesystem",
      "command": "npx -y @modelcontextprotocol/server-filesystem"
    },
    "github": {
      "source": "github:modelcontextprotocol/servers#github",
      "command": "npx -y @modelcontextprotocol/server-github"
    },
    "custom-mcp": {
      "source": "github:myorg/custom-mcp-server#main",
      "command": "node dist/index.js"
    }
  }
}
```

### 2. Install Dependencies

```bash
# Install all configured servers and dependencies
nullshot install
```

This will:

- Install packages from GitHub repositories
- Detect and extract Cloudflare Workers configurations
- Run D1 database migrations if present
- Generate service bindings in your `wrangler.jsonc`
- Generate Cloudflare Workers types with `cf-typegen`

### 3. Start Development

```bash
# Run all services in development mode
nullshot dev
```

### 4. Sign In And Inspect A Jam

```bash
# Authenticate with your Nullshot account
nullshot login

# Sync a Jam room locally
nullshot jam

# Read the room transcript
nullshot messages <room-id> --full

# Inspect compilation output and errors
nullshot logs <room-id>
nullshot errors <room-id>
```

## 📋 Commands Reference

### Global Options

All commands support these global options:

```bash
--dry-run            Show what would be done without making changes
-v, --verbose        Enable verbose logging
-c, --config <path>  Path to config file (default: "mcp.json")
--cwd <path>         Run as if nullshot was started in the specified directory
```

### `nullshot install`

Install and configure MCP servers and dependencies.

```bash
nullshot install [options]

Options:
  --skip-package-update   Skip updating package.json dependencies
  --skip-wrangler-update  Skip updating wrangler.jsonc configuration
```

**What it does:**

- Installs packages from configured sources (GitHub, npm, etc.)
- Analyzes dependency `wrangler.jsonc` files
- Generates service bindings for inter-service communication
- Runs D1 database migrations across all dependencies
- Updates main project's `wrangler.jsonc` with service bindings and environment variables
- Runs `cf-typegen` to generate Cloudflare Workers types
- Stores metadata in `package.json` for dependency tracking

### `nullshot dev`

Run all services in development mode using Cloudflare Workers multi-config.

```bash
nullshot dev [options]

Options:
  --local              Use --local flag for D1 migrations (default: true)
```

**What it does:**

- Analyzes all installed dependencies
- Runs D1 migrations across all services
- Executes `wrangler dev -c wrangler.jsonc -c dep1/wrangler.jsonc -c dep2/wrangler.jsonc`
- Provides unified development environment for all services

### `nullshot create`

Create new MCP servers or AI Agents from templates.

```bash
nullshot create mcp      # Create MCP server project
nullshot create agent    # Create AI Agent project
```

**Interactive prompts for:**

- Project name and directory
- Template selection
- Initial configuration

### `nullshot login`

Authenticate with Nullshot and store a local session for Jam commands.

```bash
nullshot login
nullshot login --status
nullshot login --api-url https://nullshot.ai
```

### `nullshot logout`

Clear stored Nullshot credentials.

```bash
nullshot logout
```

### `nullshot jam`

Sync files with a Nullshot Jam room.

```bash
nullshot jam
nullshot jam <room-id>
```

**What it does:**

- Lets you pick a Jam and room interactively, or connect directly by room id
- Creates a local synced directory for the selected room
- Keeps files synced in real time while the session is active

### `nullshot logs`

View compilation logs for a Jam room.

```bash
nullshot logs <room-id>
nullshot logs <room-id> --branch main
```

### `nullshot messages`

Read the messages for a Jam room, including full transcripts when needed.

```bash
nullshot messages <room-id>
nullshot messages <room-id> --full
nullshot messages <room-id> --raw --output transcript.txt
```

### `nullshot errors`

View the aggregated error report for a Jam room.

```bash
nullshot errors <room-id>
nullshot errors <room-id> --branch main
```

### `nullshot list`

List currently installed MCP servers and their status.

```bash
nullshot list [options]

Options:
  --format <type>         Output format: table|json (default: table)
```

### `nullshot validate`

Validate your MCP configuration file against the schema.

```bash
nullshot validate
```

## 📁 Configuration

### MCP Configuration (`mcp.json`)

```json
{
  "mcpServers": {
    "<serverName>": {
      "source": "string", // Source URL (GitHub, npm, etc.)
      "command": "string", // Startup command
      "env": [
        // Optional environment variables
        {
          "name": "string",
          "value": "string" // Optional - reads from process.env if omitted
        }
      ]
    }
  }
}
```

### Source URL Formats

| Format              | Example                                          | Description                    |
| ------------------- | ------------------------------------------------ | ------------------------------ |
| GitHub              | `github:user/repo#branch`                        | Install from GitHub repository |
| GitHub subdirectory | `github:modelcontextprotocol/servers#filesystem` | Install specific subdirectory  |
| npm                 | `@scope/package@version`                         | Install from npm registry      |
| Git URL             | `https://github.com/user/repo.git#tag`           | Install from Git URL           |

### Generated Service Bindings

After running `nullshot install`, your `wrangler.jsonc` is automatically updated:

```jsonc
{
  "name": "my-project",
  "main": "src/index.ts",
  "compatibility_date": "2025-01-15",
  "compatibility_flags": ["nodejs_compat"],

  // Auto-generated service bindings for inter-service communication
  "services": [
    {
      "binding": "MCP_FILESYSTEM_SERVICE", // Binding name for your code
      "service": "mcp-filesystem", // Actual service name
    },
    {
      "binding": "MCP_GITHUB_SERVICE",
      "service": "mcp-github",
    },
  ],

  // Merged environment variables from all dependencies
  "vars": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_...",
    "ALLOWED_DIRS": "/tmp,/home/user/docs",
  },

  // Auto-detected D1 database bindings (if present in dependencies)
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "my-database",
      "database_id": "uuid-here",
    },
  ],
}
```

### Package Metadata Storage

The CLI stores dependency metadata in your `package.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "source": "github:modelcontextprotocol/servers#filesystem",
      "installedAt": "2025-01-15T10:30:00.000Z",
      "packageName": "mcp-filesystem",
      "hasWranglerConfig": true,
      "serviceName": "filesystem",
      "d1Databases": ["USER_DB", "CACHE_DB"]
    }
  }
}
```

## 🔄 Development Workflows

### Standard Workflow

```bash
# 1. Configure services in mcp.json
# Create mcp.json with your desired services

# 2. Install dependencies and configure services
nullshot install

# 3. Start development
nullshot dev
```

### Advanced Workflow

```bash
# Preview changes before executing
nullshot install --dry-run --verbose

# Install without updating wrangler config
nullshot install --skip-wrangler-update

# Validate configuration
nullshot validate

# List installed services
nullshot list --format json

# Run in different directory
nullshot dev --cwd ./my-project

# Inspect a Jam transcript
nullshot messages <room-id> --full

# Save the raw transcript to a file
nullshot messages <room-id> --raw --output transcript.txt
```

### Multi-Service Development

The CLI excels at managing multiple interconnected services:

1. **Service Discovery**: Automatically detects `wrangler.jsonc` files in dependencies
2. **Service Bindings**: Generates bindings for service-to-service communication
3. **Unified Development**: Single `nullshot dev` command orchestrates all services
4. **Database Migrations**: Runs D1 migrations across all services
5. **Environment Management**: Merges environment variables from all dependencies

Example multi-service setup:

```bash
# Install multiple related services
echo '{
  "mcpServers": {
    "auth-service": {
      "source": "github:myorg/mcp-auth#main",
      "command": "node dist/auth.js"
    },
    "database-service": {
      "source": "github:myorg/mcp-database#main",
      "command": "node dist/db.js"
    },
    "api-gateway": {
      "source": "github:myorg/mcp-gateway#main",
      "command": "node dist/gateway.js"
    }
  }
}' > mcp.json

nullshot install
nullshot dev  # Runs all three services with proper service bindings
```

## 🗃️ Database Integration

### D1 Database Support

The CLI automatically handles D1 database migrations:

1. **Detection**: Scans dependency `wrangler.jsonc` files for `d1_databases` bindings
2. **Migration Execution**: Runs `wrangler d1 migrations apply <binding> --local --config <path>`
3. **Metadata Storage**: Tracks D1 databases in package metadata
4. **Development Mode**: Automatically runs migrations before `wrangler dev`

Example dependency with D1:

```jsonc
// dependency/wrangler.jsonc
{
  "name": "mcp-database",
  "d1_databases": [
    {
      "binding": "USER_DB",
      "database_name": "users",
      "database_id": "uuid-here",
    },
  ],
}
```

When you run `nullshot install`, the CLI will:

- Detect the `USER_DB` binding
- Run migrations: `wrangler d1 migrations apply USER_DB --local --config dependency/wrangler.jsonc`
- Store `["USER_DB"]` in the dependency metadata

## 🛠️ Integration Examples

### Using Service Bindings in Your Code

After installation, use the generated service bindings:

```typescript
// src/index.ts
export default {
  async fetch(request: Request, env: Env) {
    // Call the filesystem service
    const filesystemResponse = await env.MCP_FILESYSTEM_SERVICE.fetch(
      new Request("https://filesystem/list-files"),
    );

    // Call the github service
    const githubResponse = await env.MCP_GITHUB_SERVICE.fetch(
      new Request("https://github/repos/user/repo"),
    );

    return new Response("Services orchestrated!");
  },
};
```

### TypeScript Integration

The CLI integrates with Cloudflare Workers type generation:

```bash
# Automatically runs after install (if cf-typegen script exists)
nullshot install

# Manual type generation
npm run cf-typegen
```

Generated types will include your service bindings:

```typescript
// worker-configuration.d.ts (auto-generated)
interface Env {
  MCP_FILESYSTEM_SERVICE: Fetcher;
  MCP_GITHUB_SERVICE: Fetcher;
  // ... other bindings
}
```

### Environment Variables

Environment variables are automatically merged from all dependencies:

```jsonc
// dependency1/wrangler.jsonc
{
  "vars": {
    "API_URL": "https://api.example.com",
    "DEBUG": "true"
  }
}

// dependency2/wrangler.jsonc
{
  "vars": {
    "DB_URL": "sqlite:///data.db",
    "API_URL": "https://api-v2.example.com"  // This overwrites dependency1
  }
}

// Your main wrangler.jsonc (after nullshot install)
{
  "vars": {
    "API_URL": "https://api-v2.example.com",  // Latest value wins
    "DEBUG": "true",                          // Merged from dependency1
    "DB_URL": "sqlite:///data.db"            // Merged from dependency2
  }
}
```

## 📁 Project Structure

A typical project using Nullshot CLI:

```
my-project/
├── src/
│   ├── index.ts              # Main Worker entry point
│   └── ...                   # Your application code
├── node_modules/
│   ├── mcp-filesystem/       # Installed MCP server dependency
│   │   ├── wrangler.jsonc    # Dependency's Cloudflare config
│   │   ├── migrations/       # D1 database migrations
│   │   └── ...
│   └── mcp-github/           # Another MCP server dependency
│       ├── wrangler.jsonc
│       └── ...
├── mcp.json                  # MCP server configuration
├── wrangler.jsonc            # Your Cloudflare Workers config (auto-updated)
├── worker-configuration.d.ts # Auto-generated TypeScript types
└── package.json              # Dependencies and generated scripts
```

## 🐛 Troubleshooting

### Common Issues

**Configuration validation errors:**

```bash
❌ Invalid configuration: servers.test: missing required property 'command'
💡 Check your mcp.json file syntax and required fields
```

**Package installation failures:**

```bash
❌ Failed to install package github:user/repo: Repository not found
💡 Verify the GitHub repository exists and is accessible
```

**Service binding conflicts:**

```bash
❌ Service binding MCP_TEST_SERVICE already exists
💡 Check for duplicate service names in your dependencies
```

**D1 migration failures:**

```bash
⚠️ D1 migration failed for service:DATABASE: Migration already applied
💡 This is usually harmless - migrations are idempotent
```

### Debug Mode

Enable comprehensive logging to troubleshoot issues:

```bash
# See everything that would happen without executing
nullshot install --dry-run --verbose

# Run with full logging
nullshot dev --verbose

# Check from different directory
nullshot list --cwd ./my-project --verbose
```

### Dependency Issues

**Package name mismatches:**

```bash
# The CLI handles GitHub repositories where package.json name differs from repo name
# Metadata is stored using the actual package name from package.json
```

**Wrangler config not found:**

```bash
# Some dependencies may not have wrangler.jsonc - this is fine
# They will be installed but won't generate service bindings
```

**Migration conflicts:**

```bash
# D1 migrations are run with --local flag during development
# Production deployments handle migrations separately
```

## 🔧 Advanced Configuration

### Custom Working Directories

Run commands in different directories:

```bash
# Install dependencies for project in different location
nullshot install --cwd ../other-project

# Run development server from different directory
nullshot dev --cwd ./projects/main-app

# Validate configuration in specific directory
nullshot validate --cwd ./my-project
```

### Selective Updates

Control what gets updated during installation:

```bash
# Install packages but don't update wrangler config
nullshot install --skip-wrangler-update

# Update configs but don't install new packages
nullshot install --skip-package-update

# Just run migrations and config updates
nullshot install --skip-package-update --verbose
```

### Configuration Validation

Validate configurations before deployment:

```bash
# Validate mcp.json schema
nullshot validate

# Validate with verbose output
nullshot validate --verbose

# Validate different config file
nullshot validate --config ./configs/production.json
```

## 📚 API Reference

### Environment Interface

When using TypeScript, your environment interface will include:

```typescript
interface Env {
  // Service bindings (auto-generated)
  MCP_[SERVICE_NAME]_SERVICE: Fetcher;

  // Environment variables (merged from dependencies)
  [key: string]: string | Fetcher | D1Database;

  // D1 databases (if present in dependencies)
  [binding: string]: D1Database;
}
```

### Service Binding Naming

Service bindings follow the pattern: `MCP_[SERVICE_NAME]_SERVICE`

- `mcp-filesystem` → `MCP_FILESYSTEM_SERVICE`
- `github-integration` → `MCP_GITHUB_INTEGRATION_SERVICE`
- `custom-api` → `MCP_CUSTOM_API_SERVICE`

## 🚀 Production Deployment

### Deploy All Services

```bash
# Deploy main project
wrangler deploy

# Deploy dependencies (run in each dependency directory)
cd node_modules/mcp-filesystem && wrangler deploy
cd node_modules/mcp-github && wrangler deploy
```

### Environment Variables

Set production environment variables:

```bash
# Set secrets for all services
wrangler secret put GITHUB_TOKEN
wrangler secret put DATABASE_URL

# In dependency directories
cd node_modules/mcp-filesystem
wrangler secret put FILESYSTEM_ROOT
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Add comprehensive tests for new functionality
4. Run the full test suite: `npm test`
5. Submit a pull request with detailed description

### Development Setup

```bash
git clone https://github.com/nullshot/typescript-agent-vibework
cd typescript-agent-vibework/packages/cli
pnpm install
pnpm build
pnpm test
```

## 📄 License

MIT License - see LICENSE file for details.

---

**Need help?** Check the [troubleshooting guide](#-troubleshooting) or open an issue on GitHub.
