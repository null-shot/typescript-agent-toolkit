/**
 * Simple ajv mock to avoid compatibility issues in Cloudflare Workers environment
 * This mock always passes validation for testing purposes
 */

/**
 * Mock implementation of ajv that always passes validation
 * This prevents CommonJS/JSON parsing issues in Cloudflare Workers test environment
 */
export class MockAjv {
  options: any;

  constructor(options: any = {}) {
    this.options = options;
  }

  compile(schema: any) {
    const validate = (data: any) => {
      return true; // Always pass validation for testing
    };
    (validate as any).errors = null;
    return validate;
  }

  addFormat(name: string, format: any) {
    return this;
  }

  addKeyword(keyword: string, definition: any) {
    return this;
  }

  addSchema(schema: any, key?: string) {
    return this;
  }

  getSchema(keyRef: string) {
    const validate = (data: any) => {
      return true;
    };
    (validate as any).errors = null;
    return validate;
  }

  validate(schema: any, data: any) {
    return true;
  }

  removeKeyword(keyword: string) {
    return this;
  }

  removeSchema(schemaKeyRef?: string) {
    return this;
  }

  addMetaSchema(schema: any, key?: string) {
    return this;
  }

  validateSchema(schema: any) {
    return true;
  }

  getKeyword(keyword: string) {
    return undefined;
  }

  removeFormat(format: string) {
    return this;
  }

  addVocabulary(vocabulary: any) {
    return this;
  }
}

// Default export for ES modules
export default MockAjv;

// Export mock codegen for ajv-formats compatibility
export const codegen = {
  _: () => "",
  str: () => "",
  nil: () => "",
  Name: class {
    constructor(public str: string) {}
  },
  Code: class {
    constructor(public code: string) {}
  },
};
