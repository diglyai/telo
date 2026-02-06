import { RuntimeResource } from '@diglyai/sdk';
import { evaluate } from 'cel-js';
import { ResourceURI } from './resource-uri';
import type {
  TemplateContext,
  TemplateDefinition,
  TemplateResourceBlueprint,
} from './template-definition';
import {
  extractDefaultsFromSchema,
  isTemplateDefinition,
} from './template-definition';

const MAX_EXPANSION_DEPTH = 10;
const TEMPLATE_REGEX = /\$\{\{\s*([^}]+?)\s*\}\}/g;
const EXACT_TEMPLATE_REGEX = /^\s*\$\{\{\s*([^}]+?)\s*\}\}\s*$/;

/**
 * Expands all TemplateDefinition resources into concrete resources
 * Supports recursive expansion (templates can generate templates)
 */
export function expandTemplates(
  resources: RuntimeResource[],
): RuntimeResource[] {
  const expanded: RuntimeResource[] = [];
  const nonTemplates: RuntimeResource[] = [];

  // Separate templates from regular resources
  for (const resource of resources) {
    if (isTemplateDefinition(resource)) {
      // Templates will be expanded
      continue;
    } else {
      nonTemplates.push(resource);
    }
  }

  // Track templates for instantiation
  const templates = resources.filter(isTemplateDefinition);

  // Store templates as-is (they define the schema, don't expand their resources yet)
  expanded.push(...templates);
  expanded.push(...nonTemplates);

  return expanded;
}

/**
 * Instantiates a template with provided parameters
 * This is called when a resource of kind "Template.<Name>" is encountered
 */
export function instantiateTemplate(
  template: TemplateDefinition,
  parameters: Record<string, any>,
  instanceName: string,
  depth = 0,
  parentUri?: string,
): RuntimeResource[] {
  if (depth >= MAX_EXPANSION_DEPTH) {
    throw new Error(
      `Template expansion exceeded maximum depth of ${MAX_EXPANSION_DEPTH}. Possible infinite recursion in template "${template.metadata.name}".`,
    );
  }

  // Build context from schema defaults and override with parameters
  const schemaDefaults = extractDefaultsFromSchema(template.schema);
  const context: TemplateContext = { ...schemaDefaults, ...parameters };

  // Expand all resource blueprints
  const expandedResources: RuntimeResource[] = [];

  for (const blueprint of template.resources) {
    const resources = expandBlueprint(
      blueprint,
      context,
      depth,
      parentUri,
      template.metadata.name,
    );
    expandedResources.push(...resources);
  }

  return expandedResources;
}

/**
 * Expands a single resource blueprint, handling for/if directives
 */
function expandBlueprint(
  blueprint: TemplateResourceBlueprint,
  context: TemplateContext,
  depth: number,
  parentUri?: string,
  templateDefinitionName?: string,
): RuntimeResource[] {
  // Handle 'if' directive first
  if (blueprint.if) {
    const condition = evaluateCEL(blueprint.if, context);
    if (!condition) {
      return []; // Skip this resource
    }
  }

  // Handle 'for' directive
  if (blueprint.for) {
    // Check if it's an array of expressions (nested loops)
    if (Array.isArray(blueprint.for)) {
      return expandNestedForLoops(
        blueprint,
        context,
        depth,
        parentUri,
        templateDefinitionName,
      );
    }
    return expandForLoop(
      blueprint,
      context,
      depth,
      parentUri,
      templateDefinitionName,
    );
  }

  // Regular resource expansion
  return [
    expandSingleResource(
      blueprint,
      context,
      depth,
      parentUri,
      templateDefinitionName,
    ),
  ];
}

/**
 * Expands nested for loops defined as an array of expressions
 * Example: for: ['endpoint in endpoints', 'method in endpoint.methods']
 */
function expandNestedForLoops(
  blueprint: TemplateResourceBlueprint,
  context: TemplateContext,
  depth: number,
  parentUri?: string,
  templateDefinitionName?: string,
): RuntimeResource[] {
  const forExprs = blueprint.for as string[];

  if (forExprs.length === 0) {
    // No loops, just expand the resource
    const innerBlueprint = { ...blueprint };
    delete innerBlueprint.for;
    delete innerBlueprint.if; // Already evaluated
    return expandBlueprint(
      innerBlueprint,
      context,
      depth,
      parentUri,
      templateDefinitionName,
    );
  }

  if (forExprs.length === 1) {
    // Single loop, use standard expansion
    const innerBlueprint = { ...blueprint, for: forExprs[0] };
    return expandBlueprint(
      innerBlueprint,
      context,
      depth,
      parentUri,
      templateDefinitionName,
    );
  }

  // Multiple loops - process the first one and recurse with the rest
  const [firstExpr, ...restExprs] = forExprs;

  // Parse the first loop expression
  const match = firstExpr.match(/^\s*(\w+)(?:\s*,\s*(\w+))?\s+in\s+(.+)$/);
  if (!match) {
    throw new Error(
      `Invalid 'for' expression: "${firstExpr}". Expected format: "item in collection" or "key, value in collection"`,
    );
  }

  const [, itemVar, valueVar, collectionExpr] = match;
  const collection = evaluateCEL(collectionExpr, context);

  if (!collection) {
    return [];
  }

  const results: RuntimeResource[] = [];

  // Handle arrays
  if (Array.isArray(collection)) {
    for (const [index, item] of collection.entries()) {
      const loopContext: TemplateContext = {
        ...context,
        [itemVar]: item,
      };
      if (valueVar) {
        loopContext[valueVar] = item;
        loopContext[itemVar] = index;
      }

      // Create blueprint with remaining loops
      const innerBlueprint = { ...blueprint, for: restExprs };
      delete innerBlueprint.if; // Already evaluated

      const expanded = expandBlueprint(
        innerBlueprint,
        loopContext,
        depth,
        parentUri,
        templateDefinitionName,
      );
      results.push(...expanded);
    }
  }
  // Handle objects/maps
  else if (collection && typeof collection === 'object') {
    for (const [key, value] of Object.entries(collection)) {
      const loopContext: TemplateContext = {
        ...context,
        [itemVar]: key,
      };
      if (valueVar) {
        loopContext[valueVar] = value;
      }

      // Create blueprint with remaining loops
      const innerBlueprint = { ...blueprint, for: restExprs };
      delete innerBlueprint.if; // Already evaluated

      const expanded = expandBlueprint(
        innerBlueprint,
        loopContext,
        depth,
        parentUri,
        templateDefinitionName,
      );
      results.push(...expanded);
    }
  } else {
    throw new Error(
      `'for' expression "${collectionExpr}" did not evaluate to an iterable (got ${typeof collection})`,
    );
  }

  return results;
}

/**
 * Expands a for loop directive
 * Syntax: "itemVar in collection" or "key, value in map"
 */
function expandForLoop(
  blueprint: TemplateResourceBlueprint,
  context: TemplateContext,
  depth: number,
  parentUri?: string,
  templateDefinitionName?: string,
): RuntimeResource[] {
  const forExpr = blueprint.for as string;

  // Parse "item in collection" or "key, value in collection"
  const match = forExpr.match(/^\s*(\w+)(?:\s*,\s*(\w+))?\s+in\s+(.+)$/);
  if (!match) {
    throw new Error(
      `Invalid 'for' expression: "${forExpr}". Expected format: "item in collection" or "key, value in collection"`,
    );
  }

  const [, itemVar, valueVar, collectionExpr] = match;
  const collection = evaluateCEL(collectionExpr, context);

  if (!collection) {
    return [];
  }

  const results: RuntimeResource[] = [];

  // Handle arrays
  if (Array.isArray(collection)) {
    for (const [index, item] of collection.entries()) {
      const loopContext: TemplateContext = {
        ...context,
        [itemVar]: item,
      };
      if (valueVar) {
        loopContext[valueVar] = item;
        loopContext[itemVar] = index;
      }

      const innerBlueprint = { ...blueprint };
      delete innerBlueprint.for;
      delete innerBlueprint.if; // Already evaluated

      const expanded = expandBlueprint(
        innerBlueprint,
        loopContext,
        depth,
        parentUri,
        templateDefinitionName,
      );
      results.push(...expanded);
    }
  }
  // Handle objects/maps
  else if (collection && typeof collection === 'object') {
    for (const [key, value] of Object.entries(collection)) {
      const loopContext: TemplateContext = {
        ...context,
        [itemVar]: key,
      };
      if (valueVar) {
        loopContext[valueVar] = value;
      }

      const innerBlueprint = { ...blueprint };
      delete innerBlueprint.for;
      delete innerBlueprint.if;

      const expanded = expandBlueprint(
        innerBlueprint,
        loopContext,
        depth,
        parentUri,
        templateDefinitionName,
      );
      results.push(...expanded);
    }
  } else {
    throw new Error(
      `'for' expression "${collectionExpr}" did not evaluate to an iterable (got ${typeof collection})`,
    );
  }

  return results;
}

/**
 * Expands a single resource, resolving all CEL expressions
 */
function expandSingleResource(
  blueprint: TemplateResourceBlueprint,
  context: TemplateContext,
  depth: number,
  parentUri?: string,
  templateDefinitionName?: string,
): RuntimeResource {
  // Get the actual resource (might be in 'resource' wrapper)
  const resourceDef = blueprint.resource || blueprint;

  // Remove control flow directives from final resource
  const cleanBlueprint = { ...resourceDef };
  delete (cleanBlueprint as any).for;
  delete (cleanBlueprint as any).if;
  delete (cleanBlueprint as any).resource;

  // Expand all CEL expressions in the resource with template context
  const expanded = expandTemplateValue(cleanBlueprint, context);

  // Validate basic structure
  if (!expanded.kind || typeof expanded.kind !== 'string') {
    throw new Error(
      `Template resource blueprint missing required 'kind' field`,
    );
  }
  if (!expanded.metadata?.name || typeof expanded.metadata.name !== 'string') {
    throw new Error(
      `Template resource blueprint missing required 'metadata.name' field`,
    );
  }

  // Assign URI and generation depth for template-generated resources
  if (templateDefinitionName) {
    const resourceUri = ResourceURI.fromTemplate(
      templateDefinitionName,
      expanded.kind,
      expanded.metadata.name,
    );

    // If parentUri exists, append to it; otherwise use the created URI
    const finalUri = parentUri
      ? ResourceURI.parse(parentUri).withChild(
          expanded.kind,
          expanded.metadata.name,
        )
      : resourceUri;

    expanded.metadata.uri = finalUri.toString();
    expanded.metadata.generationDepth =
      (expanded.metadata.generationDepth || 0) + 1;
  }

  return expanded as RuntimeResource;
}

/**
 * Expands template values using the template context
 * This is different from the global expandValue which uses registry context
 */
function expandTemplateValue(value: any, context: TemplateContext): any {
  if (typeof value === 'string') {
    return expandTemplateString(value, context);
  }
  if (Array.isArray(value)) {
    // Check if array contains control flow directives
    const expanded: any[] = [];
    for (const item of value) {
      if (item && typeof item === 'object' && (item.for || item.if)) {
        // This is a control flow directive - expand it as a property value
        const expandedItems = expandPropertyControlFlow(item, context);
        expanded.push(...expandedItems);
      } else {
        expanded.push(expandTemplateValue(item, context));
      }
    }
    return expanded;
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const resolved: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value)) {
    resolved[key] = expandTemplateValue(entry, context);
  }
  return resolved;
}

/**
 * Expands control flow directives for property values (not full resources)
 * Returns array of expanded property values
 */
function expandPropertyControlFlow(item: any, context: TemplateContext): any[] {
  // Handle 'if' directive first
  if (item.if) {
    const condition = evaluateCEL(item.if, context);
    if (!condition) {
      return []; // Skip this item
    }
  }

  // Handle 'for' directive
  if (item.for) {
    const forExprs = Array.isArray(item.for) ? item.for : [item.for];
    return expandPropertyForLoop(item, forExprs, context);
  }

  // No control flow, just expand the value
  const cleanItem = { ...item };
  delete cleanItem.if;
  return [expandTemplateValue(cleanItem, context)];
}

/**
 * Expands for loops for property values
 */
function expandPropertyForLoop(
  item: any,
  forExprs: string[],
  context: TemplateContext,
): any[] {
  if (forExprs.length === 0) {
    const cleanItem = { ...item };
    delete cleanItem.for;
    delete cleanItem.if;
    return [expandTemplateValue(cleanItem, context)];
  }

  const [firstExpr, ...restExprs] = forExprs;

  // Parse the loop expression
  const match = firstExpr.match(/^\s*(\w+)(?:\s*,\s*(\w+))?\s+in\s+(.+)$/);
  if (!match) {
    throw new Error(
      `Invalid 'for' expression: "${firstExpr}". Expected format: "item in collection" or "key, value in collection"`,
    );
  }

  const [, itemVar, valueVar, collectionExpr] = match;
  const collection = evaluateCEL(collectionExpr, context);

  if (!collection) {
    return [];
  }

  const results: any[] = [];

  // Handle arrays
  if (Array.isArray(collection)) {
    for (const [index, collectionItem] of collection.entries()) {
      const loopContext: TemplateContext = {
        ...context,
        [itemVar]: collectionItem,
      };
      if (valueVar) {
        loopContext[valueVar] = collectionItem;
        loopContext[itemVar] = index;
      }

      // If more loops remain, recurse
      if (restExprs.length > 0) {
        const nestedResults = expandPropertyForLoop(
          item,
          restExprs,
          loopContext,
        );
        results.push(...nestedResults);
      } else {
        // Last loop - expand the item
        const cleanItem = { ...item };
        delete cleanItem.for;
        delete cleanItem.if;
        results.push(expandTemplateValue(cleanItem, loopContext));
      }
    }
  }
  // Handle objects/maps
  else if (collection && typeof collection === 'object') {
    for (const [key, value] of Object.entries(collection)) {
      const loopContext: TemplateContext = {
        ...context,
        [itemVar]: key,
      };
      if (valueVar) {
        loopContext[valueVar] = value;
      }

      // If more loops remain, recurse
      if (restExprs.length > 0) {
        const nestedResults = expandPropertyForLoop(
          item,
          restExprs,
          loopContext,
        );
        results.push(...nestedResults);
      } else {
        // Last loop - expand the item
        const cleanItem = { ...item };
        delete cleanItem.for;
        delete cleanItem.if;
        results.push(expandTemplateValue(cleanItem, loopContext));
      }
    }
  } else {
    throw new Error(
      `'for' expression "${collectionExpr}" did not evaluate to an iterable (got ${typeof collection})`,
    );
  }

  return results;
}

/**
 * Expands a template string with CEL expressions
 */
function expandTemplateString(value: string, context: TemplateContext): any {
  if (!value.includes('${{')) {
    return value;
  }

  const exact = value.match(EXACT_TEMPLATE_REGEX);
  if (exact) {
    return evaluateCEL(exact[1], context);
  }

  return value.replace(TEMPLATE_REGEX, (_match, expr) => {
    const evaluated = evaluateCEL(expr, context);
    if (evaluated === null || evaluated === undefined) {
      return '';
    }
    return String(evaluated);
  });
} /**
 * Evaluates a CEL expression with proper error handling
 */
function evaluateCEL(expression: string, context: Record<string, any>): any {
  try {
    return evaluate(expression, context);
  } catch (error) {
    throw new Error(
      `Failed to evaluate CEL expression "${expression}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Expands array/object properties that contain 'for' directives
 * Example: routes: [{ for: "r in routes", resource: { path: "${{ r }}" } }]
 * Also supports nested loops with array syntax: { for: ["e in endpoints", "m in e.methods"], ... }
 */
export function expandPropertyWithControlFlow(
  value: any,
  context: TemplateContext,
): any {
  if (Array.isArray(value)) {
    const expanded: any[] = [];
    for (const item of value) {
      if (item && typeof item === 'object') {
        // Check if this is a control flow directive
        if (item.for || item.if) {
          const blueprints = expandBlueprint(item, context, 0);
          expanded.push(...blueprints);
        } else {
          expanded.push(expandPropertyWithControlFlow(item, context));
        }
      } else {
        expanded.push(item);
      }
    }
    return expanded;
  }

  if (value && typeof value === 'object') {
    const expanded: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      expanded[key] = expandPropertyWithControlFlow(val, context);
    }
    return expanded;
  }

  return value;
}
