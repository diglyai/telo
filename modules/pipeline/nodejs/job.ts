import type { ExecContext, ResourceContext } from '@diglyai/sdk';

console.log('Pipeline module loaded');

interface PipelineJob {
  metadata: {
    name: string;
    description?: string;
  };
  steps: Array<{
    kind: string;
    metadata: { name: string; module: string };
    outputs?: Record<string, string>; // variable name to JSON path in result
    inputs?: Record<string, any>; // input parameters for the step
  }>;
}

interface StepContext {
  [key: string]: any;
}

class PipelineJob {
  constructor(public resource: any) {}

  init(input: any, ctx: ExecContext): Promise<any> {
    return executePipelineJob(this.resource, input, ctx);
  }
}

export function register() {}

export function create(resource: any, ctx: ResourceContext) {
  return new PipelineJob(resource);
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
    console.log(`Executing step: ${step.metadata.name} of kind ${step.kind}`);
    try {
      // Execute the step
      const stepResult = await executeStep(step, stepContext, ctx);

      // Extract outputs if specified
      // if (step.outputs) {
      //   for (const [varName, jsonPath] of Object.entries(step.outputs)) {
      //     stepContext[varName] = extractJsonPath(stepResult, jsonPath);
      //   }
      // }

      // Evaluate assertions if present
      const assertionResults: Array<{
        expression: string;
        passed: boolean;
        error?: string;
      }> = [];

      results.push({
        step: step.metadata.name,
        result: stepResult,
        assertions: assertionResults,
      });
    } catch (error) {
      throw new Error(
        `Pipeline step "${step.metadata.name}" failed: ${error instanceof Error ? error.message : String(error)}`,
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
  return await ctx.execute(
    `${step.kind}.${step.metadata.name}`,
    resolveInputExpressions(step.inputs || {}, stepContext),
  );
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
