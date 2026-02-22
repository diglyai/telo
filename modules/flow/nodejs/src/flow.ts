import type { ResourceContext } from "@telorun/sdk";

interface Flow {
  metadata: {
    name: string;
    description?: string;
  };
  steps: Array<{
    kind: string;
    metadata: { name: string; module: string };
    outputs?: Record<string, string>; // variable name to JSON path in result
    inputs?: Record<string, any>; // input parameters for the step
  }>;
}

class Flow {
  constructor(
    public readonly resource: any,
    public readonly ctx: ResourceContext,
  ) {}

  async init(): Promise<void> {
    for (const step of this.resource.steps) {
      if (step.invoke.kind) {
        this.ctx.registerManifest({
          ...step.invoke,
          metadata: {
            module: this.resource.metadata.module,
            ...step.invoke.metadata,
          },
        });
        step.invoke = { kind: step.invoke.kind, name: step.invoke.metadata.name };
      }
    }
    this.ctx.on(this.resource.trigger.event, async () => {
      // Trigger execution when the specified event occurs
      await this.executeSteps();
    });
  }

  private async executeSteps(): Promise<void> {
    const context: Record<string, any> = {};
    for (const step of this.resource.steps) {
      const { kind, name } = step.invoke;
      const result = await this.ctx.invoke(kind, name, context);
      if (result != null) {
        // Store result in context under the kind hierarchy + name path
        // e.g. kind="Console.ReadLine", name="ReadUsername"
        // → context.Console.ReadLine.ReadUsername = result
        const parts = kind.split(".");
        let cursor = context;
        for (const part of parts) {
          if (!cursor[part] || typeof cursor[part] !== "object") {
            cursor[part] = {};
          }
          cursor = cursor[part];
        }
        cursor[name] = result;
      }
    }
  }
}

export function register() {}

export function create(resource: any, ctx: ResourceContext) {
  return new Flow(resource, ctx);
}
