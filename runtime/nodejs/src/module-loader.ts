import * as path from 'path';
import { ModuleManifestLoader } from './module-manifest-loader';
import {
  DiglyModule,
  DiglyRuntimeError,
  ModuleConfig,
  ModuleManifest,
  ResourceDefinition,
  RuntimeError,
  RuntimeResource,
} from './types';

/**
 * ModuleLoader: Handles loading of both static and dynamic modules
 */
export class ModuleLoader {
  private staticModules: Map<string, DiglyModule> = new Map();
  private loadedModules: Map<string, DiglyModule[]> = new Map();
  private manifestLoader = new ModuleManifestLoader();

  /**
   * Register a static/built-in module
   */
  registerStaticModule(name: string, module: DiglyModule): void {
    this.staticModules.set(name, module);
  }

  /**
   * Load module based on configuration
   */
  async loadModule(config: ModuleConfig): Promise<DiglyModule[]> {
    const moduleDir = this.resolveModuleDir(config.source);
    const manifest = await this.manifestLoader.loadModuleManifest(moduleDir, config.manifest);
    if (!config.name) {
      config.name = manifest.name;
    }
    const moduleName = this.getModuleName(config);

    console.log(`DEBUG: Loading module "${moduleName}" from "${config.source}"`);

    // Check if already loaded
    if (this.loadedModules.has(moduleName)) {
      console.log(`DEBUG: Module "${moduleName}" already in cache`);
      return this.loadedModules.get(moduleName)!;
    }

    // Check if it's a static module
    if (this.staticModules.has(moduleName)) {
      return await this.loadStaticModuleWithImports(config);
    }

    // Load as dynamic module and cache it
    console.log(`DEBUG: Loading dynamic module "${moduleName}"`);
    const modules = await this.loadDynamicModuleWithImports(config);
    return modules;
  }

  /**
   * Load static module and handle its imports
   */
  private async loadStaticModuleWithImports(config: ModuleConfig): Promise<DiglyModule[]> {
    const moduleName = this.getModuleName(config);
    console.log(`DEBUG: Module "${moduleName}" is static`);
    const moduleInstance = this.staticModules.get(moduleName)!;
    const modules: DiglyModule[] = [];

    // If we have a source config, try to load manifest and imports
    if (config.source) {
      try {
        let moduleDir = this.resolveModuleDir(config.source);

        console.log(`DEBUG: Discovering modules from "${moduleDir}"`);
        const manifest = await this.manifestLoader.loadModuleManifest(moduleDir, config.manifest);
        console.log(`DEBUG: Main module manifest loaded:`, manifest);
        const discovery = await this.manifestLoader.discoverModules(moduleDir, manifest);
        console.log(
          `DEBUG: Discovery result - imported modules count:`,
          discovery.importedModules.length,
        );
        for (const imported of discovery.importedModules) {
          console.log(
          `DEBUG: Found imported module:`,
            imported.manifest.name,
            'with resource kinds:',
            imported.resourceDefinitions.map((def) =>
              this.qualifyResourceKind(imported.manifest, def.metadata.resourceKind),
            ),
          );
        }

        const { controllerModules, fallbackDefinitions } = this.createControllerModules(
          discovery.mainModule.resourceDefinitions,
          manifest,
          moduleDir,
        );
        modules.push(...controllerModules);

        // Enhance main module
        moduleInstance.manifest = discovery.mainModule.manifest;
        moduleInstance.resourceKinds = fallbackDefinitions.map((def) =>
          this.qualifyResourceKind(manifest, def.metadata.resourceKind),
        );
        console.log(
          `DEBUG: Static module "${moduleName}" enhanced with resource kinds:`,
          moduleInstance.resourceKinds,
        );
        if (moduleInstance.resourceKinds.length > 0) {
          modules.push(moduleInstance);
        }

        // Create module instances for imported modules
        console.log(
          `DEBUG: Creating ${discovery.importedModules.length} imported module instances`,
        );
          for (const importedModule of discovery.importedModules) {
            const importedInstances = this.createImportedModuleInstance(importedModule);
            modules.push(...importedInstances);
            console.log(
              `DEBUG: Created imported module "${importedInstances[0]?.name}" with resource kinds:`,
            importedInstances.map((moduleItem) => moduleItem.resourceKinds).flat(),
            );
          }
      } catch (error) {
        console.log(
          `DEBUG: Could not load manifest for static module "${moduleName}":`,
          error instanceof Error ? error.message : String(error),
        );
        // Continue with static module as-is
      }
    }

    if (modules.length === 0) {
      modules.push(moduleInstance);
    }

    // Cache the module
    this.loadedModules.set(moduleName, modules);
    return modules;
  }

  /**
   * Load dynamic module and handle its imports
   */
  private async loadDynamicModuleWithImports(config: ModuleConfig): Promise<DiglyModule[]> {
    const moduleName = this.getModuleName(config);
    const { modules, manifest, moduleDir } = await this.loadDynamicModule(config);
    console.log(`DEBUG: Dynamic module loaded, count: ${modules.length}`);
    this.loadedModules.set(moduleName, modules);

    // Try to discover and load imports for dynamic modules
    if (config.source) {
      try {
        console.log(`DEBUG: Discovering imports for dynamic module from "${moduleDir}"`);
        if (manifest && manifest.imports) {
          console.log(
            `DEBUG: Dynamic module has ${manifest.imports.length} imports:`,
            manifest.imports,
          );
          const discovery = await this.manifestLoader.discoverModules(moduleDir, manifest);

          // Create module instances for imported modules
          console.log(
          `DEBUG: Creating ${discovery.importedModules.length} imported module instances for dynamic module`,
          );
          for (const importedModule of discovery.importedModules) {
            const importedInstances = this.createImportedModuleInstance(importedModule);
            modules.push(...importedInstances);
            console.log(
              `DEBUG: Created imported module "${importedInstances[0]?.name}" with resource kinds:`,
              importedInstances.map((moduleItem) => moduleItem.resourceKinds).flat(),
            );
          }
        } else {
          console.log(`DEBUG: Dynamic module has no imports or no manifest`);
        }
      } catch (error) {
        throw error;
      }
    }

    return modules;
  }

  /**
   * Load dynamic module from source
   */
  private async loadDynamicModule(config: ModuleConfig): Promise<{
    modules: DiglyModule[];
    manifest: ModuleManifest;
    moduleDir: string;
  }> {
    const moduleName = this.getModuleName(config);
    try {
      // Resolve the module source and directory
      let modulePath = config.source;
      let moduleDir = config.source;

      // If source doesn't start with . or /, treat as npm package
      if (!config.source.startsWith('.') && !path.isAbsolute(config.source)) {
        // For npm packages, require will handle resolution
        modulePath = config.source;
        // For npm packages, we need to resolve the actual directory
        try {
          const resolvedPath = require.resolve(config.source);
          moduleDir = path.dirname(resolvedPath);
        } catch {
          moduleDir = config.source; // fallback
        }
      } else {
        // For local paths, resolve relative to current working directory
        modulePath = path.resolve(config.source);
        moduleDir = modulePath;
      }

      // Load module manifest first
      console.log(`DEBUG: Loading manifest from "${moduleDir}"`);
      const manifest = await this.manifestLoader.loadModuleManifest(moduleDir, config.manifest);
      const resourceDefinitions = await this.manifestLoader.loadResourceDefinitions(
        moduleDir,
        manifest,
      );

      const { controllerModules, fallbackDefinitions } = this.createControllerModules(
        resourceDefinitions,
        manifest,
        moduleDir,
      );

      const fallbackKinds = fallbackDefinitions.map((def) =>
        this.qualifyResourceKind(manifest, def.metadata.resourceKind),
      );
      console.log(`DEBUG: Module "${moduleName}" will handle resource kinds:`, fallbackKinds);

      const modules: DiglyModule[] = [...controllerModules];

      if (fallbackKinds.length > 0) {
        if (!manifest.entrypoint && (!manifest.entrypoints || manifest.entrypoints.length === 0)) {
          modules.push(this.createManifestOnlyModule(manifest, fallbackKinds));
        } else {
          const moduleInstance = this.createLazyRegisterModule(manifest, fallbackKinds, moduleDir);
          modules.push(moduleInstance);
        }
      }

      return { modules, manifest, moduleDir };
    } catch (error) {
      // Provide more helpful error messages
      let errorMessage = `Failed to load module "${moduleName}" from "${config.source}"`;

      if (error instanceof Error) {
        if (error.message.includes('Cannot find module')) {
          errorMessage += `: Module not found. Make sure the package is installed or the path is correct.`;
          if (!config.source.startsWith('.') && !path.isAbsolute(config.source)) {
            errorMessage += ` For npm packages, run: npm install ${config.source}`;
          }
        } else {
          errorMessage += `: ${error.message}`;
        }
      } else {
        errorMessage += `: ${String(error)}`;
      }

      throw new DiglyRuntimeError(RuntimeError.ERR_MODULE_MISSING, errorMessage);
    }
  }

  /**
   * Create a module instance for an imported module
   */
  private createImportedModuleInstance(importedModule: {
    path: string;
    manifest: ModuleManifest;
    resourceDefinitions: ResourceDefinition[];
  }): DiglyModule[] {
    const { controllerModules, fallbackDefinitions } = this.createControllerModules(
      importedModule.resourceDefinitions,
      importedModule.manifest,
      importedModule.path,
    );
    const fallbackKinds = fallbackDefinitions.map((def) =>
      this.qualifyResourceKind(importedModule.manifest, def.metadata.resourceKind),
    );
    const modules: DiglyModule[] = [...controllerModules];

    if (fallbackKinds.length > 0) {
      if (
        importedModule.manifest.entrypoint ||
        (importedModule.manifest.entrypoints &&
          importedModule.manifest.entrypoints.length > 0)
      ) {
        modules.push(
          this.createLazyRegisterModule(
            importedModule.manifest,
            fallbackKinds,
            importedModule.path,
          ),
        );
      } else {
        modules.push(this.createManifestOnlyModule(importedModule.manifest, fallbackKinds));
      }
    }

    return modules;
  }

  private createControllerModules(
    resourceDefinitions: ResourceDefinition[],
    manifest: ModuleManifest,
    moduleDir: string,
  ): { controllerModules: DiglyModule[]; fallbackDefinitions: ResourceDefinition[] } {
    const controllerModules: DiglyModule[] = [];
    const fallbackDefinitions: ResourceDefinition[] = [];

    for (const definition of resourceDefinitions) {
      if (definition.controllers && definition.controllers.length > 0) {
        controllerModules.push(this.createControllerModule(manifest, definition, moduleDir));
      } else {
        fallbackDefinitions.push(definition);
      }
    }

    return { controllerModules, fallbackDefinitions };
  }

  private createControllerModule(
    manifest: ModuleManifest,
    definition: ResourceDefinition,
    moduleDir: string,
  ): DiglyModule {
    const resourceKind = this.qualifyResourceKind(manifest, definition.metadata.resourceKind);
    const name = resourceKind;
    const entrypoints = definition.controllers || [];
    type LoadedController = {
      register?: (ctx: any) => void | Promise<void>;
      create?: (resource: any, ctx: any) => any;
      execute?: (name: string, inputs: any, ctx: any) => any;
      compile?: (resource: any, ctx: any) => any;
    };
    let loaded: LoadedController | null = null;
    const resourcesByName: Map<string, RuntimeResource> = new Map();

    const loadController = async (): Promise<LoadedController> => {
      if (loaded) {
        return loaded;
      }
      const resolvedEntrypoint = this.resolveControllerEntrypoint(entrypoints);
      if (!resolvedEntrypoint) {
        throw new Error(`Entrypoint is missing for controller "${name}"`);
      }
      const modulePath = path.resolve(moduleDir, resolvedEntrypoint);
      const moduleRuntime = await import(modulePath);
      const exported = moduleRuntime.default || moduleRuntime.Module || moduleRuntime;
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
        throw new Error(`Controller "${name}" exports no usable handlers`);
      }
      loaded = {
        register: registerFn ?? undefined,
        create: createFn ?? undefined,
        execute: executeFn ?? undefined,
        compile: compileFn ?? undefined,
      };
      return loaded;
    };

    const register = async (ctx: any) => {
      const mod = await loadController();
      await mod.register?.(ctx);
    };

    const create = async (resource: any, ctx: any) => {
      const mod = await loadController();
      assertControllerResourceKind(resourceKind, resource);
      if (!mod.create) {
        return null;
      }
      return await mod.create(resource, ctx);
    };

    const compile = async (resource: any, ctx: any) => {
      const mod = await loadController();
      assertControllerResourceKind(resourceKind, resource);
      if (!mod.compile) {
        return resource;
      }
      return await mod.compile(resource, ctx);
    };

    const assertControllerResourceKind = this.assertControllerResourceKind.bind(this);
    return {
      name,
      manifest,
      resourceKinds: [resourceKind],
      onLoad(resources): void {
        resourcesByName.clear();
        for (const resource of resources) {
          resourcesByName.set(resource.metadata.name, resource);
        }
      },
      async onStart(): Promise<void> {},
      async execute(name: string, inputs: any, ctx: any): Promise<any> {
        const mod = await loadController();
        if (!mod.execute) {
          throw new Error(`${name}: Execution not implemented for ${resourceKind}`);
        }
        const resource = resourcesByName.get(name);
        assertControllerResourceKind(resourceKind, resource, name);
        return await mod.execute(name, inputs, { ...ctx, resource });
      },
      compile,
      register,
      create,
    };
  }

  private createManifestOnlyModule(manifest: ModuleManifest, resourceKinds: string[]): DiglyModule {
    return {
      name: manifest.name,
      manifest,
      resourceKinds,
      onLoad(resources: RuntimeResource[]): void {
        console.log(`${manifest.name}: Loaded ${resources.length} resources`);
      },
      async onStart(): Promise<void> {
        console.log(`${manifest.name}: Started`);
      },
      async execute(name: string): Promise<any> {
        throw new Error(`${manifest.name}: Execution not implemented for ${name}`);
      },
    };
  }

  private createLazyRegisterModule(
    manifest: ModuleManifest,
    resourceKinds: string[],
    moduleDir: string,
  ): DiglyModule {
    type LoadedModule = {
      register?: (ctx: any) => void | Promise<void>;
      create?: (resource: any, ctx: any) => any;
      execute?: (name: string, inputs: any, ctx: any) => any;
      compile?: (resource: any, ctx: any) => any;
    };
    let loaded: LoadedModule | null = null;
    const resourcesByName: Map<string, RuntimeResource> = new Map();

    const loadModule = async (): Promise<LoadedModule> => {
      if (loaded) {
        return loaded;
      }
      const resolvedEntrypoint = this.resolveEntrypoint(manifest);
      if (!resolvedEntrypoint) {
        throw new Error(`Entrypoint is missing for module "${manifest.name}"`);
      }
      const modulePath = path.resolve(moduleDir, resolvedEntrypoint);
      const moduleRuntime = await import(modulePath);
      const exported = moduleRuntime.default || moduleRuntime.Module || moduleRuntime;
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
      if (!registerFn) {
        throw new Error(`Module "${manifest.name}" does not export a register function`);
      }
      loaded = {
        register: registerFn ?? undefined,
        create: createFn ?? undefined,
        execute: executeFn ?? undefined,
        compile: compileFn ?? undefined,
      };
      return loaded;
    };

    const register = async (ctx: any) => {
      const mod = await loadModule();
      await mod.register?.(ctx);
    };

    const create = async (resource: any, ctx: any) => {
      const mod = await loadModule();
      if (!mod.create) {
        return null;
      }
      return await mod.create(resource, ctx);
    };

    const compile = async (resource: any, ctx: any) => {
      const mod = await loadModule();
      if (!mod.compile) {
        return resource;
      }
      return await mod.compile(resource, ctx);
    };

    return {
      name: manifest.name,
      manifest,
      resourceKinds,
      onLoad(resources): void {
        resourcesByName.clear();
        for (const resource of resources) {
          resourcesByName.set(resource.metadata.name, resource);
        }
      },
      async onStart(): Promise<void> {},
      async execute(name: string, inputs: any, ctx: any): Promise<any> {
        const mod = await loadModule();
        if (!mod.execute) {
          throw new Error(`${manifest.name}: Execution not implemented for ${name}`);
        }
        const resource = resourcesByName.get(name);
        return await mod.execute(name, inputs, { ...ctx, resource });
      },
      compile,
      register,
      create,
    };
  }

  private resolveModuleDir(source: string): string {
    if (!source.startsWith('.') && !path.isAbsolute(source)) {
      try {
        const resolvedPath = require.resolve(source);
        return path.dirname(resolvedPath);
      } catch {
        return source;
      }
    }

    return path.resolve(source);
  }

  private assertControllerResourceKind(
    expectedKind: string,
    resource: RuntimeResource | undefined,
    name?: string,
  ): void {
    if (!resource) {
      const label = name ? ` "${name}"` : '';
      throw new Error(`Controller for ${expectedKind} received missing resource${label}`);
    }
    if (resource.kind !== expectedKind) {
      throw new Error(
        `Controller kind mismatch: expected ${expectedKind}, got ${resource.kind}`,
      );
    }
  }

  private qualifyResourceKind(manifest: ModuleManifest, resourceKind: string): string {
    const trimmed = resourceKind?.trim?.() ?? '';
    if (!trimmed) {
      return trimmed;
    }
    if (trimmed.includes('.')) {
      return trimmed;
    }
    return `${manifest.name}.${trimmed}`;
  }

  private getModuleName(config: ModuleConfig): string {
    if (!config.name) {
      throw new Error('Module name is missing');
    }

    return config.name;
  }

  private resolveEntrypoint(manifest: ModuleManifest): string | null {
    if (manifest.entrypoints && manifest.entrypoints.length > 0) {
      const runtime = this.getHostRuntime();
      const preferredOrder = [
        runtime.name,
        ...this.getSupportedRuntimes().filter((name) => name !== runtime.name),
      ];

      for (const name of preferredOrder) {
        const match = manifest.entrypoints.find((entry) => {
          const parsed = this.parseRuntimeSpec(entry.runtime);
          if (!parsed || parsed.name !== name) {
            return false;
          }
          if (name !== runtime.name) {
            return true;
          }
          return this.satisfiesRange(runtime.version, parsed.range);
        });
        if (match) {
          return match.entrypoint;
        }
      }

      const fallback = manifest.entrypoints.find((entry) => {
        const parsed = this.parseRuntimeSpec(entry.runtime);
        return parsed ? this.getSupportedRuntimes().includes(parsed.name) : false;
      });
      if (fallback) {
        return fallback.entrypoint;
      }

      throw new Error(
        `No compatible entrypoint found for runtime "${runtime.name}@${runtime.version}" in module "${manifest.name}"`,
      );
    }

    if (manifest.entrypoint) {
      return manifest.entrypoint;
    }

    return null;
  }

  private resolveControllerEntrypoint(
    entrypoints: Array<{ runtime: string; entrypoint: string }>,
  ): string | null {
    if (!entrypoints || entrypoints.length === 0) {
      return null;
    }

    const runtime = this.getHostRuntime();
    const preferredOrder = [
      runtime.name,
      ...this.getSupportedRuntimes().filter((name) => name !== runtime.name),
    ];

    for (const name of preferredOrder) {
      const match = entrypoints.find((entry) => {
        const parsed = this.parseRuntimeSpec(entry.runtime);
        if (!parsed || parsed.name !== name) {
          return false;
        }
        if (name !== runtime.name) {
          return true;
        }
        return this.satisfiesRange(runtime.version, parsed.range);
      });
      if (match) {
        return match.entrypoint;
      }
    }

    const fallback = entrypoints.find((entry) => {
      const parsed = this.parseRuntimeSpec(entry.runtime);
      return parsed ? this.getSupportedRuntimes().includes(parsed.name) : false;
    });
    if (fallback) {
      return fallback.entrypoint;
    }

    throw new Error(
      `No compatible entrypoint found for runtime "${runtime.name}@${runtime.version}"`,
    );
  }

  private getSupportedRuntimes(): string[] {
    return ['node', 'bun'];
  }

  private getHostRuntime(): { name: string; version: string } {
    if ((process as any).versions?.bun) {
      return { name: 'bun', version: (process as any).versions.bun };
    }
    return { name: 'node', version: process.versions.node };
  }

  private parseRuntimeSpec(value: string): { name: string; range: string | null } | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const atIndex = trimmed.indexOf('@');
    if (atIndex === -1) {
      return { name: trimmed, range: null };
    }
    const name = trimmed.slice(0, atIndex).trim();
    const range = trimmed.slice(atIndex + 1).trim();
    if (!name) {
      return null;
    }
    return { name, range: range.length > 0 ? range : null };
  }

  private isModuleClass(candidate: any): boolean {
    if (typeof candidate !== 'function') {
      return false;
    }
    const proto = candidate.prototype;
    if (!proto || typeof proto !== 'object') {
      return false;
    }
    return (
      typeof proto.onLoad === 'function' &&
      typeof proto.onStart === 'function' &&
      typeof proto.execute === 'function'
    );
  }

  private satisfiesRange(version: string, range: string | null): boolean {
    if (!range) {
      return true;
    }
    const normalized = this.parseVersion(version);
    if (!normalized) {
      return false;
    }
    const parts = range.split(/\s+/).filter(Boolean);
    for (const part of parts) {
      const match = part.match(/^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+){0,2})$/);
      if (!match) {
        continue;
      }
      const op = match[1] || '=';
      const target = this.parseVersion(match[2]);
      if (!target) {
        continue;
      }
      const cmp = this.compareVersion(normalized, target);
      if (op === '>=' && cmp < 0) return false;
      if (op === '<=' && cmp > 0) return false;
      if (op === '>' && cmp <= 0) return false;
      if (op === '<' && cmp >= 0) return false;
      if (op === '=' && cmp !== 0) return false;
    }
    return true;
  }

  private parseVersion(value: string): [number, number, number] | null {
    const match = value.trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!match) {
      return null;
    }
    return [
      Number(match[1]),
      Number(match[2] ?? 0),
      Number(match[3] ?? 0),
    ];
  }

  private compareVersion(a: [number, number, number], b: [number, number, number]): number {
    if (a[0] !== b[0]) return a[0] - b[0];
    if (a[1] !== b[1]) return a[1] - b[1];
    return a[2] - b[2];
  }

  /**
   * Get list of registered static modules
   */
  getStaticModules(): string[] {
    return Array.from(this.staticModules.keys());
  }
}
