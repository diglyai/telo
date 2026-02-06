import type {
  ControllerContext,
  ResourceContext,
  RuntimeResource,
} from '@diglyai/sdk';

export function register(ctx: ControllerContext): void {}

class ConsoleWriteLineResource implements RuntimeResource {
  constructor(
    readonly ctx: ResourceContext,
    readonly kind: string,
    readonly metadata: {
      [key: string]: any;
      name: string;
      module: string;
      uri: string;
    },
    readonly text: string,
  ) {}

  invoke(input: any) {
    process.stdout.write(this.ctx.expandValue(this.text, input));
    process.stdout.write('\n');
  }
}

export async function create(
  resource: ConsoleWriteLineResource,
  ctx: ResourceContext,
): Promise<ConsoleWriteLineResource> {
  return new ConsoleWriteLineResource(
    ctx,
    resource.kind,
    resource.metadata,
    resource.text,
  );
}
