export function register(ctx) {}
class ConsoleWriteLineResource {
  ctx;
  kind;
  metadata;
  inputSchema;
  text;
  constructor(ctx, kind, metadata, inputSchema, text) {
    this.ctx = ctx;
    this.kind = kind;
    this.metadata = metadata;
    this.inputSchema = inputSchema;
    this.text = text;
  }
  invoke(input) {
    this.ctx.validateSchema(input, this.inputSchema);
    process.stdout.write(this.ctx.expandValue(this.text, input));
    process.stdout.write("\n");
  }
}
export async function create(resource, ctx) {
  return new ConsoleWriteLineResource(
    ctx,
    resource.kind,
    resource.metadata,
    resource.inputSchema,
    resource.text,
  );
}
