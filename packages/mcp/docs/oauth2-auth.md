# OAuth2 Authentication for MCP Servers

This document describes how to implement OAuth2 bearer token authentication for MCP servers using the `@nullshot/mcp` package.

## Overview

The OAuth2 authentication middleware enables you to protect your MCP server endpoints using bearer tokens. It implements the [MCP authorization flow](https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/authorization/) and follows [RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728) for Protected Resource Metadata.

### Key Features

- **Bearer Token Validation**: Validates OAuth2 bearer tokens from the `Authorization` header
- **Protected Resource Metadata (PRM)**: Serves OAuth2 metadata at `.well-known/oauth-protected-resource`
- **WWW-Authenticate Headers**: Returns proper 401 responses with PRM URLs for authentication discovery
- **Flexible Token Validation**: Supports any token validation logic via callback function
- **Excluded Paths**: Configure paths that don't require authentication (e.g., health checks)
- **Hono Integration**: Works seamlessly with `McpHonoServerDO` and standard `McpServerDO`

## Quick Start

### Basic Setup with McpHonoServerDO

```typescript
import { McpHonoServerDO } from '@nullshot/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Implementation } from '@modelcontextprotocol/sdk/types.js';

class MyAuthServer extends McpHonoServerDO<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Setup OAuth2 authentication
    this.setupAuth({
      validateToken: async (token) => {
        // Implement your token validation logic
        // Return validation result
        return { valid: true, scopes: ['mcp'] };
      },
      resourceUrl: 'https://api.example.com/mcp',
      authorizationServers: ['https://auth.example.com'],
      scopesSupported: ['mcp', 'mcp:tools'],
    });
  }

  getImplementation(): Implementation {
    return { name: 'MyAuthServer', version: '1.0.0' };
  }

  configureServer(server: McpServer): void {
    // Register your tools here
  }
}
```

### Setup with McpServerDO

```typescript
import { McpServerDO } from '@nullshot/mcp';

class MyAuthServer extends McpServerDO<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Configure authentication
    this.setAuthConfig({
      validateToken: async (token) => {
        return { valid: true, scopes: ['mcp'] };
      },
      resourceUrl: 'https://api.example.com/mcp',
      authorizationServers: ['https://auth.example.com'],
    });
  }

  // ... implementation
}
```

### Manual Hono Middleware Setup

For more control, you can manually configure the auth middleware:

```typescript
import { Hono } from 'hono';
import { setupAuth } from '@nullshot/mcp';

const app = new Hono();

setupAuth(app, {
  validateToken: async (token) => {
    // Your validation logic
    return { valid: true, scopes: ['mcp'] };
  },
  resourceUrl: 'https://api.example.com/mcp',
  authorizationServers: ['https://auth.example.com'],
  scopesSupported: ['mcp', 'mcp:tools'],
  excludedPaths: ['/health'],
});
```

## Configuration Options

### AuthMiddlewareConfig

The configuration object for OAuth2 authentication:

```typescript
interface AuthMiddlewareConfig {
  /**
   * Required: Function to validate bearer tokens.
   * Called for every request that requires authentication.
   */
  validateToken: (token: string) => Promise<TokenValidationResult>;

  /**
   * Required: Base URL for the MCP server.
   * Used as the resource identifier in the PRM document.
   */
  resourceUrl: string;

  /**
   * Required: List of authorization server URLs.
   * Clients use these to discover token endpoints.
   */
  authorizationServers: string[];

  /**
   * Optional: Supported OAuth2 scopes.
   * Defaults to ['mcp'] if not specified.
   */
  scopesSupported?: string[];

  /**
   * Optional: URL paths to exclude from authentication.
   * Useful for health checks, public endpoints, etc.
   */
  excludedPaths?: string[];

  /**
   * Optional: Custom path for the PRM endpoint.
   * Defaults to '.well-known/oauth-protected-resource'.
   */
  prmPath?: string;

  /**
   * Optional: Realm value for WWW-Authenticate header.
   * Defaults to 'mcp'.
   */
  realm?: string;
}
```

### TokenValidationResult

The result returned by the `validateToken` function:

```typescript
interface TokenValidationResult {
  /** Whether the token is valid */
  valid: boolean;

  /** Scopes granted to this token (if any) */
  scopes?: string[];

  /** Error message if validation failed */
  error?: string;

  /** Additional claims from the token (e.g., sub, iss, aud) */
  claims?: Record<string, unknown>;
}
```

## Token Validation

The `validateToken` function is where you implement your token validation logic. This function is called for every request that requires authentication.

### Example: JWT Validation with jose

```typescript
import { jwtVerify, createRemoteJWKSet } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL('https://auth.example.com/.well-known/jwks.json')
);

this.setupAuth({
  validateToken: async (token) => {
    try {
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: 'https://auth.example.com',
        audience: 'my-mcp-server',
      });

      return {
        valid: true,
        scopes: payload.scope?.split(' ') || ['mcp'],
        claims: payload,
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Invalid token',
      };
    }
  },
  resourceUrl: 'https://api.example.com/mcp',
  authorizationServers: ['https://auth.example.com'],
});
```

### Example: Opaque Token Introspection

```typescript
this.setupAuth({
  validateToken: async (token) => {
    const response = await fetch('https://auth.example.com/introspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${encodeURIComponent(token)}`,
    });

    const data = await response.json();

    if (!data.active) {
      return { valid: false, error: 'Token is not active' };
    }

    return {
      valid: true,
      scopes: data.scope?.split(' ') || ['mcp'],
      claims: data,
    };
  },
  resourceUrl: 'https://api.example.com/mcp',
  authorizationServers: ['https://auth.example.com'],
});
```

## Protected Resource Metadata (PRM)

The PRM document is served at `.well-known/oauth-protected-resource` (or your custom path) and provides information about the protected resource and how to authenticate.

### PRM Document Structure

```json
{
  "resource": "https://api.example.com/mcp",
  "authorization_servers": ["https://auth.example.com"],
  "scopes_supported": ["mcp", "mcp:tools", "mcp:resources"],
  "bearer_methods_supported": ["header"]
}
```

### Fields

- **resource**: The resource identifier (URL of the MCP server)
- **authorization_servers**: Array of authorization server URLs that can issue tokens
- **scopes_supported**: OAuth2 scopes supported by this resource
- **bearer_methods_supported**: Token presentation methods (always `["header"]`)

## Authentication Flow

When a client connects to your protected MCP server:

1. **Initial Request**: Client sends request without authentication
2. **401 Response**: Server returns 401 with `WWW-Authenticate` header containing PRM URL
3. **PRM Discovery**: Client fetches PRM document to learn about authorization servers
4. **Token Acquisition**: Client obtains token from authorization server (OAuth2 flow)
5. **Authenticated Request**: Client sends request with `Authorization: Bearer <token>` header
6. **Success**: Server validates token and processes request

### WWW-Authenticate Header

When authentication fails, the server returns a 401 response with a `WWW-Authenticate` header:

```http
WWW-Authenticate: Bearer realm="mcp",
  resource_metadata="https://api.example.com/.well-known/oauth-protected-resource",
  error="invalid_token",
  error_description="Token is invalid or expired"
```

## Accessing Auth Context

After successful authentication, you can access the auth context in your route handlers:

```typescript
import { getAuthContext } from '@nullshot/mcp';

app.get('/protected', async (c) => {
  const auth = getAuthContext(c);

  if (!auth?.authenticated) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Access token information
  const scopes = auth.token?.scopes;
  const userId = auth.token?.claims?.sub;

  return c.json({
    message: 'Access granted',
    userId,
    scopes,
  });
});
```

## Excluded Paths

Configure paths that don't require authentication using the `excludedPaths` option:

```typescript
this.setupAuth({
  validateToken: async (token) => { /* ... */ },
  resourceUrl: 'https://api.example.com/mcp',
  authorizationServers: ['https://auth.example.com'],
  excludedPaths: [
    '/health',              // Exact match
    '/public/',             // Prefix match (matches /public/*)
    '/.well-known/',        // PRM endpoint is automatically excluded
  ],
});
```

## Error Handling

The middleware handles various error scenarios:

### Missing Authorization Header

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="mcp",
  resource_metadata="...",
  error="invalid_token",
  error_description="Missing or malformed Authorization header"

{"error":"invalid_token","error_description":"Missing or malformed Authorization header"}
```

### Invalid Token

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="mcp",
  resource_metadata="...",
  error="invalid_token",
  error_description="Token is invalid or expired"

{"error":"invalid_token","error_description":"Token is invalid or expired"}
```

### Token Validation Error

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="mcp",
  resource_metadata="...",
  error="server_error",
  error_description="Token validation error: ..."

{"error":"server_error","error_description":"Token validation error: ..."}
```

## Integration with External Auth Servers

The auth middleware is designed to work with external OAuth2 authorization servers. Here are examples for popular providers:

### Auth0

```typescript
import { jwtVerify, createRemoteJWKSet } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL(`https://${AUTH0_DOMAIN}/.well-known/jwks.json`)
);

this.setupAuth({
  validateToken: async (token) => {
    try {
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: `https://${AUTH0_DOMAIN}/`,
        audience: AUTH0_AUDIENCE,
      });

      return {
        valid: true,
        scopes: payload.scope?.split(' ') || ['mcp'],
        claims: payload,
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Invalid token',
      };
    }
  },
  resourceUrl: 'https://api.example.com/mcp',
  authorizationServers: [`https://${AUTH0_DOMAIN}/`],
  scopesSupported: ['mcp', 'mcp:tools'],
});
```

### Keycloak

```typescript
this.setupAuth({
  validateToken: async (token) => {
    const response = await fetch(
      `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token/introspect`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
        },
        body: `token=${encodeURIComponent(token)}`,
      }
    );

    const data = await response.json();

    if (!data.active) {
      return { valid: false, error: 'Token is not active' };
    }

    return {
      valid: true,
      scopes: data.scope?.split(' ') || ['mcp'],
      claims: data,
    };
  },
  resourceUrl: 'https://api.example.com/mcp',
  authorizationServers: [`${KEYCLOAK_URL}/realms/${REALM}`],
});
```

## Testing

### Testing with curl

**Test PRM endpoint:**
```bash
curl https://api.example.com/.well-known/oauth-protected-resource
```

**Test without authentication:**
```bash
curl https://api.example.com/sse
# Should return 401 with WWW-Authenticate header
```

**Test with authentication:**
```bash
curl https://api.example.com/sse \
  -H "Authorization: Bearer your-valid-token"
```

### Unit Testing

See the test files in `src/auth/*.test.ts` for examples of testing the auth middleware:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createAuthMiddleware } from '@nullshot/mcp';

describe('Auth Middleware', () => {
  it('should allow valid tokens', async () => {
    const app = new Hono();
    app.use(createAuthMiddleware({
      validateToken: vi.fn().mockResolvedValue({ valid: true }),
      resourceUrl: 'https://example.com/mcp',
      authorizationServers: ['https://auth.example.com'],
    }));
    app.get('/test', (c) => c.json({ success: true }));

    const req = new Request('https://example.com/test', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(200);
  });
});
```

## Security Considerations

1. **Always use HTTPS**: Tokens should never be transmitted over unencrypted connections
2. **Validate token expiration**: Check `exp` claim in JWT tokens
3. **Validate token audience**: Ensure token is intended for your resource (`aud` claim)
4. **Validate token issuer**: Verify the token came from a trusted issuer (`iss` claim)
5. **Use strong signing algorithms**: Prefer RS256 or ES256 over HS256
6. **Rotate signing keys**: Implement key rotation in your auth server
7. **Scope enforcement**: Check scopes in your tool implementations, not just in auth middleware
8. **Rate limiting**: Implement rate limiting for token validation to prevent abuse
9. **Audit logging**: Log authentication attempts for security monitoring

## API Reference

### Functions

#### `createAuthMiddleware(config: AuthMiddlewareConfig)`

Creates Hono middleware for OAuth2 authentication.

#### `createPrmHandler(config: AuthMiddlewareConfig)`

Creates a handler for the Protected Resource Metadata endpoint.

#### `setupAuth(app: Hono, config: AuthMiddlewareConfig)`

Convenience function that sets up both the PRM endpoint and auth middleware.

#### `generateProtectedResourceMetadata(config: AuthMiddlewareConfig)`

Generates the PRM document from configuration.

#### `getAuthContext(c: Context)`

Retrieves the auth context from a Hono context.

### Types

- `AuthMiddlewareConfig`: Configuration interface
- `TokenValidationResult`: Token validation result interface
- `TokenValidator`: Token validator function type
- `ProtectedResourceMetadata`: PRM document interface
- `AuthContext`: Auth context stored in Hono context

## References

- [MCP Authorization Specification](https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/authorization/)
- [RFC 9728: OAuth 2.0 Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728)
- [RFC 6750: OAuth 2.0 Bearer Token Usage](https://datatracker.ietf.org/doc/html/rfc6750)
- [RFC 8414: OAuth 2.0 Authorization Server Metadata](https://datatracker.ietf.org/doc/html/rfc8414)
