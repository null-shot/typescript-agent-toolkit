import { describe, it, expect } from 'vitest';
import { MockAjv, Ajv } from './ajv-mock.js';
import MockDefault from './ajv-mock.js';

describe('AJV Mock', () => {
  it('should create an instance of MockAjv', () => {
    const ajv = new MockAjv();
    expect(ajv).toBeInstanceOf(MockAjv);
  });

  it('should have compile method that returns a function', () => {
    const ajv = new MockAjv();
    const validate = ajv.compile({});
    expect(typeof validate).toBe('function');
  });

  it('should have validate method that returns true', () => {
    const ajv = new MockAjv();
    const result = ajv.validate({}, {});
    expect(result).toBe(true);
  });

  it('should have all expected methods', () => {
    const ajv = new MockAjv();
    expect(typeof ajv.addFormat).toBe('function');
    expect(typeof ajv.addKeyword).toBe('function');
    expect(typeof ajv.addSchema).toBe('function');
    expect(typeof ajv.getSchema).toBe('function');
    expect(typeof ajv.removeKeyword).toBe('function');
    expect(typeof ajv.removeSchema).toBe('function');
    expect(typeof ajv.addMetaSchema).toBe('function');
    expect(typeof ajv.validateSchema).toBe('function');
    expect(typeof ajv.getKeyword).toBe('function');
    expect(typeof ajv.removeFormat).toBe('function');
    expect(typeof ajv.addVocabulary).toBe('function');
  });

  it('should support named export Ajv', () => {
    const ajv = new Ajv();
    expect(ajv).toBeInstanceOf(MockAjv);
  });

  it('should support default export', () => {
    const ajv = new MockDefault();
    expect(ajv).toBeInstanceOf(MockAjv);
  });

  it('should support method chaining', () => {
    const ajv = new MockAjv();
    const result = ajv.addFormat('test', true).addKeyword('test', { keyword: 'test' });
    expect(result).toBe(ajv);
  });

  it('should return validation function with errors property', () => {
    const ajv = new MockAjv();
    const validate = ajv.compile({});
    expect(validate({})).toBe(true);
    expect((validate as any).errors).toBe(null);
  });
});