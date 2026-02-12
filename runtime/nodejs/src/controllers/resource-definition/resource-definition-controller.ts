import type {
  ControllerContext,
  ResourceContext,
  ResourceInstance,
  RuntimeResource,
} from '@diglyai/sdk';
import * as path from 'path';
import {
  formatAjvErrors,
  validateResourceDefinition,
} from '../../manifest-schemas';

type ResourceDefinitionResource = RuntimeResource & {
  kind: 'Definition';
  metadata: {
    [key: string]: any;
    name: string;
    resourceKind: string;
    module?: string;
  };
  schema: Record<string, any>;
  events?: string[];
  controllers?: Array<{
    runtime: string;
    entry: string;
  }>;
};

/**
 * ResourceDefinition resource - acts as metadata holder for resource type definitions
 * Validates incoming definitions against schema and maintains definition metadata
 */
class ResourceDefinition implements ResourceInstance {
  readonly kind: 'ResourceDefinition' = 'ResourceDefinition';

  constructor(readonly resource: ResourceDefinitionResource) {}

  async init(ctx: ResourceContext) {
    // Load first controller for now
    const controller = this.resource.controllers?.[0];
    if (controller) {
      // Dynamically import controller module and register it
      const controllerInstance = await import(
        path.resolve(
          path.dirname(this.resource.metadata.source),
          controller.entry,
        )
      );
      if (
        !controllerInstance ||
        (!controllerInstance.create && !controllerInstance.register)
      ) {
        throw new Error(
          `Invalid controller module for ResourceDefinition "${this.resource.metadata.name}": missing create or register function`,
        );
      }
      ctx.registerDefinition(this.resource);
      await ctx.registerController(
        this.resource.metadata.module,
        this.resource.metadata.resourceKind,
        controllerInstance,
      );
    }
  }
}

export function register(ctx: ControllerContext): void {
  // ResourceDefinition is a passive resource - no registration needed
}

export async function create(
  resource: any,
  ctx: ResourceContext,
): Promise<ResourceDefinition> {
  // Validate incoming resource definition against schema
  if (!validateResourceDefinition(resource)) {
    throw new Error(
      `Invalid ResourceDefinition "${resource.metadata.name}": ${formatAjvErrors(validateResourceDefinition.errors)}`,
    );
  }

  // Return a fully-formed ResourceDefinition instance
  const definition = resource as ResourceDefinitionResource;
  return new ResourceDefinition(definition);
}

export const schema = {
  type: 'object',
  additionalProperties: true,
};
