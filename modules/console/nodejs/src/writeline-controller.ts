import type {
    ControllerContext,
    ResourceContext,
    ResourceInstance,
    ResourceManifest,
} from "@vokerun/sdk";

export function register(ctx: ControllerContext): void {}

class ConsoleWriteLineResource implements ResourceInstance {
  constructor(
    readonly ctx: ResourceContext,
    readonly kind: string,
    readonly metadata: {
      [key: string]: any;
      name: string;
      module: string;
    },
    readonly inputSchema: any,
    readonly output: string,
  ) {}

  invoke(input: any) {
    this.ctx.validateSchema(input, this.inputSchema);
    process.stdout.write(this.ctx.expandValue(this.output, input));
    process.stdout.write("\n");
  }
}

export async function create(
  resource: ResourceManifest,
  ctx: ResourceContext,
): Promise<ConsoleWriteLineResource> {
  return new ConsoleWriteLineResource(
    ctx,
    resource.kind,
    resource.metadata,
    resource.inputSchema,
    resource.output,
  );
}
