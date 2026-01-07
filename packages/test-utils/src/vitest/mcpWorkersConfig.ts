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
  /** Custom ajv-formats mock package path */
  ajvFormatsMockPath?: string;
  /** Additional SSR external packages */
  additionalSsrExternals?: string[];
  /** Additional options to pass to defineWorkersConfig */
  [key: string]: any;
}

/**
 * Creates a default MCP Workers configuration for Vitest
 * This handles the complex ajv compatibility issues that arise when testing MCP clients
 */
export function createMcpWorkersConfig(options: McpWorkersConfigOptions = {}) {
  const {
    test = {},
    wranglerConfigPath = "./wrangler.jsonc",
    additionalAliases = {},
    includeAjvMock = true,
    ajvMockPath = "@nullshot/test-utils/vitest/ajv-mock",
    ajvFormatsMockPath = "@nullshot/test-utils/vitest/ajv-formats-mock",
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
    },
    resolve: {
      alias: {
        ...(includeAjvMock && {
          ajv: ajvMockPath,
          "ajv/dist/ajv": ajvMockPath,
          "ajv/dist/compile/codegen": ajvMockPath,
          "ajv/dist/compile": ajvMockPath,
          "ajv-formats": ajvFormatsMockPath,
          "@modelcontextprotocol/sdk/dist/esm/validation/ajv-formats": ajvFormatsMockPath,
        }),
        ...additionalAliases,
      },
    },
    ssr: {
      noExternal: includeAjvMock ? ["@modelcontextprotocol/sdk"] : [],
    },
    ...otherOptions,
  };

  return defineWorkersConfig(config);
}

/**
 * Pre-configured MCP Workers config with standard defaults
 */
export const defaultMcpWorkersConfig = createMcpWorkersConfig();
