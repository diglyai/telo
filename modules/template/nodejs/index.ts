import type { ModuleCreateContext, ResourceInstance, RuntimeResource } from "@vokerun/sdk";
import { ControllerContext } from "@vokerun/sdk";

type TemplateParameter = {
  name: string;
  type: string;
  default?: any;
  required?: boolean;
};

type TemplateResource = RuntimeResource & {
  parameters?: TemplateParameter[];
  resources?: Array<Record<string, any>>;
};

export function register(ctx: ControllerContext): void {}

export async function create(
  _resource: TemplateResource,
  _ctx: ModuleCreateContext,
): Promise<ResourceInstance | null> {
  return null;
}

export async function compile(
  resource: TemplateResource,
  ctx: ModuleCreateContext,
): Promise<RuntimeResource> {
  if (resource.kind !== "Template.Template") {
    return resource;
  }

  const template = resource as TemplateResource;
  const parameters = buildParameters(template.parameters || []);
  const resources = template.resources || [];
  const context = {
    Template: { parameters },
    parameters,
  };

  return {
    ...resource,
    parameters: template.parameters,
    resources: ctx.expandValue(resources, context),
  };
}

export async function execute(
  name: string,
  _inputs: Record<string, any>,
  ctx: { resource?: TemplateResource },
): Promise<any> {
  const resource = ctx?.resource;
  if (!resource || resource.kind !== "Template.Template") {
    throw new Error(`Template not found: ${name}`);
  }
  return resource.resources || [];
}

function buildParameters(definitions: TemplateParameter[]): Record<string, any> {
  const params: Record<string, any> = {};

  for (const def of definitions) {
    if (!def?.name) {
      continue;
    }
    if (def.default !== undefined) {
      params[def.name] = def.default;
      continue;
    }
    if (def.required) {
      throw new Error(`Template parameter "${def.name}" is required`);
    }
  }

  return params;
}
