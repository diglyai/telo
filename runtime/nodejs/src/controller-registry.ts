import { RuntimeResource } from '@diglyai/sdk';
import * as path from 'path';
import { ControllerInstance, ResourceDefinition } from './types';

/**
 * ControllerRegistry: Manages controller loading and dispatch
 * Maps fully-qualified resource kinds to their controller implementations
 */
export class ControllerRegistry {
  private controllersByKind: Map<string, ControllerInstance> = new Map();
  private definitionsByKind: Map<string, ResourceDefinition> = new Map();
  private controllerLoaders: Map<string, () => Promise<ControllerInstance>> =
    new Map();

  /**
   * Register a controller definition
   */
  registerDefinition(
    definition: ResourceDefinition,
    baseDir?: string,
    namespace?: string | null,
  ): void {
    // Construct fully qualified kind: Namespace.ResourceKind
    // Only add namespace if resourceKind is not already qualified (doesn't contain a dot)
    const resourceKind = definition.metadata.resourceKind;
    const kind =
      namespace && !resourceKind.includes('.')
        ? `${namespace}.${resourceKind}`
        : resourceKind;

    this.definitionsByKind.set(kind, definition);

    // If definition has controllers, register loader for them
    if (
      definition.controllers &&
      definition.controllers.length > 0 &&
      baseDir
    ) {
      this.registerControllerLoader(kind, definition, baseDir);
    }
  }

  /**
   * Get a controller instance for a kind
   * Lazy-loads controller code on first access
   * Throws if controller not found
   */
  getController(kind: string): ControllerInstance {
    // Return cached instance if available
    if (this.controllersByKind.has(kind)) {
      return this.controllersByKind.get(kind)!;
    }

    // Load controller if loader is registered
    // const loader = this.controllerLoaders.get(kind);
    // if (loader) {
    //   const controller = await loader();
    //   this.controllersByKind.set(kind, controller);
    //   return controller;
    // }

    throw new Error(`No controller registered for kind: ${kind}`);
  }

  /**
   * Safe get - returns undefined if controller not found
   */
  getControllerOrUndefined(kind: string): ControllerInstance | undefined {
    // Return cached instance if available
    if (this.controllersByKind.has(kind)) {
      return this.controllersByKind.get(kind);
    }
    return undefined;
  }

  /**
   * Check if a controller exists for this kind (definition or directly registered)
   */
  hasController(kind: string): boolean {
    return this.controllersByKind.has(kind) || this.definitionsByKind.has(kind);
  }

  /**
   * Get definition for a kind
   */
  getDefinition(kind: string): ResourceDefinition | undefined {
    return this.definitionsByKind.get(kind);
  }

  /**
   * Get all registered kinds
   */
  getKinds(): string[] {
    return Array.from(this.definitionsByKind.keys());
  }

  getControllerKinds(): string[] {
    return Array.from(this.controllersByKind.keys());
  }

  /**
   * Load all registered controller loaders
   * Call this after all definitions are registered but before execution
   */
  async loadAllControllers(): Promise<void> {
    const kinds = Array.from(this.controllerLoaders.keys());
    for (const kind of kinds) {
      console.log(`Loading controller for kind: ${kind}`);
      if (!this.controllersByKind.has(kind)) {
        const loader = this.controllerLoaders.get(kind);
        if (loader) {
          try {
            const controller = await loader();
            this.controllersByKind.set(kind, controller);
          } catch (error) {
            throw new Error(
              `Failed to load controller for kind "${kind}": ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    }
  }

  /**
   * Execute a resource using its controller
   */
  async execute(
    kind: string,
    name: string,
    input: any,
    ctx: any,
    resource?: RuntimeResource,
  ): Promise<any> {
    const controller = this.getController(kind);
    if (!controller || !controller.execute) {
      throw new Error(`No execute handler for kind: ${kind}`);
    }
    return controller.execute(name, input, { ...ctx, resource });
  }

  /**
   * Compile a resource using its controller
   */
  async compile(
    kind: string,
    resource: RuntimeResource,
    ctx: any,
  ): Promise<RuntimeResource> {
    const controller = await this.getController(kind);
    if (!controller || !controller.compile) {
      return resource;
    }
    return controller.compile(resource, ctx);
  }

  /**
   * Create a resource instance using its controller
   */
  async create(
    kind: string,
    resource: RuntimeResource,
    ctx: any,
  ): Promise<any | null> {
    const controller = await this.getController(kind);
    if (!controller || !controller.create) {
      return null;
    }
    return controller.create(resource, ctx);
  }

  /**
   * Register a controller for a kind
   */
  registerController(kind: string, controller: ControllerInstance): void {
    this.controllersByKind.set(kind, controller);
  }

  /**
   * Private: Register controller loader
   */
  private registerControllerLoader(
    kind: string,
    definition: ResourceDefinition,
    moduleDir: string,
  ): void {
    const controllerDef = definition.controllers?.[0]; // Use first matching controller for now
    if (!controllerDef) return;

    this.controllerLoaders.set(kind, async () => {
      const modulePath = path.resolve(moduleDir, controllerDef.entrypoint);
      const moduleRuntime = await import(modulePath);
      const exported =
        moduleRuntime.default || moduleRuntime.Module || moduleRuntime;

      const registerFn =
        typeof moduleRuntime.register === 'function'
          ? moduleRuntime.register
          : typeof exported === 'function' && !this.isModuleClass(exported)
            ? exported
            : null;

      const createFn =
        typeof moduleRuntime.create === 'function'
          ? moduleRuntime.create
          : typeof exported?.create === 'function'
            ? exported.create
            : null;

      const executeFn =
        typeof moduleRuntime.execute === 'function'
          ? moduleRuntime.execute
          : typeof exported?.execute === 'function'
            ? exported.execute
            : null;

      const compileFn =
        typeof moduleRuntime.compile === 'function'
          ? moduleRuntime.compile
          : typeof exported?.compile === 'function'
            ? exported.compile
            : null;

      if (!registerFn && !executeFn && !createFn && !compileFn) {
        throw new Error(`Controller for "${kind}" exports no usable handlers`);
      }

      return {
        register: registerFn ?? undefined,
        create: createFn ?? undefined,
        execute: executeFn ?? undefined,
        compile: compileFn ?? undefined,
      };
    });
  }

  private isModuleClass(obj: any): boolean {
    return (
      typeof obj === 'function' &&
      (obj.name === 'Controller' || obj.toString().includes('class'))
    );
  }
}
