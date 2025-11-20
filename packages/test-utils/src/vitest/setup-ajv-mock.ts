/**
 * Vitest setup file for AJV module mocking
 * This file configures Vitest to properly mock AJV imports using vi.mock()
 */

import { vi } from 'vitest';
import { MockAjv } from './ajv-mock.js';

// Mock the main AJV import
vi.mock('ajv', () => {
  return {
    default: MockAjv,
    __esModule: true,
  };
});

// Mock the AJV distribution import
vi.mock('ajv/dist/ajv', () => {
  return {
    default: MockAjv,
    __esModule: true,
  };
});

// Export the mock for potential reuse
export { MockAjv };