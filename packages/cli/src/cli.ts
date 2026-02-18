#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
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
import {
  setSecret,
  setTelegramWebhook,
  getAvailableProviders,
  discoverMCPServers,
  createVectorizeIndex,
  type DeployableMCPServer,
} from "./deploy/deploy-manager.js";
import {
  discoverComponents,
  createBundle,
  type ComponentConfig,
  type BundleConfig,
} from "./bundle/bundle-manager.js";
import {
  parseCloudflareError,
  formatErrorInline,
} from "./utils/error-formatter.js";
import type {
  MCPConfig,
  InstallOptions,
  ListOptions,
  WranglerConfig,
} from "./types/index.js";

const program = new Command();
const logger = new Logger();

// Helper function to create prompts with consistent error handling
async function createPrompt(config: any) {
  const prompts = (await import("prompts")).default;

  return prompts(config, {
    onCancel: () => {
      console.log("\n");
      logger.info(chalk.yellow("Cancelled by user"));
      process.exit(0);
    },
  });
}

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
  )
  .hook("preAction", (thisCommand) => {
    // Enable verbose logging early if flag is set
    const opts = thisCommand.opts<GlobalOptions>();
    if (opts.verbose) {
      logger.setVerbose(true);
      logger.debug("Verbose mode enabled");
    }
  });

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
  const args = [
    "dev",
    "--local",
    ...configPaths.flatMap((path) => ["-c", path]),
  ];

  const fullCommand = `npx wrangler dev --local ${configPaths.map((path) => `-c ${path}`).join(" ")}`;

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

  const childProcess = spawn("npx", ["wrangler", ...args], {
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

// Deploy command - deploy agents, playground, and telegram bot
program
  .command("deploy")
  .description(
    "Deploy AI agents, playground, and Telegram bot to Cloudflare Workers",
  )
  .option("--skip-secrets", "Skip setting secrets (use existing)")
  .action(
    async (
      options: {
        skipSecrets?: boolean;
      } & GlobalOptions,
    ) => {
      // Immediate output to confirm command started
      console.log(""); // New line for clarity

      const { dryRun, verbose, cwd } = program.opts<GlobalOptions>();

      // Change to the specified working directory
      const originalCwd = process.cwd();
      if (cwd && cwd !== originalCwd) {
        process.chdir(cwd);
      }

      try {
        if (verbose) {
          logger.setVerbose(true);
          logger.debug(`Working directory: ${process.cwd()}`);
          logger.debug(`Stdin is TTY: ${process.stdin.isTTY}`);
          logger.debug(`Verbose flag: ${verbose}`);
        }

        // Check if stdin is a TTY (interactive terminal)
        if (!process.stdin.isTTY) {
          logger.error(
            chalk.red("❌ This command requires an interactive terminal"),
          );
          logger.info(
            chalk.yellow(
              "💡 Make sure you're running this command in a terminal, not through a non-interactive process",
            ),
          );
          process.exit(1);
        }

        if (verbose) {
          logger.debug("TTY check passed, proceeding with interactive prompts");
        }

        // Set up signal handlers for graceful shutdown
        const signalHandler = () => {
          console.log("\n");
          logger.info(chalk.yellow("Cancelled by user"));
          process.exit(0);
        };
        process.on("SIGINT", signalHandler);
        process.on("SIGTERM", signalHandler);

        // Import prompts dynamically
        const promptsModule = await import("prompts");
        const prompts = promptsModule.default;

        // Helper to add onCancel to all prompts
        const promptWithCancel = (config: any) => {
          return prompts(config, {
            onCancel: () => {
              console.log("\n");
              logger.info(chalk.yellow("Cancelled by user"));
              process.exit(0);
            },
          });
        };

        // Header
        console.log("");
        logger.info(chalk.blue.bold("🚀 Nullshot Deploy"));
        console.log("");

        // Determine root directory - try multiple locations
        let rootDir = process.cwd();

        // If we're in packages/cli, go up to project root
        if (
          rootDir.endsWith("/packages/cli") ||
          rootDir.endsWith("\\packages\\cli")
        ) {
          rootDir = path.join(rootDir, "../..");
        }
        // If we're in a subdirectory, try to find project root by looking for examples/
        if (!existsSync(path.join(rootDir, "examples"))) {
          // Try going up one level
          const parentDir = path.join(rootDir, "..");
          if (existsSync(path.join(parentDir, "examples"))) {
            rootDir = parentDir;
          }
        }

        // Normalize path
        rootDir = path.resolve(rootDir);

        // Check what's available - agents (single-worker compatible only)
        const agentPaths = [
          {
            name: "simple-prompt-agent",
            path: path.join(rootDir, "examples", "simple-prompt-agent"),
            selected: true,
            requiresMcp: false,
            description: "Simple conversational AI agent",
          },
          {
            name: "dependent-agent",
            path: path.join(rootDir, "examples", "dependent-agent"),
            selected: false,
            requiresMcp: true,
            description: "Agent with external MCP tools",
          },
        ];

        if (verbose) {
          logger.debug(`Root directory: ${rootDir}`);
          for (const agent of agentPaths) {
            const exists = existsSync(agent.path);
            logger.debug(
              `Agent ${agent.name}: ${agent.path} - ${exists ? "exists" : "not found"}`,
            );
          }
        }

        const agents = agentPaths.filter((a) => existsSync(a.path));

        if (verbose) {
          logger.debug(`Found ${agents.length} agents`);
          agents.forEach((a) => {
            logger.debug(`  - ${a.name} at ${a.path}`);
          });
        }

        // Check what's available - MCP servers
        if (verbose) {
          logger.debug("Discovering MCP servers...");
        }
        const mcpServers = await discoverMCPServers(rootDir);

        if (verbose) {
          logger.debug(`Found ${mcpServers.length} MCP servers`);
        }

        if (agents.length === 0) {
          logger.error(chalk.red("No agents found in examples/"));
          logger.info(
            chalk.yellow(`Searched in: ${path.join(rootDir, "examples")}`),
          );
          logger.info(chalk.yellow(`Expected paths:`));
          agentPaths.forEach((a) => {
            const exists = existsSync(a.path);
            logger.info(
              chalk.yellow(
                `  - ${a.path} (${exists ? "✓ exists" : "✗ not found"})`,
              ),
            );
          });
          return;
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 1: Select AI Agents
        // ═══════════════════════════════════════════════════════════════
        logger.info(chalk.cyan.bold("Step 1: Select AI Agents"));
        logger.info(chalk.gray("Choose which agents to deploy\n"));

        const agentChoices = agents.map((a) => ({
          title: `${a.name} ${chalk.gray(`- ${a.description}`)}`,
          value: a.name,
          selected: a.selected,
        }));

        const agentSelection = (await createPrompt({
          type: "multiselect",
          name: "agents",
          message: "AI Agents:",
          choices: agentChoices,
          hint: "Space to select, Enter to continue",
        })) as { agents?: string[] };

        if (!agentSelection.agents || agentSelection.agents.length === 0) {
          logger.info(chalk.yellow("\nNo agents selected. Exiting."));
          return;
        }

        const selectedAgents = agents.filter((a) =>
          agentSelection.agents!.includes(a.name),
        );
        const selectedMCPServers: DeployableMCPServer[] = [];
        let mcpServiceForDependent: DeployableMCPServer | null = null;

        // ═══════════════════════════════════════════════════════════════
        // STEP 2: Select MCP Servers (optional, can select multiple)
        // ═══════════════════════════════════════════════════════════════
        const agentRequiringMcp = selectedAgents.find((a) => a.requiresMcp);

        if (mcpServers.length > 0 && agentRequiringMcp) {
          logger.info(
            chalk.gray("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"),
          );
          logger.info(chalk.cyan.bold("Step 2: Select MCP Servers"));
          if (agentRequiringMcp) {
            logger.info(
              chalk.gray(
                `${agentRequiringMcp.name} needs an MCP server for external tools`,
              ),
            );
          }
          logger.info(
            chalk.gray(
              "You can select multiple MCP servers to include in the bundle\n",
            ),
          );

          const mcpChoice = await promptWithCancel({
            type: "multiselect",
            name: "mcpServers",
            message: "MCP Servers (optional):",
            choices: mcpServers.map((m) => {
              if (m.disabled) {
                return {
                  title: `${chalk.dim(m.name)} ${chalk.dim.gray(`- ${m.disabledReason || "Coming soon"}`)}`,
                  value: m.name,
                  selected: false,
                  disabled: true,
                };
              }
              return {
                title: `${m.name} ${chalk.gray(`- ${m.description}`)}`,
                value: m.name,
                selected: m.name === "crud-mcp",
              };
            }),
            hint: "Space to select, Enter to continue (can select multiple)",
          });

          if (mcpChoice.mcpServers && mcpChoice.mcpServers.length > 0) {
            for (const chosenName of mcpChoice.mcpServers) {
              const chosen = mcpServers.find((m) => m.name === chosenName);
              if (chosen) {
                selectedMCPServers.push(chosen);
                // Use first selected MCP for dependent agent if needed
                if (!mcpServiceForDependent && agentRequiringMcp) {
                  mcpServiceForDependent = chosen;
                }
              }
            }
          } else if (agentRequiringMcp) {
            logger.warn(
              chalk.yellow(
                `\n⚠️  No MCP server selected. ${agentRequiringMcp.name} will fail.`,
              ),
            );
          }
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 2.5: Check MCP external bindings requirements
        // ═══════════════════════════════════════════════════════════════
        const mcpBindingRequirements: Record<
          string,
          {
            type: string;
            binding: string;
            createCmd: string;
            description: string;
          }
        > = {
          "kv-mcp": {
            type: "KV Namespace",
            binding: "EXAMPLE_KV",
            createCmd: "wrangler kv namespace create EXAMPLE_KV",
            description: "Key-Value storage for caching data",
          },
          "image-mcp": {
            type: "R2 Bucket",
            binding: "IMAGES_BUCKET",
            createCmd: "wrangler r2 bucket create my-images",
            description: "Object storage for images",
          },
          "email-mcp": {
            type: "D1 Database + Email",
            binding: "EMAIL_DB",
            createCmd: "wrangler d1 create email-db",
            description: "Database for emails + Cloudflare Email Routing",
          },
        };

        const mcpBindingConfigs: Record<string, string> = {};

        for (const mcp of selectedMCPServers) {
          const requirement = mcpBindingRequirements[mcp.name];
          if (requirement) {
            logger.info(
              chalk.gray(
                "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n",
              ),
            );
            logger.info(
              chalk.yellow.bold(`⚠️  ${mcp.name} requires external binding`),
            );
            logger.info(chalk.gray(`${requirement.description}\n`));

            logger.info(chalk.white("To create the binding, run:"));
            logger.info(chalk.cyan(`   ${requirement.createCmd}\n`));

            logger.info(chalk.white("Then copy the ID from the output.\n"));

            const bindingResponse = await promptWithCancel({
              type: "text",
              name: "bindingId",
              message: `${requirement.type} ID (or press Enter to skip ${mcp.name}):`,
              validate: (value: string) => {
                if (!value) return true; // Allow skip
                if (value.length < 10)
                  return "ID seems too short. Check the wrangler output.";
                return true;
              },
            });

            if (!bindingResponse.bindingId) {
              logger.warn(
                chalk.yellow(
                  `\n⚠️  Skipping ${mcp.name} - no binding ID provided.`,
                ),
              );
              // Remove from selected
              const idx = selectedMCPServers.indexOf(mcp);
              if (idx > -1) selectedMCPServers.splice(idx, 1);
              if (mcpServiceForDependent === mcp) mcpServiceForDependent = null;
            } else {
              mcpBindingConfigs[mcp.name] = bindingResponse.bindingId;
              logger.info(chalk.green(`   ✓ ${requirement.type} ID saved`));
            }
          }
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 3: Include Playground UI?
        // ═══════════════════════════════════════════════════════════════
        logger.info(
          chalk.gray("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"),
        );
        logger.info(chalk.cyan.bold("Step 3: Playground UI"));

        const playgroundChoice = await promptWithCancel({
          type: "confirm",
          name: "include",
          message: `Include Web Chat UI? ${chalk.gray("(Browser-based chat interface)")}`,
          initial: true,
        });

        const deployPlayground = playgroundChoice.include || false;

        // ═══════════════════════════════════════════════════════════════
        // STEP 4: Telegram Bot
        // ═══════════════════════════════════════════════════════════════
        let deployTelegram = false;
        let telegramBotToken = "";
        let telegramWebhookSecret = "";

        if (selectedAgents.length > 0) {
          logger.info(
            chalk.gray("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"),
          );
          logger.info(chalk.cyan.bold("Step 4: Telegram Bot"));

          const telegramChoice = await promptWithCancel({
            type: "confirm",
            name: "include",
            message: `Include Telegram Bot? ${chalk.gray("(Forwards messages to your agent via webhook)")}`,
            initial: false,
          });

          deployTelegram = telegramChoice.include || false;

          if (deployTelegram && !options.skipSecrets) {
            const telegramTokenResponse = await promptWithCancel({
              type: "password",
              name: "token",
              message: "Telegram Bot Token (from @BotFather):",
            });
            telegramBotToken = telegramTokenResponse.token || "";

            if (!telegramBotToken) {
              logger.warn(
                chalk.yellow(
                  "⚠️ No bot token provided. Telegram will be included but webhook won't be set up.",
                ),
              );
            }

            const webhookSecretResponse = await promptWithCancel({
              type: "text",
              name: "secret",
              message:
                "Webhook secret (random string, or leave empty to auto-generate):",
              initial: "",
            });
            telegramWebhookSecret =
              webhookSecretResponse.secret || crypto.randomUUID();
          }
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 5: AI Provider
        // ═══════════════════════════════════════════════════════════════
        let aiProvider = "workers-ai";
        let aiApiKey = "";

        if (selectedAgents.length > 0 && !options.skipSecrets) {
          logger.info(
            chalk.gray("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"),
          );
          logger.info(chalk.cyan.bold("Step 5: AI Provider"));

          const providers = getAvailableProviders();

          const providerChoice = await promptWithCancel({
            type: "select",
            name: "provider",
            message: "Select AI provider:",
            choices: providers.map((p) => ({ title: p.name, value: p.value })),
            initial: 0, // Workers AI first and default (free tier, no API key needed)
          });

          if (!providerChoice.provider) {
            logger.info(chalk.yellow("\nCancelled."));
            return;
          }

          aiProvider = providerChoice.provider;

          // Get API key
          const selectedProvider = providers.find(
            (p) => p.value === aiProvider,
          );
          if (selectedProvider && selectedProvider.envKey) {
            const keyResponse = await promptWithCancel({
              type: "password",
              name: "apiKey",
              message: `${selectedProvider.name} API Key:`,
            });

            if (!keyResponse.apiKey) {
              logger.warn(
                chalk.yellow(
                  "\n⚠️ No API key provided. Skipping agent deployment.",
                ),
              );
              return;
            }

            aiApiKey = keyResponse.apiKey;
          }
        }

        // ═══════════════════════════════════════════════════════════════
        // PLAN SUMMARY
        // ═══════════════════════════════════════════════════════════════
        logger.info(
          chalk.gray("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"),
        );
        logger.info(chalk.white.bold("📋 Plan (Single Worker):"));

        // MCP servers first
        if (selectedMCPServers.length > 0) {
          logger.info(chalk.cyan("   MCP Servers:"));
          for (const mcp of selectedMCPServers) {
            logger.info(chalk.white(`   • ${mcp.name}`));
          }
        }

        // Agents
        if (selectedAgents.length > 0) {
          logger.info(chalk.cyan("   AI Agents:"));
          for (const agent of selectedAgents) {
            let extra = `${aiProvider}`;
            if (agent.requiresMcp && mcpServiceForDependent) {
              extra += ` → ${mcpServiceForDependent.name}`;
            }
            logger.info(chalk.white(`   • ${agent.name} (${extra})`));
          }
        }

        // Interfaces
        const hasInterfaces = deployPlayground || deployTelegram;
        if (hasInterfaces) {
          logger.info(chalk.cyan("   Interfaces:"));
          if (deployPlayground) {
            logger.info(chalk.white("   • Web Chat (Playground UI)"));
          }
          if (deployTelegram) {
            logger.info(chalk.white("   • Telegram Bot (webhook)"));
          }
        }
        console.log("");

        if (dryRun) {
          logger.info(chalk.yellow("🔍 Dry run - no deployment"));
          return;
        }

        // Confirm
        const confirm = await promptWithCancel({
          type: "confirm",
          name: "proceed",
          message: "Start?",
          initial: true,
        });

        if (!confirm.proceed) {
          logger.info(chalk.yellow("\nCancelled."));
          return;
        }

        // ═══════════════════════════════════════════════════════════════
        // GENERATE AND DEPLOY SINGLE WORKER
        // ═══════════════════════════════════════════════════════════════
        logger.info(
          chalk.gray("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"),
        );
        logger.info(
          chalk.white.bold("⏳ Generating single worker bundle...\n"),
        );

        // Convert selected components to ComponentConfig format
        // Map agent names to proper class names and bindings
        const agentNameMap: Record<
          string,
          { className: string; binding: string; route: string }
        > = {
          "simple-prompt-agent": {
            className: "SimplePromptAgent",
            binding: "AGENT",
            route: "/agent/chat/:sessionId?",
          },
          "dependent-agent": {
            className: "DependentAgent",
            binding: "DEPENDENT_AGENT",
            route: "/agent/dependent/chat/:sessionId?",
          },
        };

        const agentConfigs: ComponentConfig[] = selectedAgents.map((a) => {
          const mapped = agentNameMap[a.name] || {
            className: a.name
              .split("-")
              .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
              .join(""),
            binding: a.name.toUpperCase().replace(/-/g, "_"),
            route: `/agent/${a.name}/chat/:sessionId?`,
          };
          return {
            name: a.name,
            type: "agent" as const,
            description: a.description,
            requiresMcp: a.requiresMcp,
            exports: {
              className: mapped.className,
              binding: mapped.binding,
            },
            dependencies: [
              "@nullshot/agent",
              "@ai-sdk/openai",
              "@ai-sdk/anthropic",
            ],
            routes: { pattern: mapped.route, method: "all" },
          };
        });

        // Map MCP names to proper class names
        const mcpNameMap: Record<
          string,
          { className: string; binding: string }
        > = {
          "crud-mcp": { className: "TodoMcpServer", binding: "TODO_MCP" },
          "expense-mcp": {
            className: "ExpenseMcpServer",
            binding: "EXPENSE_MCP",
          },
          "env-variable-mcp": {
            className: "EnvVariableMcpServer",
            binding: "ENV_VARIABLE_MCP",
          },
          "secret-mcp": { className: "SecretMcpServer", binding: "SECRET_MCP" },
          "kv-mcp": { className: "KvMcpServer", binding: "KV_MCP" },
          "email-mcp": { className: "EmailMcpServer", binding: "EMAIL_MCP" },
          "image-mcp": { className: "ImageMcpServer", binding: "IMAGE_MCP" },
          "analytics-mcp": {
            className: "AnalyticsMcpServer",
            binding: "ANALYTICS_MCP",
          },
          "vectorize-mcp": {
            className: "VectorizeMcpServer",
            binding: "VECTORIZE_MCP",
          },
          "browser-mcp": {
            className: "BrowserMcpServer",
            binding: "BROWSER_MCP",
          },
          "workflows-mcp": {
            className: "WorkflowsMcpServer",
            binding: "WORKFLOWS_MCP",
          },
        };

        const mcpConfigs: ComponentConfig[] = selectedMCPServers.map((m) => {
          const mapped = mcpNameMap[m.name] || {
            className:
              m.name
                .split("-")
                .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
                .join("") + "Server",
            binding: m.name.toUpperCase().replace(/-/g, "_"),
          };
          return {
            name: m.name,
            type: "mcp" as const,
            description: m.description || `${m.name} MCP server`,
            exports: {
              className: mapped.className,
              binding: mapped.binding,
            },
            dependencies: ["@nullshot/mcp", "zod"],
            routes: {
              pattern: `/mcp/${m.name.replace("-mcp", "")}/*`,
              method: "all",
            },
          };
        });

        // Create KV namespace for Telegram sessions if needed
        let telegramKvId: string | undefined;
        if (deployTelegram) {
          logger.info(
            chalk.gray("   Creating KV namespace for Telegram sessions..."),
          );
          try {
            const { spawn: spawnKv } = await import("node:child_process");

            // Helper: run a command and capture stdout/stderr
            const runCommand = (
              args: string[],
              cwd: string,
            ): Promise<{ code: number; stdout: string; stderr: string }> =>
              new Promise((resolve) => {
                const proc = spawnKv("pnpm", args, {
                  cwd,
                  shell: false,
                  stdio: ["inherit", "pipe", "pipe"],
                });
                let stdout = "";
                let stderr = "";
                proc.stdout?.on("data", (data) => {
                  stdout += data.toString();
                });
                proc.stderr?.on("data", (data) => {
                  stderr += data.toString();
                });
                proc.on("close", (code) => {
                  resolve({ code: code ?? 1, stdout, stderr });
                });
                proc.on("error", () => {
                  resolve({ code: 1, stdout, stderr });
                });
              });

            // Helper: extract ID from TOML-style output (id = "...")
            const extractIdFromOutput = (output: string): string | null => {
              const match = output.match(/id\s*=\s*"([^"]+)"/);
              return match ? (match[1] ?? null) : null;
            };

            // Step 1: First, try to find existing SESSIONS namespace
            logger.info(
              chalk.gray("   Searching for existing KV namespace..."),
            );

            // Try to use wrangler from .nullshot-bundle if it exists, otherwise use root
            const bundlePath = path.join(rootDir, ".nullshot-bundle");
            const workingDir = existsSync(bundlePath) ? bundlePath : rootDir;

            logger.info(chalk.gray(`   Working directory: ${workingDir}`));
            logger.info(
              chalk.gray(`   Command: pnpm wrangler kv namespace list`),
            );

            const findSessionsIdWithDir = async (dir: string) => {
              const listResult = await runCommand(
                ["wrangler", "kv", "namespace", "list"],
                dir,
              );

              if (listResult.code !== 0) {
                logger.info(
                  chalk.yellow(
                    `   ⚠️ KV list command failed with code ${listResult.code}`,
                  ),
                );
                if (listResult.stderr) {
                  logger.info(
                    chalk.gray(
                      `   Error: ${listResult.stderr.substring(0, 200)}`,
                    ),
                  );
                }
                return null;
              }

              try {
                logger.debug(
                  chalk.gray(
                    `   [DEBUG] KV list output: ${listResult.stdout.substring(0, 200)}`,
                  ),
                );
                const namespaces = JSON.parse(listResult.stdout) as Array<{
                  id: string;
                  title: string;
                }>;
                logger.debug(
                  chalk.gray(
                    `   [DEBUG] Found ${namespaces.length} namespaces`,
                  ),
                );

                const sessions = namespaces.find(
                  (ns) =>
                    ns.title === "SESSIONS" ||
                    ns.title.endsWith("-SESSIONS") ||
                    ns.title.includes("SESSIONS"),
                );

                if (sessions) {
                  logger.debug(
                    chalk.gray(`   [DEBUG] Found SESSIONS: ${sessions.id}`),
                  );
                } else {
                  logger.debug(
                    chalk.gray(`   [DEBUG] No SESSIONS namespace found`),
                  );
                  logger.debug(
                    chalk.gray(
                      `   [DEBUG] Available titles: ${namespaces.map((n) => n.title).join(", ")}`,
                    ),
                  );
                }

                return sessions?.id ?? null;
              } catch (err) {
                logger.debug(chalk.gray(`   [DEBUG] JSON parse error: ${err}`));
                return null;
              }
            };

            telegramKvId =
              (await findSessionsIdWithDir(workingDir)) ?? undefined;

            if (telegramKvId) {
              logger.info(
                chalk.green(
                  `   ✓ Found existing SESSIONS namespace: ${telegramKvId}`,
                ),
              );
            } else {
              logger.info(
                chalk.yellow(
                  `   ⚠️ No existing SESSIONS namespace found, will try to create`,
                ),
              );
            }

            // Step 2: If not found, try to create it
            if (!telegramKvId) {
              const createResult = await runCommand(
                ["wrangler", "kv", "namespace", "create", "SESSIONS"],
                workingDir,
              );

              const combined = createResult.stdout + createResult.stderr;

              if (createResult.code === 0) {
                // Created successfully — extract ID from output
                telegramKvId =
                  extractIdFromOutput(combined) ??
                  (await findSessionsIdWithDir(workingDir)) ??
                  undefined;
              } else if (combined.includes("already exists")) {
                // Already exists — try list again
                telegramKvId =
                  (await findSessionsIdWithDir(workingDir)) ?? undefined;
              }
            }

            if (telegramKvId) {
              logger.info(
                chalk.green(`   ✓ KV namespace SESSIONS (${telegramKvId})`),
              );
            } else {
              logger.warn(
                chalk.yellow(
                  "   ⚠️ Could not resolve KV namespace ID. Run: pnpm wrangler kv namespace list",
                ),
              );
              logger.info(
                chalk.gray(
                  "   Then set the SESSIONS id in .nullshot-bundle/wrangler.jsonc",
                ),
              );
            }
          } catch (error) {
            logger.warn(
              chalk.yellow(
                "   ⚠️ KV namespace creation failed. Create manually after deploy.",
              ),
            );
          }
        }

        // Check for existing bundle and prompt for reset if needed
        let resetHistory = false;
        const bundleOutputDir = path.join(rootDir, ".nullshot-bundle");
        if (existsSync(bundleOutputDir)) {
          logger.info(
            chalk.gray("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"),
          );
          logger.info(chalk.cyan.bold("Step 6: Migration History"));

          const resetChoice = await promptWithCancel({
            type: "select",
            name: "action",
            message: "Found existing deployment configuration:",
            choices: [
              { title: "Keep existing history (Standard)", value: "keep" },
              {
                title: "Reset migration history (Fix deployment errors)",
                value: "reset",
              },
            ],
            initial: 0,
          });

          resetHistory = resetChoice.action === "reset";
          if (resetHistory) {
            logger.info(
              chalk.yellow("   ⚠️  Migration history will be reset."),
            );
          }
        }

        const bundleConfig: BundleConfig = {
          name: "nullshot-worker",
          outputDir: `${rootDir}/.nullshot-bundle`,
          agents: agentConfigs,
          mcps: mcpConfigs,
          includePlayground: deployPlayground,
          aiProvider,
          includeTelegram: deployTelegram,
          resetHistory,
          ...(telegramKvId ? { telegramKvId } : {}),
          ...(Object.keys(mcpBindingConfigs).length > 0 && {
            mcpBindings: mcpBindingConfigs,
          }),
        };

        // Build packages first to ensure latest changes are included
        logger.info(chalk.gray("   Building packages..."));
        logger.info(chalk.gray(`   Running: pnpm build:packages`));
        const { spawn: spawnBuild } = await import("node:child_process");

        await new Promise<void>((resolve, reject) => {
          const build = spawnBuild("pnpm", ["build:packages"], {
            cwd: rootDir,
            stdio: "inherit",
            shell: false,
          });

          build.on("close", (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(
                new Error(`pnpm build:packages failed with exit code ${code}`),
              );
            }
          });

          build.on("error", (error) => {
            reject(error);
          });
        });
        logger.info(chalk.green("   ✓ Packages built"));

        // Generate bundle
        await createBundle(bundleConfig);
        logger.info(chalk.green("   ✓ Bundle generated"));

        // Install dependencies
        logger.info(chalk.gray("   Installing dependencies..."));
        logger.info(
          chalk.gray(`   Running: pnpm install in ${bundleConfig.outputDir}`),
        );
        const { spawn: spawnImport } = await import("node:child_process");

        await new Promise<void>((resolve, reject) => {
          const install = spawnImport("pnpm", ["install"], {
            cwd: bundleConfig.outputDir,
            stdio: "inherit", // Show output to user
            shell: false,
          });

          install.on("close", (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`pnpm install failed with exit code ${code}`));
            }
          });

          install.on("error", (error) => {
            reject(new Error(`Failed to start pnpm install: ${error.message}`));
          });
        });
        logger.info(chalk.green("   ✓ Dependencies installed"));

        // Set secrets
        if (!options.skipSecrets) {
          logger.info(chalk.gray("   Setting secrets..."));
          await setSecret(bundleConfig.outputDir, "AI_PROVIDER", aiProvider);

          if (aiApiKey) {
            const providers = getAvailableProviders();
            const provider = providers.find((p) => p.value === aiProvider);
            if (provider && provider.envKey) {
              await setSecret(
                bundleConfig.outputDir,
                provider.envKey,
                aiApiKey,
              );
            }
          }
          logger.info(chalk.green("   ✓ Secrets configured"));
        }

        // Set Telegram secrets
        if (deployTelegram && !options.skipSecrets && telegramBotToken) {
          logger.info(chalk.gray("   Setting Telegram secrets..."));
          await setSecret(
            bundleConfig.outputDir,
            "TELEGRAM_BOT_TOKEN",
            telegramBotToken,
          );
          await setSecret(
            bundleConfig.outputDir,
            "TELEGRAM_WEBHOOK_SECRET",
            telegramWebhookSecret,
          );
          logger.info(chalk.green("   ✓ Telegram secrets configured"));
        }

        // Create Vectorize index for chat memory (when Telegram is enabled)
        if (deployTelegram) {
          logger.info(
            chalk.gray("   Creating Vectorize index for chat memory..."),
          );
          const vectorizeResult = await createVectorizeIndex(
            "chat-memory",
            1024,
            "cosine",
            bundleConfig.outputDir,
          );
          if (vectorizeResult.success) {
            logger.info(chalk.green("   ✓ Vectorize index ready"));
          } else {
            logger.warn(
              chalk.yellow(
                `   ⚠ Vectorize index creation failed: ${vectorizeResult.error}`,
              ),
            );
            logger.warn(
              chalk.yellow(
                "     Chat memory will be unavailable. You can create it manually:",
              ),
            );
            logger.warn(
              chalk.gray(
                "     npx wrangler vectorize create chat-memory --dimensions=1024 --metric=cosine",
              ),
            );
          }
        }

        // Deploy single worker
        logger.info(chalk.gray("   Deploying..."));

        // Deploy bundle directly using wrangler from workspace
        const deployResult = await new Promise<{
          success: boolean;
          url?: string;
          error?: string;
        }>((resolve) => {
          const wrangler = spawnImport("pnpm", ["exec", "wrangler", "deploy"], {
            cwd: bundleConfig.outputDir,
            shell: false,
            stdio: ["inherit", "pipe", "pipe"],
          });

          let stdout = "";
          let stderr = "";

          wrangler.stdout?.on("data", (data) => {
            stdout += data.toString();
          });

          wrangler.stderr?.on("data", (data) => {
            stderr += data.toString();
          });

          wrangler.on("close", (code) => {
            if (code === 0) {
              // Try to extract URL from output
              const urlMatch = stdout.match(/https:\/\/[^\s]+\.workers\.dev/);
              const url = urlMatch ? urlMatch[0] : undefined;
              const result: { success: boolean; url?: string; error?: string } =
                {
                  success: true,
                };
              if (url) {
                result.url = url;
              }
              resolve(result);
            } else {
              resolve({
                success: false,
                error: stderr || stdout || `Exit code: ${code}`,
              });
            }
          });

          wrangler.on("error", (error) => {
            resolve({
              success: false,
              error: error.message,
            });
          });
        });

        const result = {
          name: "nullshot-worker",
          success: deployResult.success,
          ...(deployResult.url && { url: deployResult.url }),
          ...(deployResult.error && { error: deployResult.error }),
        };

        if (result.success) {
          logger.info(chalk.green(`   ✓ Deployed → ${result.url}`));

          // Set up Telegram webhook after successful deployment
          if (deployTelegram && telegramBotToken && result.url) {
            logger.info(chalk.gray("   Setting up Telegram webhook..."));
            const webhookOk = await setTelegramWebhook(
              telegramBotToken,
              `${result.url}/telegram/webhook`,
              telegramWebhookSecret,
            );
            if (webhookOk) {
              logger.info(chalk.green("   ✓ Telegram webhook configured"));
            } else {
              logger.warn(
                chalk.yellow(
                  "   ⚠️ Failed to set Telegram webhook. Set it manually:",
                ),
              );
              logger.info(
                chalk.gray(
                  `      curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=${result.url}/telegram/webhook"`,
                ),
              );
            }
          }

          // Final summary
          logger.info(
            chalk.gray("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"),
          );
          logger.info(chalk.green.bold("✅ Done! Single worker deployed.\n"));
          logger.info(
            chalk.white.bold("🚀 Your app: ") + chalk.cyan(result.url),
          );
          if (deployTelegram) {
            logger.info(
              chalk.white.bold("🤖 Telegram Bot: ") +
                chalk.cyan(
                  "active (webhook → " + result.url + "/telegram/webhook)",
                ),
            );
          }
          console.log("");
          logger.info(chalk.gray("Bundle saved at: .nullshot-bundle/"));
          console.log("");
        } else {
          const errorInfo = parseCloudflareError(
            result.error || "Unknown error",
          );
          logger.info("\n" + formatErrorInline(errorInfo, "single-worker"));
        }
      } catch (error) {
        logger.error(chalk.red("❌ Deployment failed"));
        handleError(error);
      } finally {
        // Restore original working directory
        if (cwd && cwd !== originalCwd) {
          process.chdir(originalCwd);
        }
      }
    },
  );

// Bundle command - create single-worker from selected components
program
  .command("bundle")
  .description(
    "Create a single-worker bundle from selected components (agents + MCPs + UI)",
  )
  .option("-o, --output <dir>", "Output directory", "./bundled-worker")
  .option("-n, --name <name>", "Project name", "my-ai-worker")
  .action(
    async (options: { output?: string; name?: string } & GlobalOptions) => {
      const { dryRun, verbose, cwd } = program.opts<GlobalOptions>();

      // Change to the specified working directory
      const originalCwd = process.cwd();
      if (cwd && cwd !== originalCwd) {
        process.chdir(cwd);
      }

      try {
        if (verbose) logger.setVerbose(true);

        // Check if stdin is a TTY (interactive terminal)
        if (!process.stdin.isTTY) {
          logger.error(
            chalk.red("❌ This command requires an interactive terminal"),
          );
          logger.info(
            chalk.yellow(
              "💡 Make sure you're running this command in a terminal, not through a non-interactive process",
            ),
          );
          process.exit(1);
        }

        // Set up signal handlers for graceful shutdown
        const signalHandler = () => {
          console.log("\n");
          logger.info(chalk.yellow("Cancelled by user"));
          process.exit(0);
        };
        process.on("SIGINT", signalHandler);
        process.on("SIGTERM", signalHandler);

        const promptsModule = await import("prompts");
        const prompts = promptsModule.default;

        // Helper to add onCancel to all prompts
        const promptWithCancel = (config: any) => {
          return prompts(config, {
            onCancel: () => {
              console.log("\n");
              logger.info(chalk.yellow("Cancelled by user"));
              process.exit(0);
            },
          });
        };

        const rootDir = process.cwd();

        // Header
        console.log("");
        logger.info(
          chalk.blue.bold("📦 Nullshot Bundle - Single Worker Generator"),
        );
        logger.info(
          chalk.gray(
            "Creates ONE worker with selected agents, MCPs, and playground UI\n",
          ),
        );

        // Discover available components
        const { agents, mcps } = await discoverComponents(rootDir);

        if (agents.length === 0 && mcps.length === 0) {
          logger.error(chalk.red("No components found with component.json"));
          logger.info(
            chalk.gray("Add component.json to examples/ directories"),
          );
          return;
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 1: Select Agents
        // ═══════════════════════════════════════════════════════════════
        let selectedAgents: ComponentConfig[] = [];

        if (agents.length > 0) {
          logger.info(chalk.cyan.bold("Step 1: Select AI Agents"));

          const agentSelection = await promptWithCancel({
            type: "multiselect",
            name: "agents",
            message: "Agents to include:",
            choices: agents.map((a) => ({
              title: `${a.name} ${chalk.gray(`- ${a.description}`)}`,
              value: a.name,
              selected: a.name === "simple-prompt-agent",
            })),
            hint: "Space to select, Enter to continue",
          });

          selectedAgents = agents.filter((a) =>
            agentSelection.agents?.includes(a.name),
          );
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 2: Select MCPs
        // ═══════════════════════════════════════════════════════════════
        let selectedMcps: ComponentConfig[] = [];
        const bundleAgentRequiringMcp = selectedAgents.find(
          (a) => a.requiresMcp,
        );

        if (mcps.length > 0 && bundleAgentRequiringMcp) {
          logger.info(
            chalk.gray("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"),
          );
          logger.info(chalk.cyan.bold("Step 2: Select MCP Servers (Tools)"));

          const mcpSelection = await promptWithCancel({
            type: "multiselect",
            name: "mcps",
            message: "MCPs to include:",
            choices: mcps.map((m) => {
              if (m.disabled) {
                return {
                  title: `${chalk.dim(m.name)} ${chalk.dim.gray(`- ${m.disabledReason || "Coming soon"}`)}`,
                  value: m.name,
                  selected: false,
                  disabled: true,
                };
              }
              return {
                title: `${m.name} ${chalk.gray(`- ${m.description}`)}`,
                value: m.name,
                selected: m.name === "crud-mcp",
              };
            }),
            hint: "Space to select, Enter to continue",
          });

          selectedMcps = mcps.filter((m) =>
            mcpSelection.mcps?.includes(m.name),
          );
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 3: Include Playground?
        // ═══════════════════════════════════════════════════════════════
        logger.info(
          chalk.gray("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"),
        );
        logger.info(chalk.cyan.bold("Step 3: Include Playground UI?"));

        const uiSelection = await promptWithCancel({
          type: "confirm",
          name: "includePlayground",
          message: "Include web playground UI?",
          initial: true,
        });

        // ═══════════════════════════════════════════════════════════════
        // STEP 4: Include Telegram Bot?
        // ═══════════════════════════════════════════════════════════════
        let includeTelegram = false;

        if (selectedAgents.length > 0) {
          logger.info(
            chalk.gray("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"),
          );
          logger.info(chalk.cyan.bold("Step 4: Telegram Bot Integration"));

          const telegramSelection = await promptWithCancel({
            type: "confirm",
            name: "includeTelegram",
            message:
              "Include Telegram Bot webhook? (forwards messages to your agent)",
            initial: false,
          });

          includeTelegram = telegramSelection.includeTelegram || false;
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 5: AI Provider
        // ═══════════════════════════════════════════════════════════════
        let aiProvider = "workers-ai";

        if (selectedAgents.length > 0) {
          logger.info(
            chalk.gray("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"),
          );
          logger.info(chalk.cyan.bold("Step 5: Default AI Provider"));

          const providerChoice = await promptWithCancel({
            type: "select",
            name: "provider",
            message: "AI provider:",
            choices: [
              {
                title: "Cloudflare Workers AI (Llama, free tier)",
                value: "workers-ai",
              },
              { title: "OpenAI (gpt-4o-mini)", value: "openai" },
              { title: "Anthropic (claude-3-haiku)", value: "anthropic" },
              { title: "DeepSeek (deepseek-chat)", value: "deepseek" },
            ],
            initial: 0,
          });

          aiProvider = providerChoice.provider || "workers-ai";
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 6: Output
        // ═══════════════════════════════════════════════════════════════
        logger.info(
          chalk.gray("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"),
        );
        logger.info(chalk.cyan.bold("Step 6: Output"));

        const outputResponse = await promptWithCancel([
          {
            type: "text",
            name: "name",
            message: "Project name:",
            initial: options.name || "my-ai-worker",
          },
          {
            type: "text",
            name: "output",
            message: "Output directory:",
            initial: options.output || "./bundled-worker",
          },
        ]);

        // ═══════════════════════════════════════════════════════════════
        // SUMMARY
        // ═══════════════════════════════════════════════════════════════
        logger.info(
          chalk.gray("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"),
        );
        logger.info(chalk.white.bold("📋 Bundle Summary:"));

        logger.info(
          chalk.cyan("   Agents: ") +
            (selectedAgents.length
              ? selectedAgents.map((a) => a.name).join(", ")
              : "none"),
        );
        logger.info(
          chalk.cyan("   MCPs: ") +
            (selectedMcps.length
              ? selectedMcps.map((m) => m.name).join(", ")
              : "none"),
        );
        logger.info(
          chalk.cyan("   Playground: ") +
            (uiSelection.includePlayground ? "yes" : "no"),
        );
        logger.info(
          chalk.cyan("   Telegram: ") + (includeTelegram ? "yes" : "no"),
        );
        logger.info(chalk.cyan("   AI Provider: ") + aiProvider);
        logger.info(chalk.cyan("   Output: ") + outputResponse.output);
        console.log("");

        if (dryRun) {
          logger.info(chalk.yellow("🔍 Dry run - no files created"));
          return;
        }

        // Confirm
        const confirm = await promptWithCancel({
          type: "confirm",
          name: "proceed",
          message: "Generate bundle?",
          initial: true,
        });

        if (!confirm.proceed) {
          logger.info(chalk.yellow("\nCancelled."));
          return;
        }

        // ═══════════════════════════════════════════════════════════════
        // GENERATE
        // ═══════════════════════════════════════════════════════════════
        const spinner = ora("Generating bundle...").start();

        const bundleConfig: BundleConfig = {
          name: outputResponse.name,
          outputDir: outputResponse.output,
          agents: selectedAgents,
          mcps: selectedMcps,
          includePlayground: uiSelection.includePlayground,
          aiProvider,
          includeTelegram,
        };

        // Build packages first to ensure latest changes are included
        logger.info(chalk.gray("   Building packages..."));
        const { spawn: spawnBuild } = await import("node:child_process");

        await new Promise<void>((resolve, reject) => {
          const build = spawnBuild("pnpm", ["build:packages"], {
            cwd: rootDir,
            stdio: "inherit",
            shell: false,
          });

          build.on("close", (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(
                new Error(`pnpm build:packages failed with exit code ${code}`),
              );
            }
          });

          build.on("error", (error) => {
            reject(error);
          });
        });

        await createBundle(bundleConfig);

        spinner.succeed(chalk.green("✅ Bundle generated!"));

        // Next steps
        logger.info(chalk.blue("\n🚀 Next steps:"));
        logger.info(`   cd ${outputResponse.output}`);
        logger.info("   pnpm install");
        logger.info(
          "   wrangler secret put OPENAI_API_KEY  # or your provider's key",
        );
        if (includeTelegram) {
          logger.info(
            "   wrangler secret put TELEGRAM_BOT_TOKEN  # from @BotFather",
          );
          logger.info(
            "   wrangler secret put TELEGRAM_WEBHOOK_SECRET  # any random string",
          );
          logger.info(
            chalk.gray(
              "   # After deploy: set webhook via /telegram/webhook/info endpoint",
            ),
          );
        }
        logger.info("   pnpm dev");
        console.log("");
      } catch (error) {
        logger.error(chalk.red("❌ Bundle generation failed"));
        handleError(error);
      } finally {
        if (cwd && cwd !== originalCwd) {
          process.chdir(originalCwd);
        }
      }
    },
  );

process.on("uncaughtException", (error) => {
  logger.error(`${chalk.red("Uncaught exception:")}, ${error}`);
  process.exit(1);
});

program.parse();
