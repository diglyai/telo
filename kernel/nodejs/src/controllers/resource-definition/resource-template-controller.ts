import type { ControllerInstance, ResourceContext, ResourceInstance, ResourceManifest } from "@telorun/sdk";

/**
 * Creates a synthetic controller for "no-code" template resource definitions.
 *
 * When a Kernel.Definition declares a `resources` array instead of `controllers`,
 * this factory produces a controller that:
 *   1. Expands the definition's `resources` templates per-instance, substituting
 *      `self.*` with the concrete instance manifest fields.
 *   2. Initializes the expanded child resources in a private child context so they
 *      are invisible to the outer module (no namespace pollution).
 *   3. Delegates `invoke()` to the child resource named by the definition's `invoke`
 *      field (expanded with the same `self` context).
 *
 * From the outside this behaves identically to a regular controller-backed resource.
 *
 * Example definition:
 *
 *   kind: Kernel.Definition
 *   metadata:
 *     name: Orm
 *     module: App
 *   capabilities: [handler]
 *   schema:
 *     type: object
 *     properties:
 *       driver: { type: string }
 *       sql:    { type: string }
 *   resources:
 *     - kind: Sql.Connection
 *       metadata:
 *         name: "${{ self.name }}-conn"
 *       driver: "${{ self.driver }}"
 *     - kind: Sql.Query
 *       metadata:
 *         name: "${{ self.name }}-query"
 *       connection: "${{ self.name }}-conn"
 *       sql: "${{ self.sql }}"
 *   invoke: "${{ self.name }}-query"
 */
export function createTemplateController(definition: {
  schema: Record<string, any>;
  resources?: any[];
  invoke?: string;
  run?: string;
}): ControllerInstance {
  return {
    schema: definition.schema ?? { type: "object", additionalProperties: true },

    create: async (resource: ResourceManifest, ctx: ResourceContext): Promise<ResourceInstance> => {
      // Flatten metadata.name into the top level so templates can use ${{ self.name }}
      // alongside ${{ self.driver }}, ${{ self.sql }}, etc.
      const self = { ...resource, name: resource.metadata.name };

      // Expand every child resource template with the instance manifest as `self`
      const childManifests: ResourceManifest[] = (definition.resources ?? []).map(
        (template: any) => ctx.expandValue(template, { self }) as ResourceManifest,
      );

      // Resolve the invoke/run delegation targets (if defined)
      const invokeTarget: string | null = definition.invoke
        ? (ctx.expandValue(definition.invoke, { self }) as string)
        : null;

      const runTarget: string | null = definition.run
        ? (ctx.expandValue(definition.run, { self }) as string)
        : null;

      // Private child context — child resources are isolated from the parent module.
      // They can still invoke each other because the kernel resolves their kind aliases
      // through the root module context, while instance lookups are scoped to this child.
      const childContext = ctx.spawnChildContext();

      return {
        init: async () => {
          for (const manifest of childManifests) {
            childContext.registerManifest(manifest);
          }
          await childContext.initializeResources();
        },

        invoke: async (inputs: any) => {
          if (!invokeTarget) {
            throw new Error(
              `Template resource '${resource.metadata.name}' (kind: ${resource.kind}) ` +
                `has no 'invoke' delegation target. ` +
                `Add an 'invoke' field to the Kernel.Definition to specify which child resource handles invocations.`,
            );
          }
          return childContext.invoke(resource.kind, invokeTarget, inputs);
        },

        ...(runTarget && {
          run: async () => {
            await childContext.run(runTarget);
          },
        }),

        teardown: async () => {
          await childContext.teardownResources();
        },
      };
    },
  };
}
