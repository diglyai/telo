import { evaluate } from "cel-js";

const TEMPLATE_REGEX = /\$\{\{\s*([^}]+?)\s*\}\}/g;
const EXACT_TEMPLATE_REGEX = /^\s*\$\{\{\s*([^}]+?)\s*\}\}\s*$/;

function collectSecretValues(secrets: Record<string, unknown>): Set<string> {
  const values = new Set<string>();
  for (const value of Object.values(secrets)) {
    if (typeof value === "string" && value.length > 0) {
      values.add(value);
    }
  }
  return values;
}

function redactSecrets(message: string, secretValues: Set<string>): string {
  if (secretValues.size === 0) return message;
  const sorted = Array.from(secretValues).sort((a, b) => b.length - a.length);
  let result = message;
  for (const secret of sorted) {
    result = result.split(secret).join("[REDACTED]");
  }
  return result;
}

/**
 * Base class for all evaluation contexts. Holds the raw merged context record
 * and owns all CEL evaluation logic, template expansion, and secrets redaction.
 */
export class EvaluationContext {
  readonly secretValues: Set<string>;

  constructor(
    readonly context: Record<string, unknown>,
    secretValues?: Set<string>,
  ) {
    this.secretValues = secretValues ?? new Set();
  }

  /**
   * Evaluate a single CEL expression string against the context.
   * Secret values are redacted from any thrown error message.
   */
  evaluate(expression: string): unknown {
    try {
      return evaluate(expression, this.context);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const safe = redactSecrets(raw, this.secretValues);
      throw new Error(`CEL evaluation failed: "${expression}": ${safe}`);
    }
  }

  /**
   * Expand a value that may contain ${{ }} templates.
   * Works recursively over strings, arrays, and objects.
   * Templates whose identifiers are not present in the context are left
   * unchanged (deferred) — they will be resolved at execution time when a
   * richer ExecutionContext is available. All other CEL errors are propagated.
   */
  expand(value: unknown): unknown {
    if (typeof value === "string") {
      return this.expandString(value);
    }
    if (Array.isArray(value)) {
      return value.map((entry) => this.expand(entry));
    }
    if (value !== null && typeof value === "object") {
      const resolved: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        resolved[key] = this.expand(entry);
      }
      return resolved;
    }
    return value;
  }

  /**
   * Merge another context on top of this one.
   * Returns a new base EvaluationContext — 'other' wins on key conflict.
   */
  merge(other: EvaluationContext | Record<string, unknown>): EvaluationContext {
    const otherCtx = other instanceof EvaluationContext ? other.context : other;
    const otherSecrets =
      other instanceof EvaluationContext ? other.secretValues : new Set<string>();
    const merged = Object.assign(Object.create(null), this.context, otherCtx) as Record<
      string,
      unknown
    >;
    const mergedSecrets = new Set<string>([...this.secretValues, ...otherSecrets]);
    return new EvaluationContext(merged, mergedSecrets);
  }

  private expandString(value: string): unknown {
    if (!value.includes("${{")) {
      return value;
    }

    const exact = value.match(EXACT_TEMPLATE_REGEX);
    if (exact) {
      return this.evaluate(exact[1]);
    }

    return value.replace(TEMPLATE_REGEX, (_match, expr: string) => {
      const resolved = this.evaluate(expr);
      if (resolved === null || resolved === undefined) {
        return "";
      }
      return String(resolved);
    });
  }
}

/**
 * The boot-time, module-scoped context layer. Four reserved namespaces:
 * variables, secrets, resources, imports.
 *
 * Builds its context record from the four namespaces and passes it to the
 * base class. Secret values are extracted for automatic redaction.
 */
export class ModuleContext extends EvaluationContext {
  constructor(
    readonly variables: Record<string, unknown>,
    readonly secrets: Record<string, unknown>,
    readonly resources: Record<string, unknown>,
    readonly imports: Record<string, unknown>,
  ) {
    super({ variables, secrets, resources, imports }, collectSecretValues(secrets));
  }
}

/**
 * The ephemeral, per-trigger context layer. Merges a ModuleContext with
 * arbitrary execution-time properties (e.g. { request, inputs } for HTTP;
 * any shape is valid — determined by the trigger type).
 *
 * Execution props overlay the module namespaces on key conflict.
 */
export class ExecutionContext extends EvaluationContext {
  constructor(moduleCtx: ModuleContext, execProps: Record<string, unknown>) {
    super(
      Object.assign(Object.create(null), moduleCtx.context, execProps) as Record<string, unknown>,
      moduleCtx.secretValues,
    );
  }
}
