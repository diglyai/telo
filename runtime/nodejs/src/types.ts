import type {
  ControllerContext,
  ResourceContext,
  ResourceInstance,
  ResourceManifest,
  RuntimeErrorCode,
  RuntimeResource,
} from '@diglyai/sdk';
export type {
  ControllerContext,
  ResourceContext,
  ResourceInstance,
  ResourceManifest
} from '@diglyai/sdk';

export interface KernelContext {
  kernel: Kernel;
}

export interface ExecContext {
  execute(urn: string, input: any): Promise<any>;
  [key: string]: any;
}

export interface ResourceDefinition {
  kind: string;
  metadata: {
    name: string;
    resourceKind: string;
    module: string;
  };
  schema: Record<string, any>; // JSON Schema
  events?: string[];
  controllers?: Array<{
    runtime: string;
    entry: string;
  }>;
}

/**
 * Controller definition for a resource kind.
 * Maps a fully-qualified resource kind to its controller implementation for a specific runtime.
 */
export interface ControllerDefinition {
  kind: string; // Fully-qualified kind (e.g., "Http.Route")
  runtime: string; // Runtime selector (e.g., "node@>=20")
  entry: string; // Path to controller implementation
  controller?: any; // Lazy-loaded controller code
}

/**
 * Controller instance - runtime representation of a controller that handles resource instances.
 */
export interface ControllerInstance {
  execute?(name: string, inputs: any, ctx: ExecContext): Promise<any>;
  compile?(
    resource: ResourceManifest,
    ctx: ResourceContext,
  ): RuntimeResource | Promise<RuntimeResource>;
  register?(ctx: ControllerContext): void | Promise<void>;
  create?(
    resource: ResourceManifest,
    ctx: ResourceContext,
  ): ResourceInstance | null | Promise<ResourceInstance | null>;
}

export interface Kernel {
  loadFromConfig(runtimeYamlPath: string): Promise<void>;
  start(): Promise<void>;
  execute(urn: string, input: any, ctx?: any): Promise<any>;
  acquireHold(reason?: string): () => void;
  waitForIdle(): Promise<void>;
}

export class DiglyRuntimeError extends Error {
  constructor(
    public code: RuntimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DiglyRuntimeError';
  }
}
