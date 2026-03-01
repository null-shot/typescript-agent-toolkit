// MCP package export file
// Force version to 0.1.0 for MCP
export * from './mcp/server.js';
export * from './mcp/hono-server.js';
export * from './mcp/sse-transport.js';
// export * from './mcp/interfaces.js'  // This file doesn't exist
export * from './mcp/websocket-transport.js';
// Export the McpHonoServerDO class
export { McpHonoServerDO } from './mcp/hono-server';
export { McpServerDO } from './mcp/server';

// Export OAuth2 authentication functionality
export * from './auth/types.js';
export { createAuthMiddleware, getAuthContext, setupAuth } from './auth/index.js';
export { createPrmHandler, generateProtectedResourceMetadata } from './auth/prm-handler.js';
