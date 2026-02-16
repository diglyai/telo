import type { ResourceContext } from "@citorun/sdk";
import { Static, Type } from "@sinclair/typebox";

export const schema = Type.Object({
  metadata: Type.Record(Type.String(), Type.String()),
  steps: Type.Array(
    Type.Object({
      name: Type.String(),
      invoke: Type.Object({
        kind: Type.String(),
        name: Type.Optional(Type.String()),
        metadata: Type.Optional(Type.Record(Type.String(), Type.String())),
      }),
      output: Type.Optional(Type.Record(Type.String(), Type.Any())),
      input: Type.Record(Type.String(), Type.Any()),
    }),
  ),
});
type PipelineJobManifest = Static<typeof schema>;

class PipelineJob {
  constructor(
    private ctx: ResourceContext,
    public resource: PipelineJobManifest,
  ) {}

  async init() {
    for (const step of this.resource.steps) {
      if (step.invoke.kind && !step.invoke.name) {
        const name = step.name ?? "Unnamed";
        this.ctx.registerManifest({
          ...step.invoke,
          metadata: {
            name,
            module: this.resource.metadata.module,
            ...step.invoke.metadata,
          },
        });
        step.invoke = { kind: step.invoke.kind, name };
      }
    }
  }

  async run() {
    await this.executeSteps();
  }

  private async executeSteps(): Promise<void> {
    const context: any = {};
    for (const step of this.resource.steps) {
      try {
        const result = await this.ctx.invoke(
          step.invoke.kind,
          step.invoke.name ?? step.name,
          this.ctx.expandValue(step.input || {}, context),
        );
        context[step.name] = {
          output: result,
        };
      } catch (error) {
        throw error;
      }
    }
  }
}

export function register() {}

export function create(resource: any, ctx: ResourceContext) {
  return new PipelineJob(ctx, resource);
}
