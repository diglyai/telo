import { RuntimeResource } from '@diglyai/sdk';

/**
 * Built-in TemplateDefinition resource type
 */
export interface TemplateDefinition extends RuntimeResource {
  kind: 'TemplateDefinition';
  schema: Record<string, any>; // JSONSchema defining template variables
  resources: TemplateResourceBlueprint[];
}

/**
 * A resource blueprint that can include control flow directives
 */
export interface TemplateResourceBlueprint {
  // Control flow directives
  for?: string | string[]; // CEL expression or array of expressions for nested loops
  if?: string; // CEL boolean expression: "has(openapi) && openapi"

  // Resource definition (when not using 'resource' wrapper)
  kind?: string;
  metadata?: {
    name: string;
    [key: string]: any;
  };

  // Alternative: explicit resource wrapper for clarity with control flow
  resource?: RuntimeResource;

  // Any other resource properties
  [key: string]: any;
}

/**
 * Template expansion context containing variables from schema
 */
export interface TemplateContext {
  [varName: string]: any;
}

/**
 * Validates if a resource is a TemplateDefinition
 */
export function isTemplateDefinition(
  resource: RuntimeResource,
): resource is TemplateDefinition {
  return resource.kind === 'TemplateDefinition';
}

/**
 * Extracts default values from JSONSchema to build initial template context
 */
export function extractDefaultsFromSchema(
  schema: Record<string, any>,
): TemplateContext {
  const context: TemplateContext = {};

  if (!schema || typeof schema !== 'object') {
    return context;
  }

  const properties = schema.properties;
  if (!properties || typeof properties !== 'object') {
    return context;
  }

  for (const [key, propSchema] of Object.entries(properties)) {
    if (
      propSchema &&
      typeof propSchema === 'object' &&
      'default' in propSchema
    ) {
      context[key] = propSchema.default;
    }
  }

  return context;
}
