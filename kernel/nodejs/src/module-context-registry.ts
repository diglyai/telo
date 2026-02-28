import { ModuleContext } from "./evaluation-context.js";

const EMPTY: Readonly<Record<string, unknown>> = Object.freeze({});

function emptyModuleContext(): ModuleContext {
  return new ModuleContext({}, {}, {}, {});
}

/**
 * Per-module ModuleContext store, keyed by module name.
 *
 * Accumulates variables, secrets, resources, and imports for each module
 * during the initialization phase. Used by the kernel to build the flat
 * CEL evaluation context for resources within a module.
 */
export class ModuleContextRegistry {
  private readonly store = new Map<
    string,
    {
      variables: Record<string, unknown>;
      secrets: Record<string, unknown>;
      resources: Record<string, unknown>;
      imports: Record<string, unknown>;
    }
  >();

  private getOrCreate(moduleName: string) {
    if (!this.store.has(moduleName)) {
      this.store.set(moduleName, {
        variables: {},
        secrets: {},
        resources: {},
        imports: {},
      });
    }
    return this.store.get(moduleName)!;
  }

  /**
   * Register variables and secrets for a module.
   * Called by the kernel after a Kernel.Module resource is created.
   */
  setVariablesAndSecrets(
    moduleName: string,
    variables: Record<string, unknown>,
    secrets: Record<string, unknown>,
  ): void {
    const entry = this.getOrCreate(moduleName);
    entry.variables = { ...variables };
    entry.secrets = { ...secrets };
  }

  /**
   * Register or update a single resource's exported properties in the
   * module's `resources` namespace.
   */
  setResource(
    moduleName: string,
    resourceName: string,
    props: Record<string, unknown>,
  ): void {
    const entry = this.getOrCreate(moduleName);
    entry.resources = { ...entry.resources, [resourceName]: props };
  }

  /**
   * Register or update an imported module's exported properties under an alias
   * in the module's `imports` namespace. Called by the Import controller.
   */
  setImport(
    moduleName: string,
    alias: string,
    exports: Record<string, unknown>,
  ): void {
    const entry = this.getOrCreate(moduleName);
    entry.imports = { ...entry.imports, [alias]: exports };
  }

  /**
   * Return a ModuleContext for the given module name.
   * Returns an empty ModuleContext if the module has not been registered yet
   * (first-pass scenario — resources will retry in subsequent passes).
   */
  getContext(moduleName: string): ModuleContext {
    const entry = this.store.get(moduleName);
    if (!entry) {
      return emptyModuleContext();
    }
    return new ModuleContext(
      entry.variables,
      entry.secrets,
      entry.resources,
      entry.imports,
    );
  }

  hasModule(moduleName: string): boolean {
    return this.store.has(moduleName);
  }
}
