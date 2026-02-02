import { DiglyRuntimeError, ExecContext, RuntimeError } from '../../types';

interface PipelineJob {
  metadata: {
    name: string;
    description?: string;
  };
  steps: Array<{
    name: string;
    kind: string;
    code?: string;
    method?: string;
    url?: string;
    event?: string;
    timeout?: number;
    filter?: string;
    value?: string;
    input?: Record<string, any>;
    body?: Record<string, any>;
    headers?: Record<string, string>;
    outputs?: Record<string, string>;
    assertions?: string[];
  }>;
}

interface StepContext {
  [key: string]: any;
}

export async function executePipelineJob(
  job: PipelineJob,
  _input: any,
  ctx: ExecContext,
): Promise<any> {
  const stepContext: StepContext = {};
  const results: Array<{
    step: string;
    result: any;
    assertions: Array<{ expression: string; passed: boolean; error?: string }>;
  }> = [];

  for (const step of job.steps) {
    try {
      // Execute the step
      const stepResult = await executeStep(step, stepContext, ctx);

      // Extract outputs if specified
      if (step.outputs) {
        for (const [varName, jsonPath] of Object.entries(step.outputs)) {
          stepContext[varName] = extractJsonPath(stepResult, jsonPath);
        }
      }

      // Evaluate assertions if present
      const assertionResults: Array<{
        expression: string;
        passed: boolean;
        error?: string;
      }> = [];

      if (step.assertions && step.assertions.length > 0) {
        for (const expr of step.assertions) {
          try {
            // For Assert.Value steps, value is available in stepContext
            const value =
              step.kind === 'Assert.Value' ? stepContext.value : stepResult;
            const passed = await evaluateCelExpression(expr, {
              value,
              ...stepContext,
            });
            assertionResults.push({ expression: expr, passed });
            if (!passed) {
              throw new Error(`Assertion failed: ${expr} evaluated to false`);
            }
          } catch (error) {
            assertionResults.push({
              expression: expr,
              passed: false,
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        }
      }

      results.push({
        step: step.name,
        result: stepResult,
        assertions: assertionResults,
      });
    } catch (error) {
      throw new DiglyRuntimeError(
        RuntimeError.ERR_EXECUTION_FAILED,
        `Pipeline step "${step.name}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    job: job.metadata.name,
    status: 'completed',
    steps: results,
    context: stepContext,
  };
}

async function executeStep(
  step: PipelineJob['steps'][0],
  stepContext: StepContext,
  ctx: ExecContext,
): Promise<any> {
  switch (step.kind) {
    case 'Logic.JavaScript':
      return executeJavaScript(step, stepContext);

    case 'HttpClient.Request':
      return executeHttpRequest(step, stepContext);

    case 'Observe.Event':
      return observeEvent(step, stepContext, ctx);

    case 'Assert.Value':
      return assertValue(step, stepContext);

    default:
      // Try to execute as a resource URN
      if (step.kind.includes('.')) {
        return await ctx.execute(
          `${step.kind}.${step.name || 'inline'}`,
          resolveInputExpressions(step.input || {}, stepContext),
        );
      }
      throw new Error(`Unknown step kind: ${step.kind}`);
  }
}

function executeJavaScript(
  step: PipelineJob['steps'][0],
  stepContext: StepContext,
): any {
  if (!step.code) {
    throw new Error('JavaScript step requires "code" field');
  }

  // Create a function from the code
  const fn = new Function('main', step.code);

  // Execute the function with input
  const input = resolveInputExpressions(step.input || {}, stepContext);
  const result = fn((params: Record<string, any>) => {
    return params;
  });

  // Call main with the input
  if (typeof result === 'object' && result.main) {
    return result.main(input);
  }

  // Try to execute it directly if it has a main function
  try {
    const code = `(function() { ${step.code}; return main; })()`;
    const mainFn = eval(code);
    return mainFn(input);
  } catch (error) {
    throw new Error(
      `Failed to execute JavaScript: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function executeHttpRequest(
  step: PipelineJob['steps'][0],
  stepContext: StepContext,
): Promise<any> {
  if (!step.method || !step.url) {
    throw new Error('HttpClient.Request requires "method" and "url" fields');
  }

  const url = resolveString(step.url, stepContext);
  const method = step.method.toUpperCase();
  const headers = resolveObject(step.headers || {}, stepContext);
  const body = step.body ? resolveObject(step.body, stepContext) : undefined;

  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    const data = await response.json();
    return {
      status: response.status,
      statusText: response.statusText,
      payload: data,
    };
  } catch (error) {
    throw new Error(
      `HTTP request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function observeEvent(
  step: PipelineJob['steps'][0],
  stepContext: StepContext,
  _ctx: ExecContext,
): Promise<any> {
  if (!step.event) {
    throw new Error('Observe.Event requires "event" field');
  }

  // TODO: Implement event observation via event bus
  // For now, return empty object
  return {
    event: step.event,
    data: {},
  };
}

async function assertValue(
  step: PipelineJob['steps'][0],
  stepContext: StepContext,
): Promise<any> {
  const value = resolveExpression(step.value || null, stepContext);
  // Store in context for assertion evaluation
  stepContext.value = value;
  return { value };
}

function extractJsonPath(obj: any, path: string): any {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

async function evaluateCelExpression(
  expression: string,
  context: Record<string, any>,
): Promise<boolean> {
  // TODO: Implement proper CEL evaluation
  // For now, use basic eval (should use proper CEL library)
  try {
    // Create a safe eval context
    const code = `(function(ctx) { return ${expression}; })`;
    const fn = eval(code);
    return fn(context);
  } catch (error) {
    throw new Error(
      `Failed to evaluate CEL expression "${expression}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function resolveInputExpressions(
  input: Record<string, any>,
  context: StepContext,
): Record<string, any> {
  const resolved: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    resolved[key] = resolveExpression(value, context);
  }
  return resolved;
}

function resolveExpression(value: any, context: StepContext): any {
  if (typeof value === 'string') {
    return resolveString(value, context);
  }
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      return value.map((v) => resolveExpression(v, context));
    }
    return resolveObject(value, context);
  }
  return value;
}

function resolveString(str: string, context: StepContext): string {
  // Replace ${{ variable }} patterns
  return str.replace(/\$\{\{\s*([^}]+)\s*\}\}/g, (match, key) => {
    const value = context[key];
    if (value === undefined) {
      throw new Error(`Undefined variable: ${key}`);
    }
    return String(value);
  });
}

function resolveObject(
  obj: Record<string, any>,
  context: StepContext,
): Record<string, any> {
  const resolved: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    resolved[key] = resolveExpression(value, context);
  }
  return resolved;
}
