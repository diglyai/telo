import type { ResourceContext } from "@vokerun/sdk";

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
      if (step.invoke.kind && !step.invoke.name) {
        const name = "Unnamed";
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
    this.ctx.on(this.resource.trigger.event, async () => {
      // Trigger execution when the specified event occurs
      await this.executeSteps();
    });
  }

  private async executeSteps(): Promise<void> {
    const context: any = {};
    for (const step of this.resource.steps) {
      try {
        const id =
          typeof step.invoke === "string" ? step.invoke : `${step.invoke.kind}.${step.invoke.name}`;
        const [module, kind, name] = id.split(".");
        const result = await this.ctx.invoke(
          `${module}.${kind}`,
          name,
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
  return new Flow(resource, ctx);
}
