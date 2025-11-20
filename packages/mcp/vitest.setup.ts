/**
 * Vitest setup file for AJV module mocking in MCP tests
 * This file configures Vitest to properly mock AJV imports using vi.mock()
 */

import { vi } from 'vitest';

// Mock the main AJV import
vi.mock('ajv', async () => {
  const { MockAjv } = await import('@nullshot/test-utils/vitest/ajv-mock');
  return {
    default: MockAjv,
    Ajv: MockAjv,
    __esModule: true,
  };
});

// Mock the AJV distribution import
vi.mock('ajv/dist/ajv', async () => {
  const { MockAjv } = await import('@nullshot/test-utils/vitest/ajv-mock');
  return {
    default: MockAjv,
    Ajv: MockAjv,
    __esModule: true,
  };
});

export {};