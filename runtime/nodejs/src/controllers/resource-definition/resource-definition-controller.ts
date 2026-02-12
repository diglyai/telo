import type {
  ControllerContext,
  ResourceContext,
  RuntimeResource,
} from '@diglyai/sdk';
import * as path from 'path';
import {
  formatAjvErrors,
  validateResourceDefinition,
} from '../../manifest-schemas';
import type { ResourceDefinition as IResourceDefinition } from '../../types';

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
class ResourceDefinition implements RuntimeResource, IResourceDefinition {
  readonly kind: 'ResourceDefinition' = 'ResourceDefinition';

  constructor(
    readonly metadata: {
      name: string;
      resourceKind: string;
      module: string;
      [key: string]: any;
    },
    readonly schema: Record<string, any>,
    readonly events?: string[],
    readonly controllers?: Array<{
      runtime: string;
      entry: string;
    }>,
  ) {}

  async init(ctx: ResourceContext) {
    // Load first controller for now
    const controller = this.controllers?.[0];
    if (controller) {
      // Dynamically import controller module and register it
      const controllerInstance = await import(
        path.resolve(path.dirname(this.metadata.source), controller.entry)
      );
      if (
        !controllerInstance ||
        (!controllerInstance.create && !controllerInstance.register)
      ) {
        throw new Error(
          `Invalid controller module for ResourceDefinition "${this.metadata.name}": missing create or register function`,
        );
      }

      await ctx.registerController(
        this.metadata.module,
        this.metadata.resourceKind,
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
  return new ResourceDefinition(
    definition.metadata,
    definition.schema,
    definition.events,
    definition.controllers,
  );
}
