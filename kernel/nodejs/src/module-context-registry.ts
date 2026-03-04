import { ModuleContext } from "./evaluation-context.js";

function emptyModuleContext(): ModuleContext {
  return new ModuleContext({}, {}, {});
}

/**
 * Per-module ModuleContext store, keyed by module name.
 *
 * Accumulates variables, secrets, and resources for each module during the
 * initialization phase. Imported modules are stored under resources.<alias>
 * alongside local resources. Used by the kernel to build the flat CEL
 * evaluation context for resources within a module.
 */
export class ModuleContextRegistry {
  private readonly store = new Map<
    string,
    {
      variables: Record<string, unknown>;
      secrets: Record<string, unknown>;
      resources: Record<string, unknown>;
    }
  >();

  /** Module names explicitly declared via a kind: Kernel.Module manifest. */
  private readonly declaredModules = new Set<string>();

  /** Per-declaring-module map of import alias → real module name. */
  private readonly aliasToModule = new Map<string, Map<string, string>>();

  /**
   * Mark a module name as declared. Called by the kernel whenever a
   * kind: Kernel.Module manifest is registered so that getContext() can
   * distinguish "not yet populated" (valid during multi-pass init) from
   * "completely unknown module name" (always an error).
   */
  declareModule(moduleName: string): void {
    this.declaredModules.add(moduleName);
  }

  private getOrCreate(moduleName: string) {
    if (!this.store.has(moduleName)) {
      this.store.set(moduleName, {
        variables: {},
        secrets: {},
        resources: {},
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
   * Record that `alias` in `declaringModule` refers to `targetModule`.
   * Called by the Import controller so the kernel can resolve alias-prefixed kinds.
   */
  setAliasModule(declaringModule: string, alias: string, targetModule: string): void {
    let aliases = this.aliasToModule.get(declaringModule);
    if (!aliases) {
      aliases = new Map();
      this.aliasToModule.set(declaringModule, aliases);
    }
    aliases.set(alias, targetModule);
  }

  /**
   * Return the real module name for `alias` in `declaringModule`, or undefined.
   */
  resolveAlias(declaringModule: string, alias: string): string | undefined {
    return this.aliasToModule.get(declaringModule)?.get(alias);
  }

  /**
   * Return a ModuleContext for the given module name.
   *
   * If the module has been declared (a kind: Kernel.Module manifest was
   * registered for it) but not yet populated, returns an empty context so
   * the multi-pass init loop can retry once the import controller has
   * injected the variables and secrets.
   *
   * If the module name is completely unknown — i.e. no kind: Kernel.Module
   * manifest was ever registered for it — throws immediately so the error
   * surfaces as an init failure rather than a cryptic CEL "Identifier not
   * found" message at runtime.
   */
  getContext(moduleName: string): ModuleContext {
    const entry = this.store.get(moduleName);
    if (!entry) {
      if (!this.declaredModules.has(moduleName)) {
        const known = [...this.declaredModules].join(", ") || "(none)";
        throw new Error(
          `Module '${moduleName}' not found. ` +
          `Check that metadata.module matches a declared module name. ` +
          `Known modules: ${known}.`,
        );
      }
      return emptyModuleContext();
    }
    return new ModuleContext(
      entry.variables,
      entry.secrets,
      entry.resources,
    );
  }

  hasModule(moduleName: string): boolean {
    return this.store.has(moduleName);
  }
}
