import { RuntimeResource } from "@telorun/sdk";
import { evaluate } from "cel-js";
import type { ResourceManifest } from "./types.js";

type ResourceId = { kind: string; name: string };

const TEMPLATE_REGEX = /\$\{\{\s*([^}]+?)\s*\}\}/g;
const EXACT_TEMPLATE_REGEX = /^\s*\$\{\{\s*([^}]+?)\s*\}\}\s*$/;

export function evaluateCel(expression: string, context: Record<string, any>): unknown {
  return evaluate(expression, context);
}

export function expandValue(value: any, context: Record<string, any>): any {
  if (typeof value === "string") {
    return expandString(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => expandValue(entry, context));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const resolved: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value)) {
    resolved[key] = expandValue(entry, context);
  }
  return resolved;
}

export function resolveExpressionsInRegistry(
  registry: Map<string, Map<string, RuntimeResource>>,
  runtimeConfig: ResourceManifest | null,
): void {
  const maxPasses = 5;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const context = buildEvaluationContext(registry, runtimeConfig);
    let changed = false;

    for (const [kind, resourcesByName] of registry.entries()) {
      for (const [name, resource] of resourcesByName.entries()) {
        const { value, updated } = resolveResource(resource, context, {
          kind,
          name,
        });
        if (updated) {
          resourcesByName.set(name, value);
          changed = true;
        }
      }
    }

    if (!changed) {
      break;
    }
  }
}

function buildEvaluationContext(
  registry: Map<string, Map<string, RuntimeResource>>,
  runtimeConfig: ResourceManifest | null,
): Record<string, any> {
  // Whitelist environment variables
  const allowedEnvVars = ["NODE_ENV", "PORT", "HOST", "PATH", "HOME", "USER", "LANG"];
  const env: Record<string, any> = {};
  for (const key of allowedEnvVars) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }

  const context: Record<string, any> = { env };

  const modules: Record<string, any> = {};
  if (runtimeConfig?.name) {
    const moduleEntry = {
      name: runtimeConfig.name,
      version: runtimeConfig.version,
    };
    modules[runtimeConfig.name] = moduleEntry;
    const alias = capitalize(runtimeConfig.name);
    if (alias && alias !== runtimeConfig.name) {
      modules[alias] = moduleEntry;
    }
  }
  context.Namespace = modules;

  for (const [kind, resourcesByName] of registry.entries()) {
    const kindBucket: Record<string, any> = {};
    for (const [name, resource] of resourcesByName.entries()) {
      kindBucket[name] = resource;
    }
    const parts = kind.split(".").filter(Boolean);
    if (parts.length <= 1) {
      context[kind] = kindBucket;
      continue;
    }
    let cursor: Record<string, any> = context;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      if (!cursor[part] || typeof cursor[part] !== "object") {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, any>;
    }
    cursor[parts[parts.length - 1]] = kindBucket;
  }

  return context;
}

function resolveResource(
  resource: RuntimeResource,
  context: Record<string, any>,
  id: ResourceId,
): { value: RuntimeResource; updated: boolean } {
  const { value, updated } = resolveValue(resource, context, id, {
    isRoot: true,
  });
  return { value: value as RuntimeResource, updated };
}

function resolveValue(
  value: any,
  context: Record<string, any>,
  id: ResourceId,
  options?: { isRoot?: boolean; isMetadata?: boolean },
): { value: any; updated: boolean } {
  if (typeof value === "string") {
    return resolveString(value, context, id);
  }

  if (Array.isArray(value)) {
    let changed = false;
    const resolved = value.map((entry) => {
      const result = resolveValue(entry, context, id);
      if (result.updated) {
        changed = true;
      }
      return result.value;
    });
    return { value: changed ? resolved : value, updated: changed };
  }

  if (!value || typeof value !== "object") {
    return { value, updated: false };
  }

  let changed = false;
  const resolved: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (options?.isRoot && key === "kind") {
      resolved[key] = entry;
      continue;
    }
    if (options?.isMetadata && key === "name") {
      resolved[key] = entry;
      continue;
    }

    if (options?.isRoot && key === "metadata" && entry && typeof entry === "object") {
      const result = resolveValue(entry, context, id, { isMetadata: true });
      resolved[key] = result.value;
      if (result.updated) {
        changed = true;
      }
      continue;
    }

    // Skip 'resources' and 'schema' fields for TemplateDefinition
    // These contain template variables that should only be resolved during instantiation
    if (
      options?.isRoot &&
      id.kind === "TemplateDefinition" &&
      (key === "resources" || key === "schema")
    ) {
      resolved[key] = entry;
      continue;
    }

    const result = resolveValue(entry, context, id);
    resolved[key] = result.value;
    if (result.updated) {
      changed = true;
    }
  }

  return { value: changed ? resolved : value, updated: changed };
}

function resolveString(
  value: string,
  context: Record<string, any>,
  id: ResourceId,
): { value: any; updated: boolean } {
  if (!value.includes("${{")) {
    return { value, updated: false };
  }

  const exact = value.match(EXACT_TEMPLATE_REGEX);
  if (exact) {
    const expr = exact[1];
    const evaluated = evaluateExpression(expr, context, id);
    if (evaluated.deferred) {
      return { value, updated: false };
    }
    return { value: evaluated.value, updated: true };
  }

  let replaced = value;
  replaced = replaced.replace(TEMPLATE_REGEX, (_match, expr) => {
    const evaluated = evaluateExpression(expr, context, id);
    if (evaluated.deferred) {
      return _match;
    }
    if (evaluated.value === null || evaluated.value === undefined) {
      return "";
    }
    return String(evaluated.value);
  });

  return { value: replaced, updated: replaced !== value };
}

function expandString(value: string, context: Record<string, any>): any {
  if (!value.includes("${{")) {
    return value;
  }

  const exact = value.match(EXACT_TEMPLATE_REGEX);
  if (exact) {
    return evaluateCelWithError(exact[1], context, {
      kind: "Value",
      name: "expand",
    });
  }

  return value.replace(TEMPLATE_REGEX, (_match, expr) => {
    const evaluated = evaluateCelWithError(expr, context, {
      kind: "Value",
      name: "expand",
    });
    if (evaluated === null || evaluated === undefined) {
      return "";
    }
    return String(evaluated);
  });
}

function evaluateExpression(
  expr: string,
  context: Record<string, any>,
  id: ResourceId,
): { value?: unknown; deferred: boolean } {
  try {
    return { value: evaluateCelWithError(expr, context, id), deferred: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isDeferredExpressionError(message, expr)) {
      return { deferred: true };
    }
    throw new Error(`CEL evaluation failed for ${id.kind}.${id.name}: "${expr}": ${message}`);
  }
}

function capitalize(value: string): string {
  if (!value) {
    return value;
  }
  return value[0].toUpperCase() + value.slice(1);
}

function isDeferredExpressionError(message: string, expr: string): boolean {
  const trimmed = expr.trim();
  const deferredRoots = ["request.", "result."];
  if (!deferredRoots.some((root) => trimmed.startsWith(root))) {
    return false;
  }
  return message.includes('Identifier "') && message.includes("not found");
}

function evaluateCelWithError(expr: string, context: Record<string, any>, id: ResourceId): unknown {
  try {
    return evaluateCel(expr, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Build helpful context information
    const availableVars = Object.keys(context)
      .filter((k) => k !== "env")
      .concat(context.env ? Object.keys(context.env).map((k) => `env.${k}`) : [])
      .sort();

    throw new Error(
      `CEL evaluation failed for resource ${id.kind}.${id.name}\n` +
        `Expression: "${expr}"\n` +
        `Error: ${message}\n` +
        `Available variables: ${availableVars.slice(0, 20).join(", ")}${availableVars.length > 20 ? "..." : ""}`,
    );
  }
}
