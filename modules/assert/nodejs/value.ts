import { ExecContext } from '../../types';

/**
 * Assert.Value executor
 * Evaluates assertions on a value
 */
export async function assertValue(
  _name: string,
  input: any,
  _ctx: ExecContext,
): Promise<any> {
  const { value, assertions = [] } = input;

  if (!Array.isArray(assertions)) {
    throw new Error('Assert.Value requires assertions array');
  }

  const results = [];

  for (const expr of assertions) {
    try {
      // TODO: Implement proper CEL evaluation
      const passed = await evaluateCel(expr, { value });
      results.push({ expression: expr, passed });
      if (!passed) {
        throw new Error(`Assertion failed: ${expr}`);
      }
    } catch (error) {
      throw new Error(
        `Assertion evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    value,
    assertions: results,
    passed: results.every((r) => r.passed),
  };
}

async function evaluateCel(
  expression: string,
  context: Record<string, any>,
): Promise<boolean> {
  // TODO: Use actual CEL library
  try {
    const code = `(function(value) { return ${expression}; })`;
    const fn = eval(code);
    return fn(context.value);
  } catch (error) {
    throw new Error(
      `CEL evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
