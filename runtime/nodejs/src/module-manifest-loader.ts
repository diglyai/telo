import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';
import * as path from 'path';
import {
  formatAjvErrors,
  validateModuleManifest,
  validateResourceDefinition,
} from './manifest-schemas';
import {
  DiglyRuntimeError,
  ModuleDiscoveryResult,
  ModuleManifest,
  ResourceDefinition,
  RuntimeError,
} from './types';

/**
 * ModuleManifestLoader: Loads module manifests and resource definitions
 */
export class ModuleManifestLoader {
  /**
   * Load module manifest from module.yaml
   */
  async loadModuleManifest(moduleDir: string, manifestPath?: string): Promise<ModuleManifest> {
    const manifestFile = manifestPath || path.join(moduleDir, 'module.yaml');

    try {
      const content = await fs.readFile(manifestFile, 'utf-8');
      const manifest = yaml.load(content) as ModuleManifest;

      if (!validateModuleManifest(manifest)) {
        throw new Error(
          `Invalid module.yaml format: ${formatAjvErrors(validateModuleManifest.errors)}`,
        );
      }

      return manifest;
    } catch (error) {
      throw new DiglyRuntimeError(
        RuntimeError.ERR_MODULE_MISSING,
        `Failed to load module manifest from ${manifestFile}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Load resource definitions from module manifest (direct resources only, no imports)
   */
  async loadResourceDefinitions(
    moduleDir: string,
    manifest: ModuleManifest,
  ): Promise<ResourceDefinition[]> {
    return this.loadDirectResourceDefinitions(moduleDir, manifest);
  }

  /**
   * Discover all modules including imports - returns main module and imported modules separately
   */
  async discoverModules(
    moduleDir: string,
    manifest: ModuleManifest,
  ): Promise<ModuleDiscoveryResult> {
    const processedModules = new Set<string>(); // Prevent circular imports
    const importedModules: Array<{
      path: string;
      manifest: ModuleManifest;
      resourceDefinitions: ResourceDefinition[];
    }> = [];

    // Discover imported modules first
    if (manifest.imports) {
      console.log(`DEBUG: Main module has ${manifest.imports.length} imports:`, manifest.imports);
      for (const importPath of manifest.imports) {
        const importedModuleDir = path.resolve(moduleDir, importPath);
        const override = manifest.importEntrypoints?.[importPath];
        console.log(`DEBUG: Discovering imported module from:`, importedModuleDir);
        await this.discoverImportedModulesRecursive(
          importedModuleDir,
          importedModules,
          processedModules,
          override,
        );
      }
    } else {
      console.log(`DEBUG: Main module has no imports`);
    }

    // Load main module definitions
    const mainResourceDefinitions = await this.loadDirectResourceDefinitions(moduleDir, manifest);

    return {
      mainModule: {
        manifest,
        resourceDefinitions: mainResourceDefinitions,
      },
      importedModules,
    };
  }

  /**
   * Recursively discover imported modules
   */
  private async discoverImportedModulesRecursive(
    moduleDir: string,
    importedModules: Array<{
      path: string;
      manifest: ModuleManifest;
      resourceDefinitions: ResourceDefinition[];
    }>,
    processedModules: Set<string>,
    entrypointsOverride?: Array<{ runtime: string; entrypoint: string }>,
  ): Promise<void> {
    console.log(`DEBUG: Loading imported module manifest from:`, moduleDir);
    const manifest = await this.loadModuleManifest(moduleDir);

    if (entrypointsOverride) {
      manifest.entrypoints = entrypointsOverride;
    }

    // Prevent circular imports
    if (processedModules.has(manifest.name)) {
      console.log(`DEBUG: Module ${manifest.name} already processed, skipping`);
      return;
    }
    processedModules.add(manifest.name);

    // Recursively process nested imports
    if (manifest.imports) {
      for (const importPath of manifest.imports) {
        const nestedImportDir = path.resolve(moduleDir, importPath);
        const override = manifest.importEntrypoints?.[importPath];
        await this.discoverImportedModulesRecursive(
          nestedImportDir,
          importedModules,
          processedModules,
          override,
        );
      }
    }

    // Load this module's definitions
    console.log(`DEBUG: Loading resource definitions for imported module ${manifest.name}`);
    const resourceDefinitions = await this.loadDirectResourceDefinitions(moduleDir, manifest);
    console.log(
      `DEBUG: Loaded ${resourceDefinitions.length} resource definitions:`,
      resourceDefinitions.map((def) => def.metadata.resourceKind),
    );

    importedModules.push({
      path: moduleDir,
      manifest,
      resourceDefinitions,
    });
    console.log(`DEBUG: Added imported module ${manifest.name} to results`);
  }

  /**
   * Load resource definitions from a single module (no imports)
   */
  private async loadDirectResourceDefinitions(
    moduleDir: string,
    manifest: ModuleManifest,
  ): Promise<ResourceDefinition[]> {
    const definitions: ResourceDefinition[] = [];

    if (!manifest.definitions || manifest.definitions.length === 0) {
      return definitions;
    }

    for (const defPath of manifest.definitions) {
      const fullPath = path.resolve(moduleDir, defPath);
      const loadedDefinitions = await this.loadResourceDefinition(fullPath);
      definitions.push(...loadedDefinitions);
    }

    return definitions;
  }

  /**
   * Load a single resource definition file
   */
  private async loadResourceDefinition(filePath: string): Promise<ResourceDefinition[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const documents = yaml.loadAll(content);
      const definitions: ResourceDefinition[] = [];

      for (const doc of documents) {
        const definition = doc as ResourceDefinition;
        if (!definition || definition.kind !== 'ResourceDefinition') {
          continue;
        }

        if (!validateResourceDefinition(definition)) {
          throw new Error(
            `Invalid ResourceDefinition format: ${formatAjvErrors(validateResourceDefinition.errors)}`,
          );
        }

        definitions.push(definition);
      }

      return definitions;
    } catch (error) {
      throw new DiglyRuntimeError(
        RuntimeError.ERR_MODULE_MISSING,
        `Failed to load resource definition from ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Validation handled by TypeBox + Ajv schemas.
}
