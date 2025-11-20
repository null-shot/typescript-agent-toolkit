/**
 * Simple ajv mock to avoid compatibility issues in Cloudflare Workers environment
 * This mock always passes validation for testing purposes
 */

// Mock type definitions to match AJV's API
export type JSONSchemaType<T> = any;
export type DefinedError = any;
export type ErrorObject = {
  keyword: string;
  instancePath: string;
  schemaPath: string;
  params: Record<string, any>;
  message?: string;
  propertyName?: string;
  schema?: any;
  parentSchema?: any;
  data?: any;
};
export type FormatDefinition = {
  validate: string | RegExp | ((data: string | number) => boolean | Promise<boolean>);
  compare?: (data1: string, data2: string) => number;
  async?: boolean;
  type?: string;
};
export type Format = boolean | string | RegExp | ((data: string) => boolean) | FormatDefinition;
export type KeywordDefinition = {
  keyword: string;
  type?: string | string[];
  schemaType?: string | string[];
  code?: Function;
  validate?: Function;
  compile?: Function;
  macro?: Function;
  error?: any;
  schema?: boolean;
  metaSchema?: any;
  dependencies?: string[];
  implements?: string[];
  modifying?: boolean;
  valid?: boolean;
  $data?: boolean;
  $dataError?: any;
  async?: boolean;
  errors?: boolean | 'full';
};

/**
 * Mock implementation of ajv that always passes validation
 * This prevents CommonJS/JSON parsing issues in Cloudflare Workers test environment
 */
export class MockAjv {
  options: any;
  errors: ErrorObject[] | null = null;

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

  addFormat(name: string, format: Format) {
    return this;
  }

  addKeyword(keyword: string, definition: KeywordDefinition) {
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

  addVocabulary(vocabulary: string[]) {
    return this;
  }

  // Additional methods that might be used
  compileAsync(schema: any) {
    const validate = async (data: any) => {
      return true; // Always pass validation for testing
    };
    (validate as any).errors = null;
    return validate;
  }

  addVocabularyKeywords(keywords: string[]) {
    return this;
  }

  // JTD methods
  compileSerializer(schema: any) {
    return (data: any) => JSON.stringify(data);
  }

  compileParser(schema: any) {
    const parse = (json: string) => {
      try {
        return JSON.parse(json);
      } catch {
        return undefined;
      }
    };
    (parse as any).message = null;
    (parse as any).position = 0;
    return parse;
  }
}

// Default export for ES modules
// Also export as named exports to match AJV's API
export { MockAjv as Ajv };
export default MockAjv;
