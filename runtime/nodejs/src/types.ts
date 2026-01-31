import type {
  ModuleContext,
  ModuleCreateContext,
  ResourceInstance,
} from '@diglyai/sdk';
export type {
  ModuleContext,
  ModuleCreateContext,
  ResourceInstance
} from '@diglyai/sdk';

/**
 * Core type definitions for Digly Runtime
 */
export interface RuntimeResource {
  kind: string;
  metadata: {
    name: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface KernelContext {
  kernel: Kernel;
  [key: string]: any;
}

export interface ExecContext {
  execute(urn: string, input: any): Promise<any>;
  [key: string]: any;
}

export interface ResourceDefinition {
  kind: 'ResourceDefinition';
  metadata: {
    name: string;
    resourceKind: string;
  };
  schema: Record<string, any>; // JSON Schema
  events?: string[];
  controllers?: Array<{
    runtime: string;
    entrypoint: string;
  }>;
}

export interface ModuleDiscoveryResult {
  mainModule: {
    manifest: ModuleManifest;
    resourceDefinitions: ResourceDefinition[];
  };
  importedModules: Array<{
    path: string;
    manifest: ModuleManifest;
    resourceDefinitions: ResourceDefinition[];
  }>;
}

export interface ModuleManifest {
  name: string;
  version: string;
  imports?: string[]; // paths to other modules to import
  definitions?: string[]; // paths to ResourceDefinition files
  entrypoint?: string;
  entrypoints?: Array<{
    runtime: string;
    entrypoint: string;
  }>;
  resources?: (string | { path: string })[]; // paths to Manifests containing resources to create
  importEntrypoints?: Record<
    string,
    Array<{
      runtime: string;
      entrypoint: string;
    }>
  >;
}

export interface DiglyModule {
  name: string;
  manifest: ModuleManifest;
  resourceKinds: string[]; // derived from manifest

  onLoad(resources: RuntimeResource[]): void;
  onStart(ctx: KernelContext): Promise<void>;
  execute(name: string, inputs: any, ctx: ExecContext): Promise<any>;
  compile?(
    resource: RuntimeResource,
    ctx: ModuleCreateContext,
  ): RuntimeResource | Promise<RuntimeResource>;
  register?(ctx: ModuleContext): void | Promise<void>;
  create?(
    resource: RuntimeResource,
    ctx: ModuleCreateContext,
  ): ResourceInstance | null | Promise<ResourceInstance | null>;
}

export interface Kernel {
  registry: Map<string, Map<string, RuntimeResource>>;
  modules: Map<string, DiglyModule>;
  moduleInstances: Map<string, DiglyModule>;

  loadFromConfig(runtimeYamlPath: string): Promise<void>;
  register(module: DiglyModule): void;
  start(): Promise<void>;
  execute(urn: string, input: any, ctx?: any): Promise<any>;
  acquireHold(reason?: string): () => void;
  waitForIdle(): Promise<void>;
}

export enum RuntimeError {
  ERR_RESOURCE_NOT_FOUND = 'ERR_RESOURCE_NOT_FOUND',
  ERR_MODULE_MISSING = 'ERR_MODULE_MISSING',
  ERR_DUPLICATE_RESOURCE = 'ERR_DUPLICATE_RESOURCE',
  ERR_EXECUTION_FAILED = 'ERR_EXECUTION_FAILED',
}

export class DiglyRuntimeError extends Error {
  constructor(
    public code: RuntimeError,
    message: string,
  ) {
    super(message);
    this.name = 'DiglyRuntimeError';
  }
}

export interface ModuleConfig {
  source: string;
  config?: Record<string, any>;
  manifest?: string; // path to module.yaml, defaults to "module.yaml" in source directory
  name?: string;
}

export interface ModuleLoader {
  loadModule(config: ModuleConfig): Promise<DiglyModule[]>;
}
