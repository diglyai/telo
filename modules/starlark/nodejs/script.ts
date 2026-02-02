import type {
  ModuleContext,
  ModuleCreateContext,
  ResourceInstance,
  RuntimeResource,
} from '@diglyai/sdk';
import Ajv, { ErrorObject, ValidateFunction } from 'ajv';
import { initialize } from 'starlark-webasm';

declare global {
  var run_starlark_code: (code: string, context?: Record<string, any>) => any;
}


type StarlarkScriptResource = RuntimeResource & {
  code?: string;
  inputSchema?: Record<string, any>;
  outputSchema?: Record<string, any>;
};

let initialized = false;
const ajv = new Ajv({ allErrors: true, strict: false });
const inputValidators = new Map<string, ValidateFunction>();
const outputValidators = new Map<string, ValidateFunction>();
const compiledScripts = new Map<string, string>();

export async function register(_ctx: ModuleContext): Promise<void> {
  if (!initialized) {
    await initialize();
    initialized = true;
  }
}

class StarlarkScript implements ResourceInstance {
  private name: string;
  private code: string;
  private inputSchema?: Record<string, any>;
  private outputSchema?: Record<string, any>;

  constructor(resource: StarlarkScriptResource) {
    this.name = resource.metadata.name;
    this.code = resource.code || '';
    this.inputSchema = resource.inputSchema;
    this.outputSchema = resource.outputSchema;
  }

  async init(): Promise<void> {
    // Starlark code is compiled on-demand during execution
    compiledScripts.set(this.name, this.code);
  }

  async teardown(): Promise<void> {
    compiledScripts.delete(this.name);
    inputValidators.delete(`${this.name}:input`);
    outputValidators.delete(`${this.name}:output`);
  }
}

export async function create(
  resource: StarlarkScriptResource,
  _ctx: ModuleCreateContext,
): Promise<ResourceInstance> {
  const name = resource.metadata.name;
  if (!resource.code) {
    throw new Error(`StarlarkScript "${name}" is missing code`);
  }

  const instance = new StarlarkScript(resource);
  await instance.init();
  return instance;
}

export async function execute(
  name: string,
  input: any,
  ctx: { resource?: StarlarkScriptResource },
): Promise<any> {
  const resource = ctx?.resource;
  if (!resource || resource.kind !== 'Starlark.Script') {
    throw new Error(`StarlarkScript not found: ${name}`);
  }

  if (!resource.code) {
    throw new Error(`StarlarkScript "${name}" is missing code`);
  }

  // Validate input
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

  // Execute Starlark code with input as context
  const starlarkCode = buildStarlarkExecution(resource.code, input);
  const result = await executeStarlark(starlarkCode, input);

  // Validate output
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

function buildStarlarkExecution(code: string, _input: any): string {
  // Wrap the user code and ensure main() function is called
  // The input will be made available as a global variable
  return (
    `\ndef __execute():\n` +
    code
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n') +
    `\n  if "main" in dir():\n` +
    `    return main(input)\n` +
    `  else:\n` +
    `    return None\n\n` +
    `__result = __execute()`
  );
}

async function executeStarlark(code: string, input: any): Promise<any> {
  try {
    const starlarkContext = {
      input,
    };

    // Execute the Starlark code
    // @ts-ignore
    const result = globalThis.run_starlark_code(code, starlarkContext);

    // Extract the result
    if (result && typeof result === 'object' && '__result' in result) {
      return result['__result'];
    }

    return result;
  } catch (error) {
    throw new Error(
      `StarlarkScript execution failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
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
