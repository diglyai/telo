import type { ResourceContext, ResourceInstance } from "@telorun/sdk";

export async function create(resource: any, ctx: ResourceContext): Promise<ResourceInstance> {
  return {
    run: async () => {
      for (const target of (resource.targets as string[]) ?? []) {
        const [kind, name] = target.split(".");
        if (!kind || !name) {
          throw new Error(`Invalid target format: "${target}". Expected "Kind.Name"`);
        }
        await ctx.invoke(kind, name, {});
      }
    },
  };
}

