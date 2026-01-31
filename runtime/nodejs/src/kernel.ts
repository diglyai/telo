import * as fs from 'fs/promises';
import * as path from 'path';
import { EventBus } from './events';
import {
  evaluateCel,
  expandValue,
  resolveExpressionsInRegistry,
} from './expressions';
import { Loader } from './loader';
import { ModuleLoader } from './module-loader';
import { Registry } from './registry';
import {
  DiglyModule,
  DiglyRuntimeError,
  ExecContext,
  Kernel as IKernel,
  KernelContext,
  ModuleContext,
  ModuleCreateContext,
  ModuleManifest,
  ResourceInstance,
  RuntimeError,
  RuntimeResource,
} from './types';

/**
 * Kernel: Central orchestrator managing lifecycle and message bus
 */
export class Kernel implements IKernel {
  public registry: Map<string, Map<string, RuntimeResource>>;
  public modules: Map<string, DiglyModule> = new Map(); // kind -> module mapping
  public moduleInstances: Map<string, DiglyModule> = new Map(); // name -> module mapping

  private loader: Loader = new Loader();
  private registryImpl: Registry = new Registry();
  private moduleLoader: ModuleLoader = new ModuleLoader();
  private eventBus: EventBus = new EventBus();
  private runtimeConfig: ModuleManifest | null = null;
  private resourceInstances: Map<
    string,
    { resource: RuntimeResource; instance: ResourceInstance }
  > = new Map();
  private resourceEventBuses: Map<string, EventBus> = new Map();
  private holdCount = 0;
  private idleResolvers: Array<() => void> = [];

  constructor() {
    this.registry = this.registryImpl.getAll();
  }

  /**
   * Register a static/built-in module before loading
   */
  registerStaticModule(name: string, module: DiglyModule): void {
    this.moduleLoader.registerStaticModule(name, module);
  }

  /**
   * Load from runtime configuration file
   */
  async loadFromConfig(runtimeYamlPath: string): Promise<void> {
    // Load runtime configuration and resources
    this.runtimeConfig =
      await this.loader.loadRuntimeConfigFile(runtimeYamlPath);
    const resources = await this.loader.loadFromRuntimeConfig(runtimeYamlPath);

    // Register all loaded resources
    for (const resource of resources) {
      this.registryImpl.register(resource);
    }

    resolveExpressionsInRegistry(
      this.registryImpl.getAll(),
      this.runtimeConfig,
    );

    const runtimeDir = path.dirname(runtimeYamlPath);
    const modules = await this.moduleLoader.loadModule({
      source: runtimeDir,
      manifest: runtimeYamlPath,
    });

    await this.compileResources(modules);

    for (const module of modules) {
      this.register(module);
    }

    this.assertAllResourceKindsClaimed();
  }

  /**
   * Phase 1: Load - Ingest files from directory and load runtime config
   * @deprecated Use loadFromConfig instead
   */
  async load(dirPath: string): Promise<void> {
    const runtimeYamlPath = path.join(dirPath, 'runtime.yaml');
    const moduleYamlPath = path.join(dirPath, 'module.yaml');

    if (await this.pathExists(runtimeYamlPath)) {
      await this.loadFromConfig(runtimeYamlPath);
      return;
    }

    if (await this.pathExists(moduleYamlPath)) {
      await this.loadFromConfig(moduleYamlPath);
      return;
    }

    // Fallback to old behavior if no manifest exists
    const resources = await this.loader.loadDirectory(dirPath);
    for (const resource of resources) {
      this.registryImpl.register(resource);
    }
    resolveExpressionsInRegistry(
      this.registryImpl.getAll(),
      this.runtimeConfig,
    );
  } /**
   * Phase 2: Register - Attach module drivers
   */
  register(module: DiglyModule): void {
    console.log(
      `DEBUG: Registering module "${module.name}", constructor: ${module.constructor.name}`,
    );

    // Check if module already registered
    if (this.moduleInstances.has(module.name)) {
      console.log(
        `DEBUG: Module "${module.name}" already registered, skipping`,
      );
      return; // Skip duplicate registration
    }

    console.log(`DEBUG: Adding module "${module.name}" to moduleInstances`);
    // Register module instance
    this.moduleInstances.set(module.name, module);

    // Map each kind to this module
    for (const kind of module.resourceKinds) {
      if (this.modules.has(kind)) {
        throw new Error(
          `Module conflict: Kind "${kind}" is already claimed by module "${this.modules.get(kind)!.name}"`,
        );
      }
      this.modules.set(kind, module);
    }

    // Filter registry for resources matching module's Kinds
    const relevantResources: RuntimeResource[] = [];
    for (const kind of module.resourceKinds) {
      relevantResources.push(...this.registryImpl.getByKind(kind));
    }

    module.onLoad(relevantResources);
  }

  private assertAllResourceKindsClaimed(): void {
    for (const [kind, resources] of this.registryImpl.getAll()) {
      // Skip built-in kinds handled by the kernel itself
      if (kind === 'Runtime.KindDefinition' || kind === 'TemplateDefinition') {
        continue;
      }

      if (!this.modules.has(kind) && resources.size > 0) {
        // Check if this kind is derived from another kind
        const parentKind = this.registryImpl.getParentKind(kind);
        if (parentKind && this.modules.has(parentKind)) {
          // Inherit the parent's module for this derived kind
          const parentModule = this.modules.get(parentKind)!;
          this.modules.set(kind, parentModule);
          console.log(
            `DEBUG: Kind "${kind}" inherits controller from "${parentKind}"`,
          );
        } else {
          throw new DiglyRuntimeError(
            RuntimeError.ERR_MODULE_MISSING,
            `No module registered for Kind: ${kind}`,
          );
        }
      }
    }
  }

  /**
   * Load modules from configuration
   */
  private async loadModulesFromImports(importPaths: string[]): Promise<void> {
    for (const importPath of importPaths) {
      try {
        console.log(`DEBUG: Loading module import:`, importPath);
        const modules = await this.moduleLoader.loadModule({
          source: importPath,
        });
        console.log(`DEBUG: Module loader returned ${modules.length} modules`);
        for (const module of modules) {
          console.log(`DEBUG: About to register module:`, module.name);
          this.register(module);
        }
      } catch (error) {
        throw new DiglyRuntimeError(
          RuntimeError.ERR_MODULE_MISSING,
          `Failed to load module from "${importPath}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Phase 3: Start - Initialize modules
   */
  async start(): Promise<void> {
    const ctx: KernelContext = {
      kernel: this,
      config: this.runtimeConfig || {},
    };

    for (const module of this.moduleInstances.values()) {
      if (module.register) {
        await module.register(this.createModuleContext(module.name));
      }
    }

    await this.eventBus.emit('Runtime.Starting', ctx);
    await this.initializeResources();

    const startPromises = Array.from(this.moduleInstances.values()).map(
      (module) => module.onStart(ctx),
    );
    await Promise.all(startPromises);
    await this.eventBus.emit('Runtime.Started', ctx);
  }

  /**
   * Get runtime configuration
   */
  getRuntimeConfig(): ModuleManifest | null {
    return this.runtimeConfig;
  }

  /**
   * Get module loader for advanced module management
   */
  getModuleLoader(): ModuleLoader {
    return this.moduleLoader;
  }

  async emitRuntimeEvent(event: string, payload?: any): Promise<void> {
    await this.eventBus.emit(event, payload);
  }

  acquireHold(reason?: string): () => void {
    this.holdCount += 1;
    if (this.holdCount === 1) {
      void this.eventBus.emit('Runtime.Blocked', {
        reason,
        count: this.holdCount,
      });
    }
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.holdCount = Math.max(0, this.holdCount - 1);
      if (this.holdCount === 0) {
        const resolvers = this.idleResolvers.splice(0);
        for (const resolve of resolvers) {
          resolve();
        }
        void this.eventBus.emit('Runtime.Unblocked', { count: this.holdCount });
      }
    };
  }

  waitForIdle(): Promise<void> {
    if (this.holdCount === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  async emitResourceEvent(
    kind: string,
    name: string,
    event: string,
    payload?: any,
  ): Promise<void> {
    this.assertResourceEventAllowed(event);
    const bus = this.getResourceEventBus(kind, name);
    await bus.emit(`${kind}.${event}`, payload);
  }

  getModuleContext(moduleName: string): ModuleContext {
    return this.createModuleContext(moduleName);
  }

  hasEventHandlers(event: string): boolean {
    return this.eventBus.hasHandlers(event);
  }

  hasResourceInstances(): boolean {
    return this.resourceInstances.size > 0;
  }

  async teardownResources(): Promise<void> {
    const entries = Array.from(this.resourceInstances.entries());
    for (const [key, entry] of entries) {
      const { resource, instance } = entry;
      if (instance.teardown) {
        await instance.teardown();
      }
      await this.eventBus.emit(`${resource.kind}.Teardown`, {
        resource,
        instance,
        kernel: this,
      });
      this.resourceInstances.delete(key);
      this.resourceEventBuses.delete(key);
    }
  }

  private createModuleContext(moduleName: string): ModuleContext {
    return {
      on: (event: string, handler: (payload?: any) => void | Promise<void>) =>
        this.eventBus.on(event, handler),
      once: (event: string, handler: (payload?: any) => void | Promise<void>) =>
        this.eventBus.once(event, handler),
      off: (event: string, handler: (payload?: any) => void | Promise<void>) =>
        this.eventBus.off(event, handler),
      emit: (event: string, payload?: any) => {
        const namespaced = event.includes('.')
          ? event
          : `${moduleName}.${event}`;
        void this.eventBus.emit(namespaced, payload);
      },
      acquireHold: (reason?: string) => this.acquireHold(reason),
      evaluateCel: (expression: string, context: Record<string, any>) =>
        evaluateCel(expression, context),
      expandValue: (value: any, context: Record<string, any>) =>
        expandValue(value, context),
    };
  }

  private createModuleCreateContext(moduleName: string): ModuleCreateContext {
    return {
      ...this.createModuleContext(moduleName),
      kernel: this,
      getResources: (kind: string) => this.registryImpl.getByKind(kind),
      onResourceEvent: (kind: string, name: string, event: string, handler) => {
        this.assertResourceEventAllowed(event);
        this.getResourceEventBus(kind, name).on(`${kind}.${event}`, handler);
      },
      onceResourceEvent: (
        kind: string,
        name: string,
        event: string,
        handler,
      ) => {
        this.assertResourceEventAllowed(event);
        this.getResourceEventBus(kind, name).once(`${kind}.${event}`, handler);
      },
      offResourceEvent: (
        kind: string,
        name: string,
        event: string,
        handler,
      ) => {
        this.assertResourceEventAllowed(event);
        this.getResourceEventBus(kind, name).off(`${kind}.${event}`, handler);
      },
      emitResourceEvent: (
        kind: string,
        name: string,
        event: string,
        payload?: any,
      ) => this.emitResourceEvent(kind, name, event, payload),
    };
  }

  private async initializeResources(): Promise<void> {
    // Phase 1: Create all resource instances
    for (const module of this.moduleInstances.values()) {
      if (!module.create) {
        continue;
      }
      for (const kind of module.resourceKinds) {
        const resources = this.registryImpl.getByKind(kind);
        for (const resource of resources) {
          const key = this.getResourceKey(kind, resource.metadata.name);
          if (this.resourceInstances.has(key)) {
            continue;
          }
          this.ensureResourceEventBus(kind, resource.metadata.name);
          const instance = await module.create(
            resource,
            this.createModuleCreateContext(module.name),
          );
          if (!instance) {
            this.resourceEventBuses.delete(key);
            continue;
          }
          this.resourceInstances.set(key, { resource, instance });
        }
      }
    }

    // Phase 2: Initialize all resource instances
    for (const [key, { resource, instance }] of this.resourceInstances) {
      if (instance.init) {
        await instance.init();
      }
      await this.eventBus.emit(`${resource.kind}.Initialized`, {
        resource,
        instance,
        kernel: this,
      });
    }
  }

  /**
   * Execute - Synchronous dispatcher routing execution requests
   */
  async execute(urn: string, input: any, ctx?: any): Promise<any> {
    const [kind, name] = this.parseUrn(urn);

    // Lookup resource
    const resource = this.registryImpl.get(kind, name);
    if (!resource) {
      throw new DiglyRuntimeError(
        RuntimeError.ERR_RESOURCE_NOT_FOUND,
        `Resource not found: ${urn}`,
      );
    }

    // Find module for this Kind
    const module = this.modules.get(kind);
    if (!module) {
      throw new DiglyRuntimeError(
        RuntimeError.ERR_MODULE_MISSING,
        `No module registered for Kind: ${kind}`,
      );
    }

    // Create execution context with recursive execute capability
    const execContext: ExecContext = {
      execute: (nestedUrn: string, nestedInput: any) =>
        this.execute(nestedUrn, nestedInput, ctx),
      ...ctx,
    };

    try {
      return await module.execute(name, input, execContext);
    } catch (error) {
      throw new DiglyRuntimeError(
        RuntimeError.ERR_EXECUTION_FAILED,
        `Execution failed for ${urn}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private parseUrn(urn: string): [string, string] {
    const separator = urn.lastIndexOf('.');
    if (separator <= 0 || separator === urn.length - 1) {
      throw new Error(
        `Invalid URN format: ${urn}. Expected "Kind.Name" where Kind can include dots`,
      );
    }
    const kind = urn.slice(0, separator);
    const name = urn.slice(separator + 1);
    return [kind, name];
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  private getResourceKey(kind: string, name: string): string {
    return `${kind}.${name}`;
  }

  private ensureResourceEventBus(kind: string, name: string): EventBus {
    const key = this.getResourceKey(kind, name);
    const existing = this.resourceEventBuses.get(key);
    if (existing) {
      return existing;
    }
    const bus = new EventBus();
    this.resourceEventBuses.set(key, bus);
    return bus;
  }

  private getResourceEventBus(kind: string, name: string): EventBus {
    const key = this.getResourceKey(kind, name);
    const bus = this.resourceEventBuses.get(key);
    if (!bus) {
      throw new Error(`Resource instance not found: ${kind}.${name}`);
    }
    return bus;
  }

  private async compileResources(modules: DiglyModule[]): Promise<void> {
    for (const module of modules) {
      if (!module.compile) {
        continue;
      }
      const ctx = this.createModuleCreateContext(module.name);
      for (const kind of module.resourceKinds) {
        const resources = this.registryImpl.getByKind(kind);
        for (const resource of resources) {
          const compiled = await module.compile(resource, ctx);
          if (!compiled) {
            continue;
          }
          if (compiled.kind !== resource.kind) {
            throw new Error(
              `Compile changed resource kind from ${resource.kind} to ${compiled.kind}`,
            );
          }
          if (compiled.metadata?.name !== resource.metadata.name) {
            throw new Error(
              `Compile changed resource name from ${resource.metadata.name} to ${compiled.metadata?.name}`,
            );
          }
          const kindMap = this.registryImpl.getAll().get(kind);
          if (kindMap) {
            kindMap.set(resource.metadata.name, compiled);
          }
        }
      }
    }
  }

  private assertResourceEventAllowed(event: string): void {
    const parts = event.split('.');
    const leaf = parts[parts.length - 1];
    if (leaf === 'Initialized' || leaf === 'Teardown') {
      throw new Error(
        `Resource events cannot use reserved lifecycle event: ${leaf}`,
      );
    }
  }
}
