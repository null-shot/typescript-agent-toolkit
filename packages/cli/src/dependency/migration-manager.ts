import { exec } from "child_process";
import { promisify } from "util";
import { CLIError } from "../utils/errors.js";
import { Logger } from "../utils/logger.js";
import { DryRunManager } from "../utils/dry-run.js";

const execAsync = promisify(exec);
const logger = new Logger();

export interface MigrationResult {
  dependency: string;
  wranglerConfigPath: string;
  success: boolean;
  error?: string;
}

export class MigrationManager {
  constructor(private dryRunManager?: DryRunManager) {}

  /**
   * Get all dependency wrangler config paths for use with wrangler -c flags
   */
  getDependencyWranglerFlags(
    dependencyWranglerPaths: Array<{
      name: string;
      wranglerConfigPath: string;
    }>
  ): string[] {
    return dependencyWranglerPaths.map(dep => `-c ${dep.wranglerConfigPath}`);
  }

  /**
   * Execute D1 migrations for dependencies with D1 databases
   */
  async executeD1MigrationsForDependencies(
    dependencies: Array<{
      name: string;
      wranglerConfigPath: string;
      d1Databases?: string[];
    }>
  ): Promise<MigrationResult[]> {
    const results: MigrationResult[] = [];
    
    const d1Dependencies = dependencies.filter(dep => dep.d1Databases && dep.d1Databases.length > 0);
    
    if (d1Dependencies.length === 0) {
      logger.debug("No dependencies with D1 databases found");
      return results;
    }

    logger.info(`Executing D1 migrations for ${d1Dependencies.length} dependencies`);

    for (const dependency of d1Dependencies) {
      if (!dependency.d1Databases) continue;
      
      for (const databaseBinding of dependency.d1Databases) {
        const result = await this.executeD1MigrationForBinding(dependency, databaseBinding);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Execute D1 migration for a single database binding
   */
  private async executeD1MigrationForBinding(
    dependency: { name: string; wranglerConfigPath: string },
    databaseBinding: string
  ): Promise<MigrationResult> {
    const result: MigrationResult = {
      dependency: `${dependency.name}:${databaseBinding}`,
      wranglerConfigPath: dependency.wranglerConfigPath,
      success: false,
    };

    try {
      await this.runWranglerD1Migrations(dependency.name, dependency.wranglerConfigPath, databaseBinding);
      result.success = true;
      logger.debug(`✅ D1 migrations executed for ${dependency.name}:${databaseBinding}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.error = errorMessage;
      logger.warn(`⚠️  D1 migration failed for ${dependency.name}:${databaseBinding}: ${errorMessage}`);
    }

    return result;
  }

  /**
   * Run wrangler D1 migrations using the dependency's configuration
   */
  private async runWranglerD1Migrations(
    dependencyName: string, 
    wranglerConfigPath: string, 
    databaseBinding: string
  ): Promise<void> {
    const command = `npx wrangler d1 migrations apply ${databaseBinding} --local --config ${wranglerConfigPath}`;

    if (this.dryRunManager?.isEnabled()) {
      logger.info(`[DRY RUN] Would execute: ${command}`);
      return;
    }

    try {
      logger.debug(`Executing D1 migrations for ${dependencyName}:${databaseBinding}: ${command}`);
      
      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        env: process.env,
      });

      if (stdout) {
        logger.debug(`D1 migration output for ${dependencyName}:${databaseBinding}: ${stdout}`);
      }

      if (stderr && !stderr.includes("Warning")) {
        logger.debug(`D1 migration stderr for ${dependencyName}:${databaseBinding}: ${stderr}`);
      }

    } catch (error: any) {
      // Don't throw errors for "no migrations" cases - just log them
      if (error.message.includes("No migrations to apply") || 
          error.message.includes("up to date") ||
          error.message.includes("already applied")) {
        logger.debug(`D1 database ${databaseBinding} is up to date`);
        return;
      }
      
      throw new CLIError(
        `Failed to execute D1 migrations for ${dependencyName}:${databaseBinding}: ${error.message}`,
        "Make sure wrangler is installed and you have the necessary permissions",
        1
      );
    }
  }
}