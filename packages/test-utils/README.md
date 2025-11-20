# @nullshot/test-utils

Testing utilities for nullshot projects.

## Installation

```bash
yarn add -D @nullshot/test-utils
```

## Usage

This package provides utilities for testing MCP applications, particularly in Cloudflare Worker environments.

### Available Utilities

- `WorkerSSEClientTransport`: A client transport for Server-Sent Events (SSE) in Worker environments (deprecated)
- `WorkerStreamableHTTPClientTransport`: A client transport for Streamable HTTP in Worker environments (recommended)
- `WorkerWebSocketClientTransport`: A client transport for WebSocket connections in Worker environments

### AJV Mocking for Cloudflare Workers

This package includes utilities for mocking AJV (Another JSON Schema Validator) in Cloudflare Workers testing environments to avoid compatibility issues.

#### Legacy Alias-Based Mocking (Default)

The traditional approach uses module aliasing to redirect `ajv` imports to a mock implementation:

```javascript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { createMcpWorkersConfig } from '@nullshot/test-utils/vitest/mcpWorkersConfig';

export default defineConfig({
  test: {
    ...createMcpWorkersConfig({
      includeAjvMock: true,
      useVitestModuleMock: false // Default behavior
    }).test
  }
});
```

#### Vitest Module Mocking (Recommended)

The newer approach leverages Vitest's built-in module mocking capabilities:

```javascript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { createMcpWorkersConfig } from '@nullshot/test-utils/vitest/mcpWorkersConfig';

export default defineConfig({
  test: {
    ...createMcpWorkersConfig({
      includeAjvMock: true,
      useVitestModuleMock: true
      // Uses default setup file: '@nullshot/test-utils/vitest/setup-ajv-mock'
    }).test
  }
});
```

Then use the provided setup file or create a custom one:

```typescript
// Custom vitest.setup.ts
import { vi } from 'vitest';
import { MockAjv } from '@nullshot/test-utils/vitest/ajv-mock';

// Mock AJV imports
vi.mock('ajv', () => ({
  default: MockAjv,
  Ajv: MockAjv,
  __esModule: true
}));

vi.mock('ajv/dist/ajv', () => ({
  default: MockAjv,
  Ajv: MockAjv,
  __esModule: true
}));
```

#### Using the AJV Mock Directly

You can also import and use the mock directly in your tests:

```typescript
import { MockAjv } from '@nullshot/test-utils/vitest/ajv-mock';

describe('My test', () => {
  it('should work with AJV mock', () => {
    const ajv = new MockAjv();
    const validate = ajv.compile({ type: 'string' });
    expect(validate('test')).toBe(true); // Always returns true for testing
  });
});
```

### Example

```typescript
import { WorkerStreamableHTTPClientTransport } from "@nullshot/test-utils";

// Set up test client
const transport = new WorkerStreamableHTTPClientTransport({
  endpoint: "https://your-worker.example.com/mcp",
});

// Use in tests
// ...
```

## License

MIT
