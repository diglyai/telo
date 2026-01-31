import type {
  ModuleContext,
  ModuleCreateContext,
  ResourceInstance,
  RuntimeResource,
} from '@diglyai/sdk';
import Ajv, { ErrorObject, ValidateFunction } from 'ajv';

type JavaScriptResource = RuntimeResource & {
  code?: string;
  inputSchema?: Record<string, any>;
  outputSchema?: Record<string, any>;
};

const ajv = new Ajv({ allErrors: true, strict: false });
const inputValidators = new Map<string, ValidateFunction>();
const outputValidators = new Map<string, ValidateFunction>();
const compiledModules = new Map<
  string,
  (input: any, ctx: any) => Promise<any>
>();

export function register(_ctx: ModuleContext): void {}

export async function create(
  resource: JavaScriptResource,
  _ctx: ModuleCreateContext,
): Promise<ResourceInstance> {
  const name = resource.metadata.name;
  if (!resource.code) {
    throw new Error(`JavaScript "${name}" is missing code`);
  }
  const compiled = compileJavaScriptModule(resource.code);
  compiledModules.set(name, compiled);
  return {
    teardown: () => {
      compiledModules.delete(name);
    },
  };
}

export async function execute(
  name: string,
  input: any,
  ctx: { resource?: JavaScriptResource },
): Promise<any> {
  const resource = ctx?.resource;
  if (!resource || resource.kind !== 'Logic.JavaScript') {
    throw new Error(`JavaScript not found: ${name}`);
  }

  if (!resource.code) {
    throw new Error(`JavaScript "${name}" is missing code`);
  }

  if (resource.inputSchema) {
    const validateInput = getValidator(
      inputValidators,
      `${name}:input`,
      resource.inputSchema,
    );
    if (!validateInput(input)) {
      throw new Error(formatAjvErrors(validateInput.errors));
    }
  }

  const fn =
    compiledModules.get(name) ?? getCompiledModule(name, resource.code);
  const result = await fn(input, ctx);

  if (resource.outputSchema) {
    const validateOutput = getValidator(
      outputValidators,
      `${name}:output`,
      resource.outputSchema,
    );
    if (!validateOutput(result)) {
      throw new Error(formatAjvErrors(validateOutput.errors));
    }
  }

  return result;
}

function compileJavaScriptModule(
  code: string,
): (input: any, ctx: any) => Promise<any> {
  const wrapped =
    `"use strict";\n${code}\n` +
    `if (typeof main !== "function") { throw new Error("JavaScript resource must export main(input, ctx)"); }\n` +
    `return main(input, ctx);`;
  const fn = new Function('input', 'ctx', wrapped) as (
    input: any,
    ctx: any,
  ) => Promise<any>;
  return fn;
}

function getCompiledModule(
  name: string,
  code: string,
): (input: any, ctx: any) => Promise<any> {
  const existing = compiledModules.get(name);
  if (existing) {
    return existing;
  }
  const compiled = compileJavaScriptModule(code);
  compiledModules.set(name, compiled);
  return compiled;
}

function getValidator(
  cache: Map<string, ValidateFunction>,
  key: string,
  schema: Record<string, any>,
): ValidateFunction {
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }
  const compiled = ajv.compile(schema);
  cache.set(key, compiled);
  return compiled;
}

function formatAjvErrors(errors?: ErrorObject[] | null): string {
  if (!errors || errors.length === 0) {
    return 'Validation failed';
  }
  return errors
    .map((err) => {
      const path =
        err.instancePath && err.instancePath.length > 0
          ? err.instancePath
          : '/';
      const message = err.message || 'is invalid';
      return `${path} ${message}`;
    })
    .join('; ');
}
