#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import prompts from "prompts";
import { ConfigManager } from "./config/config-manager.js";
import { PackageManager } from "./package/package-manager.js";
import { WranglerManager } from "./wrangler/wrangler-manager.js";
import { DependencyAnalyzer } from "./dependency/dependency-analyzer.js";
import { MigrationManager } from "./dependency/migration-manager.js";
import { DryRunManager } from "./utils/dry-run.js";
import { CLIError } from "./utils/errors.js";
import { Logger } from "./utils/logger.js";
import { TemplateManager } from "./template/template-manager.js";
import { InputManager } from "./template/input-manager.js";
import { AuthManager } from "./auth/auth-manager.js";
import { NullshotApiClient } from "./api/nullshot-api-client.js";
import { SyncEngine } from "./sync/sync-engine.js";
import { injectSkills } from "./skills/inject-skills.js";
import type {
  MCPConfig,
  InstallOptions,
  ListOptions,
  WranglerConfig,
} from "./types/index.js";

const program = new Command();
const logger = new Logger();

interface GlobalOptions {
  dryRun?: boolean;
  verbose?: boolean;
  config?: string;
  cwd?: string;
}

program
  .name("nullshot")
  .description("Nullshot CLI for managing MCP servers with Cloudflare Workers")
  .version("1.0.0")
  .option("--dry-run", "Show what would be done without making changes")
  .option("-v, --verbose", "Enable verbose logging")
  .option("-c, --config <path>", "Path to config file", "mcp.json")
  .option(
    "--cwd <path>",
    "Run as if nullshot was started in the specified directory instead of the current working directory",
  );

program
  .command("install")
  .description("Install MCP servers from config file")
  .option("--skip-package-update", "Skip updating package.json dependencies")
  .option(
    "--skip-wrangler-update",
    "Skip updating wrangler.jsonc configuration",
  )
  .action(async (options: InstallOptions & GlobalOptions) => {
    // Check if we're already installing to prevent infinite loop
    if (process.env.NULLSHOT_INSTALLING === "true") {
      logger.debug("Skipping nullshot install - already installing packages");
      return;
    }

    const spinner = ora("Installing MCP servers...").start();

    const {
      dryRun,
      verbose,
      config: configPath,
      cwd,
    } = program.opts<GlobalOptions>();

    // Change to the specified working directory
    const originalCwd = process.cwd();
    if (cwd && cwd !== originalCwd) {
      process.chdir(cwd);
    }

    try {
      const dryRunManager = new DryRunManager(dryRun || false);

      if (verbose) logger.setVerbose(true);
      if (dryRun) logger.info(chalk.yellow("🔍 Running in dry-run mode"));

      const configManager = new ConfigManager(configPath || "mcp.json");
      const config = await configManager.load();

      const packageManager = new PackageManager();
      const wranglerManager = new WranglerManager();

      await installServers(config, {
        dryRunManager,
        packageManager,
        wranglerManager,
        skipPackageUpdate: options.skipPackageUpdate ?? false,
        skipWranglerUpdate: options.skipWranglerUpdate ?? false,
        spinner,
      });

      spinner.succeed(chalk.green("✅ MCP servers installed successfully"));

      if (dryRun) {
        logger.info(chalk.yellow("\n📋 Dry run summary:"));
        dryRunManager.printSummary();
      }
    } catch (error) {
      spinner.fail(chalk.red("❌ Installation failed"));
      handleError(error);
    } finally {
      // Restore original working directory
      if (cwd && cwd !== originalCwd) {
        process.chdir(originalCwd);
      }
    }
  });

program
  .command("list")
  .description("List currently installed MCP servers")
  .option("--format <type>", "Output format (table|json)", "table")
  .action(async (options: ListOptions & GlobalOptions) => {
    const { config: configPath, cwd } = program.opts<GlobalOptions>();

    // Change to the specified working directory
    const originalCwd = process.cwd();
    if (cwd && cwd !== originalCwd) {
      process.chdir(cwd);
    }

    try {
      const configManager = new ConfigManager(configPath || "mcp.json");

      const servers = await listInstalledServers(
        configManager,
        options.format ?? "table",
      );
      console.log(servers);
    } catch (error) {
      handleError(error);
    } finally {
      // Restore original working directory
      if (cwd && cwd !== originalCwd) {
        process.chdir(originalCwd);
      }
    }
  });

program
  .command("validate")
  .description("Validate MCP configuration file")
  .action(async () => {
    const { config: configPath, cwd } = program.opts<GlobalOptions>();

    // Change to the specified working directory
    const originalCwd = process.cwd();
    if (cwd && cwd !== originalCwd) {
      process.chdir(cwd);
    }

    try {
      const configManager = new ConfigManager(configPath || "mcp.json");

      const spinner = ora("Validating configuration...").start();
      await configManager.validate();
      spinner.succeed(chalk.green("✅ Configuration is valid"));
    } catch (error) {
      handleError(error);
    } finally {
      // Restore original working directory
      if (cwd && cwd !== originalCwd) {
        process.chdir(originalCwd);
      }
    }
  });

// Create command group
const createCommand = program
  .command("create")
  .description("Create a new project from template");

createCommand
  .command("mcp")
  .description("Create a new MCP server project")
  .action(async () => {
    const spinner = ora("Setting up MCP project...").start();

    try {
      const { dryRun, verbose } = program.opts<GlobalOptions>();
      const dryRunManager = new DryRunManager(dryRun || false);

      if (verbose) logger.setVerbose(true);
      if (dryRun) logger.info(chalk.yellow("🔍 Running in dry-run mode"));

      spinner.stop(); // Stop spinner for user input

      const inputManager = new InputManager();
      const projectConfig = await inputManager.promptForProjectConfig("mcp");

      spinner.start("Creating MCP project...");

      const templateManager = new TemplateManager(dryRunManager);
      await templateManager.createProject(
        "mcp",
        projectConfig.projectName,
        projectConfig.targetDirectory,
      );

      spinner.succeed(chalk.green("✅ MCP project created successfully"));

      logger.info(chalk.blue("\n🚀 Next steps:"));
      logger.info(`   cd ${projectConfig.targetDirectory}`);
      logger.info("   npm install");
      logger.info("   npm run dev");

      if (dryRun) {
        logger.info(chalk.yellow("\n📋 Dry run summary:"));
        dryRunManager.printSummary();
      }
    } catch (error) {
      spinner.fail(chalk.red("❌ Failed to create MCP project"));
      handleError(error);
    }
  });

createCommand
  .command("agent")
  .description("Create a new Agent project")
  .action(async () => {
    const spinner = ora("Setting up Agent project...").start();

    try {
      const { dryRun, verbose } = program.opts<GlobalOptions>();
      const dryRunManager = new DryRunManager(dryRun || false);

      if (verbose) logger.setVerbose(true);
      if (dryRun) logger.info(chalk.yellow("🔍 Running in dry-run mode"));

      spinner.stop(); // Stop spinner for user input

      const inputManager = new InputManager();
      const projectConfig = await inputManager.promptForProjectConfig("agent");

      spinner.start("Creating Agent project...");

      const templateManager = new TemplateManager(dryRunManager);
      await templateManager.createProject(
        "agent",
        projectConfig.projectName,
        projectConfig.targetDirectory,
      );

      spinner.succeed(chalk.green("✅ Agent project created successfully"));

      logger.info(chalk.blue("\n🚀 Next steps:"));
      logger.info(`   cd ${projectConfig.targetDirectory}`);
      logger.info("   npm install");
      logger.info("   npm run dev");

      if (dryRun) {
        logger.info(chalk.yellow("\n📋 Dry run summary:"));
        dryRunManager.printSummary();
      }
    } catch (error) {
      spinner.fail(chalk.red("❌ Failed to create Agent project"));
      handleError(error);
    }
  });

// program
//   .command("init")
//   .description("Initialize a new MCP configuration file")
//   .option("--force", "Overwrite existing configuration file")
//   .action(async (options: { force?: boolean } & GlobalOptions) => {
//     const { config: configPath, cwd } = program.opts<GlobalOptions>();

//     // Change to the specified working directory
//     const originalCwd = process.cwd();
//     if (cwd && cwd !== originalCwd) {
//       process.chdir(cwd);
//     }

//     try {
//       const configManager = new ConfigManager(configPath || "mcp.json");
//       const packageManager = new PackageManager();

//       // Try to initialize MCP configuration, but continue if it already exists
//       try {
//         await configManager.init(options.force);
//         logger.info(
//           chalk.green(
//             `✅ Initialized MCP configuration at ${configPath || "mcp.json"}`,
//           ),
//         );
//       } catch (error) {
//         if (
//           error instanceof ConfigError &&
//           error.message.includes("already exists")
//         ) {
//           logger.info(
//             chalk.yellow(
//               `⚠️  MCP configuration already exists at ${configPath || "mcp.json"} - skipping creation`,
//             ),
//           );
//         } else {
//           throw error; // Re-throw if it's a different error
//         }
//       }

//       // Add nullshot scripts to package.json
//       const spinner = ora("Adding nullshot scripts to package.json...").start();
//       try {
//         const scripts = {
//           "dev:nullshot": "nullshot dev",
//         };

//         await packageManager.addScripts(scripts);

//         // Add postinstall hook
//         await packageManager.addToPostinstall("nullshot install");

//         spinner.succeed("✅ Added nullshot scripts to package.json");

//         // Check and ask about cf-typegen
//         const hasCfTypegen = await packageManager.hasScript("cf-typegen");
//         if (!hasCfTypegen) {
//           logger.info(
//             chalk.yellow("\n⚠️  No 'cf-typegen' script found in package.json"),
//           );

//           const prompts = await import("prompts");
//           const response = await prompts.default({
//             type: "confirm",
//             name: "addCfTypegen",
//             message:
//               "Would you like to add the 'cf-typegen' script for generating Wrangler types?",
//             initial: true,
//           });

//           if (response.addCfTypegen) {
//             await packageManager.addScripts({
//               "cf-typegen": "wrangler types",
//             });
//             logger.info(
//               chalk.green("✅ Added 'cf-typegen' script to package.json"),
//             );
//           }
//         } else {
//           logger.info(
//             chalk.green(
//               "✅ Found existing 'cf-typegen' script - skipping to preserve custom configuration",
//             ),
//           );
//         }
//       } catch (error) {
//         spinner.fail("❌ Failed to update package.json scripts");
//         logger.warn(
//           `Script update error: ${error instanceof Error ? error.message : String(error)}`,
//         );
//       }
//     } catch (error) {
//       handleError(error);
//     } finally {
//       // Restore original working directory
//       if (cwd && cwd !== originalCwd) {
//         process.chdir(originalCwd);
//       }
//     }
//   });

async function installServers(
  config: MCPConfig,
  context: {
    dryRunManager: DryRunManager;
    packageManager: PackageManager;
    wranglerManager: WranglerManager;
    skipPackageUpdate?: boolean;
    skipWranglerUpdate?: boolean;
    spinner: any;
  },
) {
  const {
    dryRunManager,
    packageManager,
    wranglerManager,
    skipPackageUpdate,
    skipWranglerUpdate,
    spinner,
  } = context;

  const serverNames = Object.keys(config.mcpServers);
  logger.info(`Found ${serverNames.length} MCP servers to install`);

  // Install npm packages
  if (!skipPackageUpdate) {
    spinner.text = "Installing npm packages...";
    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      // Only install packages for servers with a source
      if (serverConfig.source) {
        await dryRunManager.execute(
          `Install package ${serverConfig.source}`,
          () => packageManager.installPackage(serverConfig.source!, name),
        );
      }
    }
  }

  // Update wrangler configuration
  if (!skipWranglerUpdate) {
    spinner.text = "Updating Cloudflare Workers configuration...";
    await dryRunManager.execute(
      "Update wrangler.jsonc with MCP server bindings",
      async () => {
        // Get dependency wrangler configs
        const dependencyAnalyzer = new DependencyAnalyzer();
        const dependencyConfigs: WranglerConfig[] = [];

        for (const [serverName] of Object.entries(config.mcpServers)) {
          try {
            // Get the actual package name from metadata
            const packageManager = new PackageManager();
            const metadata =
              await packageManager.getMCPPackageMetadata(serverName);
            const packageName = metadata?.packageName || serverName;

            // First find the dependency path using the actual package name
            const dependencyPath =
              await dependencyAnalyzer.findDependencyPath(packageName);
            if (dependencyPath) {
              // Then analyze the dependency to get wrangler config
              const analysis =
                await dependencyAnalyzer.analyzeDependency(dependencyPath);
              if (analysis.wranglerConfig) {
                dependencyConfigs.push(analysis.wranglerConfig);
              }
            }
          } catch (error) {
            logger.warn(
              `Failed to analyze dependency ${serverName}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        return wranglerManager.updateConfigWithDependencies(dependencyConfigs);
      },
    );
  }

  // Clean up removed packages (only npm packages, service cleanup handled in wrangler update)
  spinner.text = "Cleaning up removed packages...";
  await dryRunManager.execute(
    "Remove packages not in configuration",
    async () => {
      await packageManager.cleanupRemovedServers(serverNames);
    },
  );

  // Run cf-typegen if available
  spinner.text = "Generating Wrangler types...";
  const hasCfTypegen = await packageManager.hasScript("cf-typegen");
  if (hasCfTypegen) {
    await dryRunManager.execute(
      "Generate Wrangler types using cf-typegen",
      async () => {
        const success = await packageManager.runScript("cf-typegen");
        if (success) {
          logger.debug("Successfully generated Wrangler types");
        }
      },
    );
  } else {
    logger.warn(
      chalk.yellow(
        "⚠️  Skipping generating wrangler types since cf-typegen does not exist. " +
          'You must generate manually or add "cf-typegen": "wrangler types" to your package.json',
      ),
    );
  }
}

async function listInstalledServers(
  configManager: ConfigManager,
  format: string,
): Promise<string> {
  const config = await configManager.load();
  const packageManager = new PackageManager();

  const installedPackages = await packageManager.getInstalledMCPPackages();

  const servers = Object.entries(config.mcpServers).map(
    ([name, serverConfig]) => ({
      name,
      source: serverConfig.source,
      command: serverConfig.command,
      url: serverConfig.url,
      packageInstalled: installedPackages.includes(name),
      status: installedPackages.includes(name) ? "installed" : "not_installed",
    }),
  );

  if (format === "json") {
    return JSON.stringify(servers, null, 2);
  }

  // Table format
  const table = servers
    .map(
      (server) =>
        `${server.status === "installed" ? "✅" : "! "} ${server.name.padEnd(20)} ${(server.source || server.url || "").padEnd(40)} ${server.command || ""}`,
    )
    .join("\n");

  return `${"Name".padEnd(22)} ${"Source".padEnd(42)} Command\n${"─".repeat(80)}\n${table}`;
}

async function runDev(
  config: MCPConfig,
  options: {
    dryRunManager: DryRunManager;
    local?: boolean;
    spinner: any;
  },
): Promise<void> {
  const { dryRunManager, spinner } = options;

  if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
    throw new CLIError(
      "No MCP servers found in configuration",
      "Run 'nullshot install' to add some MCP servers or check your mcp.json file",
      1,
    );
  }

  // Get dependency information
  const packageManager = new PackageManager();
  const metadata = await packageManager.getInstalledMCPServersWithMetadata();

  const dependencyAnalyzer = new DependencyAnalyzer();
  const migrationManager = new MigrationManager(dryRunManager);

  spinner.text = "Analyzing dependencies...";

  // Collect dependency configs and their information
  const dependencyConfigs: Array<{
    name: string;
    serviceName: string;
    wranglerConfigPath: string;
    d1Databases?: string[];
  }> = [];

  // Get the main project's wrangler config path
  const mainWranglerConfigPath = "wrangler.jsonc";

  // Analyze each dependency
  for (const [serverName, serverMeta] of Object.entries(metadata)) {
    try {
      const dependencyPath = await dependencyAnalyzer.findDependencyPath(
        serverMeta.packageName,
      );
      if (dependencyPath) {
        const analysis =
          await dependencyAnalyzer.analyzeDependency(dependencyPath);
        if (analysis.wranglerConfigPath && analysis.serviceName) {
          const config: any = {
            name: serverName,
            serviceName: analysis.serviceName,
            wranglerConfigPath: analysis.wranglerConfigPath,
          };
          if (analysis.d1Databases) {
            config.d1Databases = analysis.d1Databases;
          }
          dependencyConfigs.push(config);
        }
      }
    } catch (error) {
      logger.warn(
        `Failed to analyze dependency ${serverName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (dependencyConfigs.length === 0) {
    logger.warn(chalk.yellow("No dependencies with wrangler configs found"));
  }

  // List the services we're going to start
  const serviceList = dependencyConfigs
    .map((dep) => dep.serviceName)
    .join(", ");
  logger.info(chalk.blue(`Running dev for services: ${serviceList || "none"}`));

  // Run D1 migrations
  spinner.text = "Running D1 migrations...";

  // Run D1 migrations
  const d1MigrationResults =
    await migrationManager.executeD1MigrationsForDependencies(
      dependencyConfigs,
    );
  const failedD1Migrations = d1MigrationResults.filter(
    (result: any) => !result.success,
  );
  if (failedD1Migrations.length > 0) {
    logger.warn(
      `${failedD1Migrations.length} D1 migration(s) failed, but continuing...`,
    );
  }

  // Build the wrangler command
  spinner.text = "Starting wrangler dev...";

  const configPaths = [
    mainWranglerConfigPath, // Main project config always first
    ...dependencyConfigs.map((dep) => dep.wranglerConfigPath),
  ];

  // Build args array with separate -c flags for each config
  // Add --local flag to avoid Cloudflare login requirement for local development
  const args = ["dev", "--local", ...configPaths.flatMap((path) => ["-c", path])];

  const fullCommand = `wrangler dev --local ${configPaths.map((path) => `-c ${path}`).join(" ")}`;

  logger.info(chalk.green(`\n🚀 Executing: ${fullCommand}\n`));

  spinner.stop();

  if (dryRunManager.isEnabled()) {
    await dryRunManager.execute(
      `[DRY RUN] Would execute: ${fullCommand}`,
      async () => {},
    );
    return;
  }

  // Execute the command
  const { spawn } = await import("node:child_process");

  const childProcess = spawn("wrangler", args, {
    stdio: "inherit",
    shell: false,
    env: process.env,
  });

  return new Promise<void>((resolve, reject) => {
    childProcess.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new CLIError(
            `Wrangler dev exited with code ${code}`,
            "Check the logs above for error details",
            code || 1,
          ),
        );
      }
    });

    childProcess.on("error", (error) => {
      reject(
        new CLIError(
          `Failed to start wrangler dev: ${error.message}`,
          "Make sure wrangler is installed and accessible in your PATH",
          1,
        ),
      );
    });

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      logger.info(chalk.yellow(`\n🛑 Shutting down wrangler dev...`));
      childProcess.kill("SIGINT");
    });

    process.on("SIGTERM", () => {
      logger.info(chalk.yellow(`\n🛑 Shutting down wrangler dev...`));
      childProcess.kill("SIGTERM");
    });
  });
}

function buildHtmlPage(type: "success" | "error", title: string, body: string): string {
  const color = type === "success" ? "#22c55e" : "#ef4444";
  const icon = type === "success" ? "✅" : "❌";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} - Nullshot CLI</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0f;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 2.5rem;
      text-align: center;
      max-width: 400px;
      width: 100%;
    }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.5rem; font-weight: 700; color: ${color}; margin-bottom: 0.75rem; }
    p { font-size: 0.95rem; color: #94a3b8; line-height: 1.6; }
    .brand { margin-top: 2rem; font-size: 0.8rem; color: #475569; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${body}</p>
    <p class="brand">Nullshot CLI</p>
  </div>
</body>
</html>`;
}

function handleError(error: unknown): void {
  if (error instanceof CLIError) {
    logger.error(chalk.red(`❌ ${error.message}`));
    if (error.suggestion) {
      logger.info(chalk.yellow(`💡 ${error.suggestion}`));
    }
    process.exit(error.exitCode);
  } else {
    logger.error(
      chalk.red(
        `❌ Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    process.exit(1);
  }
}
// Error handling for unhandled rejections
process.on("unhandledRejection", (reason) => {
  logger.error(`${chalk.red("Unhandled rejection:")}, ${reason}`);
  process.exit(1);
});

// Dev command - run services in development mode
program
  .command("dev")
  .description(
    "Run MCP servers in development mode using multi-config approach",
  )
  .option("--local", "Use --local flag for D1 migrations", true)
  .action(async (options: { local?: boolean } & GlobalOptions) => {
    const spinner = ora("Starting development servers...").start();

    const {
      dryRun,
      verbose,
      config: configPath,
      cwd,
    } = program.opts<GlobalOptions>();

    // Change to the specified working directory
    const originalCwd = process.cwd();
    if (cwd && cwd !== originalCwd) {
      process.chdir(cwd);
    }

    try {
      const dryRunManager = new DryRunManager(dryRun || false);

      if (verbose) logger.setVerbose(true);
      if (dryRun) logger.info(chalk.yellow("🔍 Running in dry-run mode"));

      const configManager = new ConfigManager(configPath || "mcp.json");
      const config = await configManager.load();

      await runDev(config, {
        dryRunManager,
        local: options.local ?? true,
        spinner,
      });

      if (dryRun) {
        logger.info(chalk.yellow("🔍 Dry-run completed"));
      }
    } catch (error) {
      spinner.fail(chalk.red("❌ Failed to start development servers"));
      handleError(error);
    } finally {
      // Restore original working directory
      if (cwd && cwd !== originalCwd) {
        process.chdir(originalCwd);
      }
    }
  });

// =============================================
// Authentication commands
// =============================================

program
  .command("login")
  .description("Authenticate with Nullshot")
  .option("--status", "Show current authentication status")
  .option("--api-url <url>", "API base URL override (default: https://nullshot.ai)")
  .action(async (options: { status?: boolean; apiUrl?: string }) => {
    if (options.status) {
      const creds = AuthManager.getCredentials();
      if (creds) {
        logger.info(chalk.green("✅ Authenticated"));
        logger.info(`  User: ${creds.userName || creds.userId}`);
        logger.info(`  Email: ${creds.email || "N/A"}`);
        logger.info(`  Expires: ${new Date(creds.expiresAt).toLocaleDateString()}`);
      } else {
        logger.info(chalk.yellow("Not authenticated. Run `nullshot login` to authenticate."));
      }
      return;
    }

    const apiBase = options.apiUrl || "https://nullshot.ai";

    const { createServer } = await import("node:http");
    const { exec } = await import("node:child_process");

    const findFreePort = (): Promise<number> =>
      new Promise((resolve, reject) => {
        const srv = createServer();
        srv.listen(0, "127.0.0.1", () => {
          const addr = srv.address() as { port: number };
          srv.close(() => resolve(addr.port));
        });
        srv.on("error", reject);
      });

    const openBrowser = (url: string): void => {
      const platform = process.platform;
      const cmd =
        platform === "darwin"
          ? `open "${url}"`
          : platform === "win32"
            ? `start "" "${url}"`
            : `xdg-open "${url}"`;
      exec(cmd, () => {});
    };

    const port = await findFreePort();
    const state = crypto.randomUUID();
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const authUrl = `${apiBase}/auth/cli?redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;

    logger.info("");
    logger.info(chalk.cyan("Opening browser for authentication..."));
    logger.info(chalk.dim(`If browser doesn't open automatically, visit:`));
    logger.info(chalk.dim(`  ${authUrl}`));
    logger.info("");

    openBrowser(authUrl);

    const spinner = ora("Waiting for browser authentication...").start();

    await new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => {
        if (!req.url) {
          res.writeHead(400);
          res.end("Bad request");
          return;
        }

        const reqUrl = new URL(req.url, `http://127.0.0.1:${port}`);

        if (reqUrl.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const returnedState = reqUrl.searchParams.get("state");
        const token = reqUrl.searchParams.get("token");

        if (returnedState !== state) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(buildHtmlPage("error", "Authentication Failed", "Invalid state parameter."));
          server.close();
          reject(new Error("State mismatch - possible security issue, please try again."));
          return;
        }

        if (!token) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(buildHtmlPage("error", "Authentication Failed", "No token received."));
          server.close();
          reject(new Error("No token received from authentication server."));
          return;
        }

        const userId = reqUrl.searchParams.get("userId") || "";
        const userName = reqUrl.searchParams.get("userName") || null;
        const email = reqUrl.searchParams.get("email") || null;
        const expiresAt = parseInt(reqUrl.searchParams.get("expiresAt") || "0", 10);

        AuthManager.saveCredentials({
          sessionToken: token,
          userId,
          userName,
          email,
          expiresAt: expiresAt || Date.now() + 30 * 24 * 60 * 60 * 1000,
          baseUrl: apiBase,
        });

        const displayName = userName || email || userId;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          buildHtmlPage(
            "success",
            "Authenticated!",
            `You're now logged in as <strong>${displayName}</strong>.<br/>You can close this tab and return to your terminal.`,
          ),
        );

        server.close(() => resolve());
      });

      server.listen(port, "127.0.0.1");

      const timeout = setTimeout(
        () => {
          server.close();
          reject(new Error("Authentication timed out after 5 minutes."));
        },
        5 * 60 * 1000,
      );

      server.on("close", () => clearTimeout(timeout));
      server.on("error", reject);
    });

    const creds = AuthManager.getCredentials();
    spinner.succeed(
      chalk.green(`Authenticated as ${creds?.userName || creds?.email || creds?.userId || "unknown"}`),
    );
  });

program
  .command("logout")
  .description("Clear stored Nullshot credentials")
  .action(() => {
    AuthManager.clearCredentials();
    logger.info(chalk.green("Logged out successfully."));
  });

// =============================================
// Jam sync command
// =============================================

program
  .command("jam")
  .description("Sync files with a Nullshot Jam room")
  .argument("[room-id]", "Room ID to sync with directly")
  .option("--api-url <url>", "API base URL override")
  .action(async (roomIdArg?: string, options?: { apiUrl?: string }) => {
    const creds = AuthManager.getCredentials();
    if (!creds) {
      logger.error(chalk.red("Not authenticated. Run `nullshot login` first."));
      process.exit(1);
    }

    const client = new NullshotApiClient({
      baseUrl: options?.apiUrl || creds.baseUrl,
      sessionToken: creds.sessionToken,
    });

    const spinner = ora("Fetching your Jams...").start();

    let targetRoomId = roomIdArg;
    let targetJamName: string | undefined;
    let targetRoomTitle: string | undefined;
    let targetJamId: string | undefined;
    let targetPreviewUrl: string | undefined;

    try {
      const { jams } = await client.listJams();
      spinner.stop();

      if (jams.length === 0) {
        logger.info(chalk.yellow("No Jams found. Create one at nullshot.ai first."));
        return;
      }

      if (targetRoomId) {
        // Direct mode: find the room
        for (const jam of jams) {
          const room = jam.rooms.find((r) => r.id === targetRoomId);
          if (room) {
            targetJamName = jam.name;
            targetRoomTitle = room.title;
            targetJamId = jam.id;
            targetPreviewUrl = room.previewUrl;
            break;
          }
        }
        if (!targetJamName) {
          logger.error(chalk.red(`Room ${targetRoomId} not found or you don't have access.`));
          process.exit(1);
        }
      } else {
        // Interactive mode with back-navigation: loop until a room is selected or user cancels
        const BACK = "__back__";

        selectionLoop: while (true) {
          // Step 1: Select a Jam
          const jamChoices = jams.map((j) => ({
            title: `${j.name} (${j.rooms.length} room${j.rooms.length !== 1 ? "s" : ""})`,
            value: j.id,
          }));

          const jamAnswer = await prompts({
            type: "select",
            name: "jamId",
            message: "Select a Jam",
            choices: jamChoices,
          });

          if (!jamAnswer.jamId) {
            logger.info("Cancelled.");
            return;
          }

          const selectedJam = jams.find((j) => j.id === jamAnswer.jamId)!;

          if (selectedJam.rooms.length === 0) {
            logger.info(chalk.yellow(`No rooms in "${selectedJam.name}". Create one on nullshot.ai first.`));
            continue selectionLoop;
          }

          // Step 2: Select a Room (with back option)
          const roomChoices = [
            {
              title: chalk.dim("← Back to Jams"),
              value: BACK,
            },
            ...selectedJam.rooms.map((r) => ({
              title: `${r.title} (${r.state || "unknown"})`,
              description: r.branchName,
              value: r.id,
            })),
          ];

          const roomAnswer = await prompts({
            type: "select",
            name: "roomId",
            message: `Rooms in "${selectedJam.name}"`,
            choices: roomChoices,
          });

          if (!roomAnswer.roomId) {
            logger.info("Cancelled.");
            return;
          }

          if (roomAnswer.roomId === BACK) {
            continue selectionLoop;
          }

          const selectedRoom = selectedJam.rooms.find((r) => r.id === roomAnswer.roomId)!;
          targetJamId = selectedJam.id;
          targetJamName = selectedJam.name;
          targetRoomId = selectedRoom.id;
          targetRoomTitle = selectedRoom.title;
          targetPreviewUrl = selectedRoom.previewUrl;
          break selectionLoop;
        }
      }

      // Start syncing
      const safeName = (targetJamName || "jam").replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
      const safeRoom = (targetRoomTitle || "room").replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
      const localDir = `./${safeName}/${safeRoom}`;

      logger.info("");
      logger.info(chalk.cyan(`Jam:  ${targetJamName}`));
      logger.info(chalk.cyan(`Room: ${targetRoomTitle}`));
      logger.info(chalk.cyan(`Dir:  ${localDir}`));
      if (targetPreviewUrl) {
        logger.info(chalk.cyan(`Preview: ${targetPreviewUrl}`));
      }
      logger.info("");

      // Fetch environment-appropriate WebSocket URLs from the server.
      // In local dev next dev cannot proxy WS upgrades, so the server returns
      // direct URLs to the playground/jams workers. In production it returns
      // the website-proxied URLs where JWT is validated at the edge.
      const wsUrlsSpinner = ora("Resolving connection URLs...").start();
      let codeboxWsUrl: string;
      let jamWsUrl: string;
      try {
        const wsUrls = await client.getWsUrls({
          roomId: targetRoomId!,
          jamId: targetJamId!,
          userId: creds.userId,
          userName: creds.userName || "",
        });
        codeboxWsUrl = wsUrls.codeboxWsUrl;
        jamWsUrl = wsUrls.jamWsUrl;
        wsUrlsSpinner.stop();
      } catch (err) {
        wsUrlsSpinner.stop();
        throw err;
      }

      const printAgentWarning = () => {
        process.stdout.write(
          chalk.yellow("\n⚠  Agent is editing remotely — conflicts may occur. Press S + Enter to stop agents.\n\n")
        );
      };
      const clearAgentWarning = () => {
        process.stdout.write(chalk.green("✓  Agent finished editing.\n\n"));
      };

      const engine = new SyncEngine({
        localDir,
        codeboxWsUrl,
        jamWsUrl,
        userId: creds.userId,
        userName: creds.userName,
        sessionToken: creds.sessionToken,
        onStatus: (msg) => logger.info(msg),
        onError: (err) => logger.error(chalk.red(err.message)),
        onAgentEditingChange: (isEditing) => {
          if (isEditing) printAgentWarning();
          else clearAgentWarning();
        },
        onAfterInitialSync: async (dir) => {
          return injectSkills(dir, client, targetRoomId!, targetJamId!);
        },
      });

      // Handle graceful shutdown
      let shuttingDown = false;
      const shutdown = async (reason?: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        if (reason) logger.info(chalk.yellow(`\n${reason}`));
        logger.info(chalk.yellow("Ending session..."));
        await engine.stop();
        logger.info(chalk.dim(`Local files kept at: ${localDir}`));
        process.exit(0);
      };

      process.on("SIGINT", () => shutdown());
      process.on("SIGTERM", () => shutdown());

      await engine.start();

      logger.info("");
      logger.info(chalk.dim("─────────────────────────────────────────"));
      logger.info(chalk.bold("  Session active. Files syncing in real-time."));
      logger.info(chalk.dim("  Press Enter to end session."));
      logger.info(chalk.dim("─────────────────────────────────────────"));
      logger.info("");

      // Keep alive: read from stdin. Enter = end session, S = stop remote agents.
      await new Promise<void>((resolve) => {
        process.stdin.setEncoding("utf-8");
        process.stdin.resume();
        process.stdin.on("data", (chunk: string) => {
          const input = chunk.trim().toLowerCase();
          if (input === "s") {
            const displayName = creds.userName || creds.userId;
            logger.info(chalk.yellow("Stopping remote agents..."));
            engine.stopRemoteAgents(targetRoomId!, displayName);
          } else {
            // Any other input (including bare Enter) ends the session
            resolve();
          }
        });
      });

      await shutdown("Session ended.");
    } catch (error) {
      spinner.stop();
      if (error instanceof Error) {
        logger.error(chalk.red(error.message));
      }
      process.exit(1);
    }
  });

process.on("uncaughtException", (error) => {
  logger.error(`${chalk.red("Uncaught exception:")}, ${error}`);
  process.exit(1);
});

// When run via `pnpm dev:run -- login --token=...`, pnpm injects a leading "--" into argv.
// Commander treats "--" as "end of options", so the rest is parsed as positional args. Strip it.
const argv = process.argv.slice(2);
const filtered = argv[0] === "--" ? argv.slice(1) : argv;
program.parse([process.argv[0] ?? "", process.argv[1] ?? "", ...filtered]);
