import { RuntimeResource } from '@diglyai/sdk';
import { evaluate } from 'cel-js';
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { promisify } from 'util';
import { formatAjvErrors, validateRuntimeResource } from './manifest-schemas';
import { ResourceURI } from './resource-uri';
import { isTemplateDefinition } from './template-definition';
import { instantiateTemplate } from './template-expander';
import { ResourceManifest } from './types';

/**
 * Loader: Ingests resolved YAML manifests from disk into memory
 */
export class Loader {
  private static projectRoot: string | null = null;
  private static npmCacheRoot: string | null = null;

  private static ensureProjectRoot(baseDir: string): void {
    if (!Loader.projectRoot) {
      Loader.projectRoot = path.resolve(baseDir);
      Loader.npmCacheRoot = path.join(
        Loader.projectRoot,
        '.cache',
        'digly',
        'npm',
      );
    }
  }

  async loadDirectory(dirPath: string): Promise<ResourceManifest[]> {
    Loader.ensureProjectRoot(dirPath);
    const resources: RuntimeResource[] = [];
    await this.walkDirectory(dirPath, resources);
    const ordered = this.orderResourcesByKindDependencies(resources);
    return this.expandTemplateInstances(ordered);
  }

  async loadManifest(runtimeYamlPath: string): Promise<ResourceManifest[]> {
    Loader.ensureProjectRoot(path.dirname(runtimeYamlPath));
    const content = await fs.readFile(runtimeYamlPath, 'utf-8');
    const config = yaml.loadAll(content) as ResourceManifest[];

    const resolved: ResourceManifest[] = [];
    for (const manifest of config) {
      const resource: ResourceManifest = {
        ...manifest,
        metadata: {
          ...manifest.metadata,
          source: runtimeYamlPath,
        },
      };
      resolved.push(await this.resolveControllers(resource));
    }
    return resolved;
  }

  private async walkDirectory(
    dirPath: string,
    resources: RuntimeResource[],
  ): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        await this.walkDirectory(fullPath, resources);
      } else if (entry.isFile() && this.isYamlFile(entry.name)) {
        // Skip runtime.yaml as it's reserved for host configuration
        if (entry.name === 'runtime.yaml') {
          continue;
        }
        await this.loadYamlFile(fullPath, resources);
      }
    }
  }

  private isYamlFile(filename: string): boolean {
    return filename.endsWith('.yaml') || filename.endsWith('.yml');
  }

  private async loadYamlFile(
    filePath: string,
    resources: RuntimeResource[],
  ): Promise<void> {
    const content = await fs.readFile(filePath, 'utf-8');
    const documents = yaml.loadAll(content);
    const absolutePath = path.resolve(filePath);

    for (const doc of documents) {
      const resource = this.normalizeResource(doc);
      if (!resource) {
        continue;
      }
      if (!validateRuntimeResource(resource)) {
        const kind = (resource as any).kind;
        const name = (resource as any).metadata?.name;
        throw new Error(
          `Resource validation failed for ${kind}.${name}: ${formatAjvErrors(validateRuntimeResource.errors)}`,
        );
      }

      // Assign URI based on file source
      const { kind, name } = resource.metadata;
      resource.metadata.source = filePath;
      resource.metadata.uri = ResourceURI.fromFile(
        absolutePath,
        kind,
        name,
      ).toString();
      resource.metadata.generationDepth = 0;

      resources.push(await this.resolveControllers(resource));
    }
  }

  private normalizeResource(doc: any): RuntimeResource | null {
    if (!doc || typeof doc !== 'object' || typeof doc.kind !== 'string') {
      return null;
    }

    // Already in correct format
    if (
      doc.metadata &&
      typeof doc.metadata === 'object' &&
      typeof doc.metadata.name === 'string'
    ) {
      return doc as RuntimeResource;
    }

    return null;
  }

  private async resolveControllers(
    resource: RuntimeResource,
  ): Promise<RuntimeResource> {
    const controllers = (resource as any).controllers;
    if (!Array.isArray(controllers) || controllers.length === 0) {
      return resource;
    }

    const sourcePath = (resource as any).metadata?.source;
    const baseDir = sourcePath ? path.dirname(sourcePath) : process.cwd();
    const controllersByRuntime = new Map<string, any[]>();
    for (const controller of controllers) {
      const runtime =
        typeof controller.runtime === 'string' ? controller.runtime : '';
      const group = controllersByRuntime.get(runtime);
      if (group) {
        group.push(controller);
      } else {
        controllersByRuntime.set(runtime, [controller]);
      }
    }

    const resolvedControllers = [];
    for (const [, group] of controllersByRuntime.entries()) {
      const hasLocal = group.some(
        (controller) =>
          controller.registry === 'local' ||
          (controller.registry && controller.registry.startsWith('file://')),
      );
      const candidates = hasLocal
        ? group.filter(
            (controller) =>
              controller.registry === 'local' ||
              (controller.registry && controller.registry.startsWith('file://')),
          )
        : group;

      const sorted = [...candidates].sort((a, b) => {
        const rank = (controller: any) => {
          if (controller.entry && !controller.package && !controller.registry) {
            return 0;
          }
          const registry = controller.registry;
          if (
            registry === 'local' ||
            (registry && registry.startsWith('file://'))
          ) {
            return 1;
          }
          return 2;
        };
        return rank(a) - rank(b);
      });

      let resolved = false;
      let lastError: unknown = null;
      for (const controller of sorted) {
        const packageSpec = controller.package;
        const entry = controller.entry;
        if (!packageSpec || !entry) {
          lastError = new Error(
            `Controller is missing package or entry (runtime=${controller.runtime ?? 'unknown'}, registry=${controller.registry ?? 'default'})`,
          );
          break;
        }

        try {
          const resolvedEntry = await this.resolveControllerEntrypoint(
            controller.registry,
            packageSpec,
            entry,
            baseDir,
          );
          resolvedControllers.push({ ...controller, entry: resolvedEntry });
          resolved = true;
          break;
        } catch (error) {
          const context = `Failed to resolve controller (runtime=${controller.runtime ?? 'unknown'}, registry=${controller.registry ?? 'default'}, package=${packageSpec}, entry=${entry})`;
          const message =
            error instanceof Error ? `${context}: ${error.message}` : context;
          lastError = new Error(message);
        }
      }

      if (!resolved && lastError) {
        throw lastError;
      }
    }

    return {
      ...resource,
      controllers: resolvedControllers,
    } as RuntimeResource;
  }

  private async resolveControllerEntrypoint(
    registry: string | undefined,
    packageSpec: string,
    entry: string,
    baseDir: string,
  ): Promise<string> {
    const npmCacheRoot = Loader.npmCacheRoot;
    if (!npmCacheRoot) {
      throw new Error('NPM cache root is not initialized');
    }

    const isLocal =
      !registry || registry === 'local' || registry.startsWith('file://');
    const resolvedPackageSpec = isLocal
      ? this.resolveLocalPackageSpec(registry, packageSpec, baseDir)
      : packageSpec;
    const registryKey = isLocal
      ? 'local'
      : registry === 'npm'
        ? 'npm'
        : registry;
    const cacheKey = createHash('sha256')
      .update(`${registryKey}|${resolvedPackageSpec}`)
      .digest('hex')
      .slice(0, 12);
    const installDir = path.join(npmCacheRoot, cacheKey);

    const packageName = isLocal
      ? await this.getLocalPackageName(resolvedPackageSpec)
      : this.getPackageName(resolvedPackageSpec);

    await this.ensureNpmPackageInstalled(
      installDir,
      resolvedPackageSpec,
      registryKey,
    );

    const packageRoot = this.getInstalledPackageRoot(installDir, packageName);
    return this.resolvePackageEntry(packageRoot, entry, packageName);
  }

  private resolveLocalPackageSpec(
    registry: string | undefined,
    packageSpec: string,
    baseDir: string,
  ): string {
    if (registry && registry.startsWith('file://')) {
      const registryPath = registry.slice('file://'.length);
      const basePath = path.isAbsolute(registryPath)
        ? registryPath
        : path.resolve(baseDir, registryPath);
      const resolvedPackage = path.isAbsolute(packageSpec)
        ? packageSpec
        : path.resolve(baseDir, packageSpec);
      if (resolvedPackage === basePath) {
        return basePath;
      }
      return path.resolve(basePath, packageSpec);
    }

    return path.resolve(baseDir, packageSpec);
  }

  private async ensureNpmPackageInstalled(
    installDir: string,
    packageSpec: string,
    registry: string,
  ): Promise<void> {
    const packageName = this.getPackageName(
      packageSpec.startsWith('.') || path.isAbsolute(packageSpec)
        ? await this.getLocalPackageName(packageSpec)
        : packageSpec,
    );
    const packageRoot = this.getInstalledPackageRoot(installDir, packageName);
    const packageJsonPath = path.join(packageRoot, 'package.json');
    if (await this.pathExists(packageJsonPath)) {
      return;
    }

    await fs.mkdir(installDir, { recursive: true });
    const rootPackageJson = path.join(installDir, 'package.json');
    if (!(await this.pathExists(rootPackageJson))) {
      await fs.writeFile(
        rootPackageJson,
        JSON.stringify({ name: 'digly-cache', private: true }, null, 2),
      );
    }

    const execFileAsync = promisify(execFile);
    const args = [
      'install',
      '--no-audit',
      '--no-fund',
      '--silent',
      '--prefix',
      installDir,
      packageSpec,
    ];
    if (registry !== 'npm' && registry !== 'local') {
      args.push('--registry', registry);
    }
    await execFileAsync('npm', args);
  }

  private getPackageName(packageSpec: string): string {
    if (packageSpec.startsWith('@')) {
      const lastAt = packageSpec.lastIndexOf('@');
      return lastAt > 0 ? packageSpec.slice(0, lastAt) : packageSpec;
    }
    const [name] = packageSpec.split('@');
    return name;
  }

  private getInstalledPackageRoot(
    installDir: string,
    packageName: string,
  ): string {
    const nameParts = packageName.split('/');
    return path.join(installDir, 'node_modules', ...nameParts);
  }

  private async getLocalPackageName(packagePath: string): Promise<string> {
    const packageJsonPath = path.join(packagePath, 'package.json');
    if (!(await this.pathExists(packageJsonPath))) {
      throw new Error(`Local package missing package.json: ${packagePath}`);
    }
    const content = await fs.readFile(packageJsonPath, 'utf8');
    const parsed = JSON.parse(content);
    if (!parsed?.name) {
      throw new Error(
        `Local package missing name in package.json: ${packagePath}`,
      );
    }
    return parsed.name;
  }

  private async resolvePackageEntry(
    packageRoot: string,
    entry: string,
    packageName?: string,
  ): Promise<string> {
    const packageJsonPath = path.join(packageRoot, 'package.json');
    let resolvedPackageName = packageName;
    let packageJson: any = null;
    if (!resolvedPackageName && (await this.pathExists(packageJsonPath))) {
      const content = await fs.readFile(packageJsonPath, 'utf8');
      try {
        packageJson = JSON.parse(content);
        resolvedPackageName = packageJson?.name;
      } catch {
        resolvedPackageName = packageName;
      }
    } else if (await this.pathExists(packageJsonPath)) {
      try {
        packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      } catch {
        packageJson = null;
      }
    }

    const entryValue = entry.trim();
    const exportTarget = this.resolvePackageExportTarget(
      packageJson?.exports,
      entryValue,
    );
    if (exportTarget) {
      const resolved = path.resolve(packageRoot, exportTarget);
      if (await this.pathExists(resolved)) {
        return resolved;
      }
      if (!path.extname(resolved)) {
        const withJs = `${resolved}.js`;
        if (await this.pathExists(withJs)) {
          return withJs;
        }
      }
    }
    if ((entryValue === '.' || entryValue === './') && packageJson) {
      const mainFields = ['module', 'main'];
      for (const field of mainFields) {
        const target = packageJson[field];
        if (typeof target === 'string') {
          const resolved = path.resolve(packageRoot, target);
          if (await this.pathExists(resolved)) {
            return resolved;
          }
          if (!path.extname(resolved)) {
            const withJs = `${resolved}.js`;
            if (await this.pathExists(withJs)) {
              return withJs;
            }
          }
        }
      }
    }

    const directPath = path.resolve(packageRoot, entryValue);
    if (await this.pathExists(directPath)) {
      return directPath;
    }
    if (!path.extname(directPath)) {
      const withJs = `${directPath}.js`;
      if (await this.pathExists(withJs)) {
        return withJs;
      }
    }

    throw new Error(
      `Controller entry "${entryValue}" could not be resolved in ${packageRoot}`,
    );
  }

  private resolvePackageExportTarget(
    exportsField: any,
    entry: string,
  ): string | null {
    if (!exportsField) {
      return null;
    }

    const key = entry === '.' || entry === './' ? '.' : entry;
    const target = exportsField[key];
    return this.resolveExportTargetValue(target);
  }

  private resolveExportTargetValue(target: any): string | null {
    if (!target) {
      return null;
    }
    if (typeof target === 'string') {
      return target;
    }
    if (Array.isArray(target)) {
      for (const item of target) {
        const resolved = this.resolveExportTargetValue(item);
        if (resolved) {
          return resolved;
        }
      }
      return null;
    }
    if (typeof target === 'object') {
      const preferredKeys = ['import', 'default', 'require'];
      for (const key of preferredKeys) {
        if (target[key]) {
          const resolved = this.resolveExportTargetValue(target[key]);
          if (resolved) {
            return resolved;
          }
        }
      }
    }
    return null;
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // Validation handled by TypeBox + Ajv schemas.

  private orderResourcesByKindDependencies(
    resources: RuntimeResource[],
  ): RuntimeResource[] {
    if (resources.length <= 1) {
      return resources;
    }

    const indicesByName = new Map<string, number[]>();
    for (let i = 0; i < resources.length; i += 1) {
      const name = resources[i]?.metadata?.name;
      if (!name) {
        continue;
      }
      const list = indicesByName.get(name);
      if (list) {
        list.push(i);
      } else {
        indicesByName.set(name, [i]);
      }
    }

    const edges = new Map<number, Set<number>>();
    const indegree = new Map<number, number>();
    for (let i = 0; i < resources.length; i += 1) {
      indegree.set(i, 0);
    }

    for (let i = 0; i < resources.length; i += 1) {
      const kind = resources[i]?.kind;
      if (!kind) {
        continue;
      }
      const definers = indicesByName.get(kind);
      if (!definers) {
        continue;
      }
      for (const definerIndex of definers) {
        if (definerIndex === i) {
          continue;
        }
        let set = edges.get(definerIndex);
        if (!set) {
          set = new Set();
          edges.set(definerIndex, set);
        }
        if (!set.has(i)) {
          set.add(i);
          indegree.set(i, (indegree.get(i) || 0) + 1);
        }
      }
    }

    const ready: number[] = [];
    for (let i = 0; i < resources.length; i += 1) {
      if ((indegree.get(i) || 0) === 0) {
        ready.push(i);
      }
    }
    ready.sort((a, b) => a - b);

    const ordered: RuntimeResource[] = [];
    while (ready.length > 0) {
      const index = ready.shift() as number;
      ordered.push(resources[index]);
      const next = edges.get(index);
      if (!next) {
        continue;
      }
      for (const dependent of next) {
        const count = (indegree.get(dependent) || 0) - 1;
        indegree.set(dependent, count);
        if (count === 0) {
          ready.push(dependent);
        }
      }
      if (ready.length > 1) {
        ready.sort((a, b) => a - b);
      }
    }

    if (ordered.length !== resources.length) {
      throw new Error('Resource dependency cycle detected');
    }

    return ordered;
  }

  /**
   * Expands template instances (resources with kind "Template.<Name>")
   * Recursively expands templates that generate other templates
   */
  private expandTemplateInstances(
    resources: RuntimeResource[],
  ): RuntimeResource[] {
    const templates = new Map<string, RuntimeResource>();
    const regularResources: RuntimeResource[] = [];
    const instancesMap = new Map<string, RuntimeResource>();

    // Separate TemplateDefinitions from other resources and template instances
    for (const resource of resources) {
      if (isTemplateDefinition(resource)) {
        templates.set(resource.metadata.name, resource);
        regularResources.push(resource); // Keep definitions in registry
      } else {
        regularResources.push(resource);
      }
    }

    // Expand template instances
    const expanded: RuntimeResource[] = [];
    const maxIterations = 10; // Prevent infinite recursion
    let currentInstances = Array.from(instancesMap.values());

    for (
      let iteration = 0;
      iteration < maxIterations && currentInstances.length > 0;
      iteration++
    ) {
      const newInstances: RuntimeResource[] = [];

      for (const instance of currentInstances) {
        // Extract template name from Namespace.TemplateName
        const templateName = instance.kind;
        const template = templates.get(templateName);

        if (!template) {
          throw new Error(
            `Template "${templateName}" not found for instance "${instance.metadata.name}"`,
          );
        }

        if (!isTemplateDefinition(template)) {
          throw new Error(
            `Resource "${templateName}" is not a TemplateDefinition`,
          );
        }

        // Extract parameters from the instance (all properties except kind/metadata)
        const parameters: Record<string, any> = {};
        for (const [key, value] of Object.entries(instance)) {
          if (key !== 'kind' && key !== 'metadata') {
            parameters[key] = value;
          }
        }
        // Expand expressions in parameters using the parameter context itself
        // This allows parameters to reference each other (e.g., baseUrl: http://localhost:${{ basePort }})
        const expandedParameters = this.expandParameterExpressions(parameters);

        // Instantiate template with parent URI tracking for nested template expansion
        const parentUri = instance.metadata.uri;
        const instantiated = instantiateTemplate(
          template,
          expandedParameters,
          instance.metadata.name,
          iteration,
          parentUri,
        );

        // Check if any of the instantiated resources are also template instances
        for (const resource of instantiated) {
          if (resource.kind.startsWith('Template.')) {
            newInstances.push(resource);
          } else {
            expanded.push(resource);
          }
        }
      }

      currentInstances = newInstances;
    }

    if (currentInstances.length > 0) {
      throw new Error(
        `Template expansion did not complete after ${maxIterations} iterations. Possible infinite recursion.`,
      );
    }

    return [...regularResources, ...expanded];
  }

  /**
   * Expands expressions in template instantiation parameters
   * This allows parameters to reference each other (e.g., baseUrl: http://localhost:${{ basePort }})
   */
  private expandParameterExpressions(
    parameters: Record<string, any>,
  ): Record<string, any> {
    const TEMPLATE_REGEX = /\$\{\{\s*([^}]+?)\s*\}\}/g;
    const EXACT_TEMPLATE_REGEX = /^\s*\$\{\{\s*([^}]+?)\s*\}\}\s*$/;

    const expandValue = (value: any): any => {
      if (typeof value === 'string') {
        const exactMatch = value.match(EXACT_TEMPLATE_REGEX);
        if (exactMatch) {
          // Entire string is a single expression - evaluate and return typed result
          try {
            return evaluate(exactMatch[1], parameters);
          } catch (error: any) {
            throw new Error(
              `Failed to evaluate parameter expression "\${{ ${exactMatch[1]} }}": ${error.message}`,
            );
          }
        }

        // Check if string contains any template expressions
        if (TEMPLATE_REGEX.test(value)) {
          // String interpolation - replace all expressions
          return value.replace(TEMPLATE_REGEX, (_, expr) => {
            try {
              const result = evaluate(expr, parameters);
              return String(result);
            } catch (error: any) {
              throw new Error(
                `Failed to evaluate parameter expression "\${{ ${expr} }}": ${error.message}`,
              );
            }
          });
        }

        return value;
      } else if (Array.isArray(value)) {
        return value.map(expandValue);
      } else if (value && typeof value === 'object') {
        const expanded: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) {
          expanded[k] = expandValue(v);
        }
        return expanded;
      }

      return value;
    };

    // Expand all parameter values
    const expanded: Record<string, any> = {};
    for (const [key, value] of Object.entries(parameters)) {
      expanded[key] = expandValue(value);
    }

    return expanded;
  }
}
