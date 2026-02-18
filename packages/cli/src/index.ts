// Main exports for the Nullshot CLI package
export { ConfigManager } from "./config/config-manager.js";
export { PackageManager } from "./package/package-manager.js";
export { WranglerManager } from "./wrangler/wrangler-manager.js";
export { DryRunManager } from "./utils/dry-run.js";
export { CLIError } from "./utils/errors.js";
export { Logger } from "./utils/logger.js";
export { TemplateManager } from "./template/template-manager.js";
export { InputManager } from "./template/input-manager.js";
export { DependencyAnalyzer } from "./dependency/dependency-analyzer.js";
export { MigrationManager } from "./dependency/migration-manager.js";

// Bundle manager for single-worker generation
export { 
  createBundle, 
  discoverComponents,
  generateBundledIndexTs,
  generateWranglerConfig,
  generatePackageJson,
} from "./bundle/bundle-manager.js";

// Export types
export type {
  MCPConfig,
  MCPServerConfig,
  EnvironmentVariable,
  AuthConfig,
  InstallOptions,
  ListOptions,
  PackageManagerInfo,
  WranglerConfig,
  MCPServerMetadata,
  DependencyAnalysisResult,
  MigrationConfig
} from "./types/index.js";

// Export bundle types
export type { 
  ComponentConfig, 
  BundleConfig 
} from "./bundle/bundle-manager.js";

// Note: CLI program is not exported as it's designed for command-line use only
