# Auth MCP Server Example

This example demonstrates how to implement OAuth2 bearer token authentication for an MCP server using the `@nullshot/mcp` package.

## Features

- **OAuth2 Bearer Token Authentication**: Protects MCP endpoints with JWT token validation
- **Protected Resource Metadata (PRM)**: Serves OAuth2 metadata at `.well-known/oauth-protected-resource`
- **WWW-Authenticate Headers**: Returns proper 401 responses with PRM URLs
- **Flexible Token Validation**: Supports any token validation logic via callback function

## Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   MCP Client    │ ──────► │   MCP Server     │ ◄────── │   Auth Server    │
│                 │         │   (this example) │         │   (external)     │
└─────────────────┘         └──────────────────┘         └─────────────────┘
       │                           │
       │ 1. Initial request         │
       │ (no token)                 │
       │◄───────────────────────────┤
       │ 401 + PRM URL              │
       │                            │
       │ 2. Fetch PRM               │
       │◄───────────────────────────┤
       │ PRM document               │
       │                            │
       │ 3. Get token from auth     │
       │    server (OAuth2 flow)    │
       │                            │
       │ 4. Request with token      │
       │◄───────────────────────────┤
       │ 200 + data                 │
```

## Setup

1. Install dependencies:
```bash
pnpm install
```

2. Configure your auth server in `src/server.ts`:
```typescript
this.setupAuth({
  validateToken: async (token) => {
    // Implement your token validation logic here
    // Example: Use jose library to verify JWT
    const { payload } = await jwtVerify(token, publicKey);
    return {
      valid: true,
      scopes: payload.scope?.split(' ') || ['mcp'],
      claims: payload
    };
  },
  resourceUrl: 'https://your-server.com/mcp',
  authorizationServers: ['https://auth.your-server.com'],
  scopesSupported: ['mcp', 'mcp:tools', 'mcp:resources'],
});
```

3. Deploy to Cloudflare Workers:
```bash
wrangler deploy
```

## Testing

### Test PRM Endpoint (No Auth Required)

```bash
curl https://your-server.com/.well-known/oauth-protected-resource
```

Expected response:
```json
{
  "resource": "https://your-server.com/mcp",
  "authorization_servers": ["https://auth.your-server.com"],
  "scopes_supported": ["mcp", "mcp:tools", "mcp:resources"],
  "bearer_methods_supported": ["header"]
}
```

### Test Without Authentication

```bash
curl https://your-server.com/sse
```

Expected response:
```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="mcp", 
  resource_metadata="https://your-server.com/.well-known/oauth-protected-resource",
  error="invalid_token",
  error_description="Missing or malformed Authorization header"

{"error":"invalid_token","error_description":"Missing or malformed Authorization header"}
```

### Test With Authentication

```bash
curl https://your-server.com/sse \
  -H "Authorization: Bearer your-valid-token"
```

Expected response: SSE stream connection established

## Configuration Options

### AuthMiddlewareConfig

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `validateToken` | `(token: string) => Promise<TokenValidationResult>` | Yes | Function to validate bearer tokens |
| `resourceUrl` | `string` | Yes | URL identifying this MCP server |
| `authorizationServers` | `string[]` | Yes | OAuth2 authorization server URLs |
| `scopesSupported` | `string[]` | No | Supported OAuth2 scopes (default: `["mcp"]` |
| `excludedPaths` | `string[]` | No | Paths that don't require authentication |
| `prmPath` | `string` | No | PRM endpoint path (default: `.well-known/oauth-protected-resource` |
| `realm` | `string` | No | WWW-Authenticate realm (default: `"mcp"` |

### TokenValidationResult

```typescript
{
  valid: boolean;           // Whether the token is valid
  scopes?: string[];        // Granted scopes
  error?: string;           // Error message if invalid
  claims?: Record<string,   // Additional token claims
             unknown>;      // (e.g., sub, iss, aud)
}
```

## Integration with External Auth Servers

This example is designed to work with external OAuth2 authorization servers such as:

- **Auth0**: Use JWT validation with Auth0's public keys
- **Keycloak**: Validate tokens against Keycloak's token introspection endpoint
- **AWS Cognito**: Use Cognito's JWKS endpoint for validation
- **Custom Auth Server**: Implement your own token validation logic

### Example: Auth0 Integration

```typescript
import { jwtVerify, createRemoteJWKSet } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL('https://your-domain.auth0.com/.well-known/jwks.json')
);

this.setupAuth({
  validateToken: async (token) => {
    try {
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: 'https://your-domain.auth0.com/',
        audience: 'your-api-identifier',
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
  resourceUrl: 'https://your-server.com/mcp',
  authorizationServers: ['https://your-domain.auth0.com/'],
  scopesSupported: ['mcp', 'mcp:tools'],
});
```

## Security Considerations

1. **Always use HTTPS**: Tokens should never be transmitted over unencrypted connections
2. **Validate token expiration**: Check `exp` claim in JWT tokens
3. **Validate token audience**: Ensure token is intended for your resource
4. **Use strong signing algorithms**: Prefer RS256 or ES256 over HS256
5. **Rotate signing keys**: Implement key rotation in your auth server
6. **Scope enforcement**: Check scopes in your tool implementations

## Learn More

- [MCP Authorization Flow](https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/authorization/)
- [OAuth 2.0 Protected Resource Metadata (RFC 9728)](https://datatracker.ietf.org/doc/html/rfc9728)
- [OAuth 2.0 Bearer Token Usage (RFC 6750)](https://datatracker.ietf.org/doc/html/rfc6750)
