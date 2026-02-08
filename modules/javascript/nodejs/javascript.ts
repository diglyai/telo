import type {
  ControllerContext,
  DataValidator,
  ResourceContext,
  RuntimeResource,
} from '@diglyai/sdk';

type JavaScriptResource = RuntimeResource & {
  code?: string;
  inputSchema?: Record<string, any>;
  outputSchema?: Record<string, any>;
};

export function register(ctx: ControllerContext): void {}

class JavaScript {
  constructor(
    readonly ctx: ResourceContext,
    readonly inputValidator: DataValidator,
    readonly outputValidator: DataValidator,
    readonly compiled: (input: any, context: any) => Promise<void>,
  ) {}

  async invoke(input: any) {
    this.inputValidator(input);
    const output = await this.compiled(input, {});
    this.outputValidator(output);
    return output;
  }
}

export async function create(
  resource: JavaScriptResource,
  ctx: ResourceContext,
): Promise<JavaScript> {
  const name = resource.metadata.name;
  if (!resource.code) {
    throw new Error(`JavaScript "${name}" is missing code`);
  }
  const compiled = compileJavaScriptModule(resource.code);
  return new JavaScript(
    ctx,
    ctx.createSchemaValidator(resource.inputSchema),
    ctx.createSchemaValidator(resource.outputSchema),
    compiled,
  );
}

function compileJavaScriptModule(
  code: string,
): (input: any, ctx: any) => Promise<any> {
  const wrapped =
    `"use strict";\n${code}\n` +
    `if (typeof main !== "function") { throw new Error("JavaScript resource must export main(input)"); }\n` +
    `return main(input);`;
  const fn = new Function('input', wrapped) as (
    input: any,
    ctx: any,
  ) => Promise<any>;
  return fn;
}
