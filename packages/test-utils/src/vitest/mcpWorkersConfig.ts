/**
 * Default MCP Workers configuration for Vitest tests
 * Includes ajv compatibility workarounds and standard MCP testing setup
 */
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export interface McpWorkersConfigOptions {
  /** Test configuration options */
  test?: any;
  /** Path to wrangler config file */
  wranglerConfigPath?: string;
  /** Additional path aliases for module resolution */
  additionalAliases?: Record<string, string>;
  /** Whether to include ajv mocking */
  includeAjvMock?: boolean;
  /** Custom ajv mock package path */
  ajvMockPath?: string;
  /** Whether to use Vitest module mocking instead of aliasing */
  useVitestModuleMock?: boolean;
  /** Additional modules to mock with Vitest */
  vitestModuleMocks?: Record<string, string>;
  /** Path to a setup file for Vitest module mocks */
  vitestSetupFile?: string;
  /** Additional SSR external packages */
  additionalSsrExternals?: string[];
  /** Additional options to pass to defineWorkersConfig */
  [key: string]: any;
}

/**
 * Creates a default MCP Workers configuration for Vitest
 * This handles the complex ajv compatibility issues that arise when testing MCP clients
 *
 * Supports both alias-based mocking (legacy) and Vitest module mocking (recommended)
 */
export function createMcpWorkersConfig(options: McpWorkersConfigOptions = {}) {
  const {
    test = {},
    wranglerConfigPath = "./wrangler.jsonc",
    additionalAliases = {},
    includeAjvMock = true,
    ajvMockPath = "@nullshot/test-utils/vitest/ajv-mock",
    useVitestModuleMock = false,
    vitestModuleMocks = {},
    vitestSetupFile,
    additionalSsrExternals = [],
    ...otherOptions
  } = options;

  const config = {
    test: {
      poolOptions: {
        workers: {
          isolatedStorage: false, // Must have for Durable Objects
          singleWorker: true,
          wrangler: { configPath: wranglerConfigPath },
        },
      },
      ...test,
      // Add setupFiles for Vitest module mocking
      ...(useVitestModuleMock && {
        setupFiles: [
          ...(test.setupFiles || []),
          // Add user-provided setup file or default
          ...(vitestSetupFile
            ? [vitestSetupFile]
            : ["@nullshot/test-utils/vitest/setup-ajv-mock"]),
        ],
      }),
    },
    resolve: {
      alias: {
        // Only use aliasing if not using Vitest module mocking
        ...(!useVitestModuleMock &&
          includeAjvMock && {
            ajv: ajvMockPath,
            "ajv/dist/ajv": ajvMockPath,
          }),
        ...additionalAliases,
      },
    },
    ...otherOptions,
  };

  return defineWorkersConfig(config);
}

/**
 * Pre-configured MCP Workers config with standard defaults
 */
export const defaultMcpWorkersConfig = createMcpWorkersConfig();
