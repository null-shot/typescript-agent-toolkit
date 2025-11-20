/**
 * Example test file demonstrating how to use the AJV mock with Vitest
 */

import { describe, it, expect } from 'vitest';

// Example of using the mock directly
import { MockAjv } from './ajv-mock.js';

describe('AJV Mock Example', () => {
  it('should demonstrate direct usage of the mock', () => {
    const ajv = new MockAjv();
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' }
      }
    };
    
    const validate = ajv.compile(schema);
    const data = { name: 'John', age: 30 };
    
    // Validation always passes in the mock
    expect(validate(data)).toBe(true);
    expect((validate as any).errors).toBe(null);
  });
});

// Example of using Vitest's module mocking (this would be in a separate test file)
/*
describe('AJV Module Mocking Example', () => {
  // This would be in a setup file or at the top of your test file
  vi.mock('ajv', async () => {
    const { MockAjv } = await import('./ajv-mock.js');
    return {
      default: MockAjv,
      Ajv: MockAjv,
      __esModule: true
    };
  });

  it('should mock AJV imports', async () => {
    // This import will be mocked
    const Ajv = (await import('ajv')).default;
    const ajv = new Ajv();
    
    const schema = { type: 'string' };
    const validate = ajv.compile(schema);
    
    expect(validate('test')).toBe(true);
  });
});
*/