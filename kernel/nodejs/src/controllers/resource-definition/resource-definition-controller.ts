import type {
  ControllerContext,
  ResourceContext,
  ResourceInstance,
  RuntimeResource,
} from "@telorun/sdk";
import { ControllerLoader } from "../../controller-loader.js";
import { formatAjvErrors, validateResourceDefinition } from "../../manifest-schemas.js";
import { createTemplateController } from "./resource-template-controller.js";

type ResourceDefinitionResource = RuntimeResource & {
  kind: "Definition";
  metadata: {
    [key: string]: any;
    name: string;
    module?: string;
  };
  schema: Record<string, any>;
  capabilities: string[];
  events?: string[];
  controllers?: Array<string>;
  resources?: any[];
  invoke?: string;
  run?: string;
};

/**
 * ResourceDefinition resource - acts as metadata holder for resource type definitions
 * Validates incoming definitions against schema and maintains definition metadata
 *
 * When `controllers` is absent or empty the definition acts as a pure template:
 * the kernel registers a built-in template controller that expands the definition's
 * `resources` array per-instance and delegates lifecycle calls to the designated child.
 */
class ResourceDefinition implements ResourceInstance {
  readonly kind: "ResourceDefinition" = "ResourceDefinition";

  constructor(
    readonly resource: ResourceDefinitionResource,
    private controllerLoader: ControllerLoader,
  ) {}

  async init(ctx: ResourceContext) {
    for (const cap of this.resource.capabilities) {
      if (!ctx.isCapabilityRegistered(cap)) {
        throw new Error(
          `Capability "${cap}" is not registered. Declare it as a Kernel.Capability resource.`,
        );
      }
      await ctx.getCapabilityDefinition(cap)?.onDefinition?.(this.resource as any, ctx);
    }

    const hasControllers = this.resource.controllers && this.resource.controllers.length > 0;

    if (!hasControllers) {
      // No controllers declared — register a built-in template controller that
      // bundles private child resources and delegates lifecycle calls to them.
      ctx.emit("TemplateDefinitionRegistered", {
        resources: this.resource.resources?.length ?? 0,
        invoke: this.resource.invoke,
      });
      ctx.registerDefinition(this.resource);
      await ctx.registerController(
        this.resource.metadata.module,
        this.resource.metadata.name,
        createTemplateController(this.resource),
      );
      return;
    }

    ctx.emit("ControllerLoading", { controllers: this.resource.controllers });
    try {
      const controllerInstance = await this.controllerLoader.load(
        this.resource.controllers!,
        this.resource.metadata.source,
      );
      ctx.emit("ControllerLoaded", { schema: controllerInstance.schema });
      ctx.registerDefinition(this.resource);
      await ctx.registerController(
        this.resource.metadata.module,
        this.resource.metadata.name,
        controllerInstance,
      );
    } catch (err) {
      ctx.emit("ControllerLoadFailed", { error: (err as Error).message });
      throw err;
    }
  }
}

export function register(ctx: ControllerContext): void {
  // ResourceDefinition is a passive resource - no registration needed
}

export async function create(resource: any, ctx: ResourceContext): Promise<ResourceDefinition> {
  // Validate incoming resource definition against schema
  if (!validateResourceDefinition(resource)) {
    throw new Error(
      `Invalid ResourceDefinition "${resource.metadata.name}": ${formatAjvErrors(validateResourceDefinition.errors)}`,
    );
  }

  // Return a fully-formed ResourceDefinition instance
  const definition = resource as ResourceDefinitionResource;
  return new ResourceDefinition(definition, new ControllerLoader());
}

export const schema = {
  type: "object",
  additionalProperties: true,
};
