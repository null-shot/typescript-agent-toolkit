/**
 * Simple ajv-formats mock to avoid compatibility issues in Cloudflare Workers environment
 * This mock provides a no-op implementation for testing purposes
 */

/**
 * Mock implementation of ajv-formats that does nothing
 * This prevents module resolution issues in Cloudflare Workers test environment
 */
export default function ajvFormats(ajv: any, options?: any) {
  // No-op implementation for testing
  return ajv;
}

// Named export for ES modules
export { ajvFormats };
