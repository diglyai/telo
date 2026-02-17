import type { ControllerContext, RuntimeResource } from "@telorun/sdk";
import type { ErrorObject, ValidateFunction } from "ajv";
import { Ajv } from "ajv";

type InlineFunctionResource = RuntimeResource & {
  code?: string;
  inputSchema?: Record<string, any>;
  outputSchema?: Record<string, any>;
};

const ajv = new Ajv({ allErrors: true, strict: false });
const inputValidators = new Map<string, ValidateFunction>();
const outputValidators = new Map<string, ValidateFunction>();

export function register(ctx: ControllerContext): void {}

export async function execute(
  name: string,
  input: any,
  ctx: { resource?: InlineFunctionResource },
): Promise<any> {
  const resource = ctx?.resource;
  if (!resource || resource.kind !== "Logic.InlineFunction") {
    throw new Error(`InlineFunction not found: ${name}`);
  }

  if (!resource.code) {
    throw new Error(`InlineFunction "${name}" is missing code`);
  }

  if (resource.inputSchema) {
    const validateInput = getValidator(inputValidators, `${name}:input`, resource.inputSchema);
    if (!validateInput(input)) {
      throw new Error(formatAjvErrors(validateInput.errors));
    }
  }

  const fn = compileLogic(resource.code);
  const result = await fn(input, ctx);

  if (resource.outputSchema) {
    const validateOutput = getValidator(outputValidators, `${name}:output`, resource.outputSchema);
    if (!validateOutput(result)) {
      throw new Error(formatAjvErrors(validateOutput.errors));
    }
  }

  return result;
}

function compileLogic(code: string): (input: any, ctx: any) => Promise<any> {
  const wrapped = `"use strict";\nreturn (async () => {\n${code}\n})();`;
  const fn = new Function("input", "ctx", wrapped) as (input: any, ctx: any) => Promise<any>;
  return fn;
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
    return "Validation failed";
  }
  return errors
    .map((err) => {
      const path = err.instancePath && err.instancePath.length > 0 ? err.instancePath : "/";
      const message = err.message || "is invalid";
      return `${path} ${message}`;
    })
    .join("; ");
}
