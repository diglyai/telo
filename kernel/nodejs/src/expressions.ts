import { EvaluationContext } from "./evaluation-context.js";

/**
 * Evaluate a CEL expression against an arbitrary context record.
 * Thin wrapper over EvaluationContext.evaluate() for use in ControllerContext.
 */
export function evaluateCel(expression: string, context: Record<string, unknown>): unknown {
  return new EvaluationContext(context).evaluate(expression);
}

/**
 * Expand a value containing ${{ }} CEL templates against an arbitrary context record.
 * Thin wrapper over EvaluationContext.expand() for use in ControllerContext.
 */
export function expandValue(value: unknown, context: Record<string, unknown>): unknown {
  return new EvaluationContext(context).expand(value);
}
