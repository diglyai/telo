import { evaluate } from 'cel-js';
import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';
import * as path from 'path';
import {
  formatAjvErrors,
  validateModuleManifest,
  validateRuntimeResource,
} from './manifest-schemas';
import { ResourceURI } from './resource-uri';
import { isTemplateDefinition } from './template-definition';
import { instantiateTemplate } from './template-expander';
import { ModuleManifest, RuntimeResource } from './types';

/**
 * Loader: Ingests resolved YAML manifests from disk into memory
 */
export class Loader {
  private runtimeConfig: ModuleManifest | null = null;
  private moduleName: string | null = null;
  private templateNames: Set<string> = new Set();

  async loadFromRuntimeConfig(
    runtimeYamlPath: string,
  ): Promise<RuntimeResource[]> {
    // Load runtime config first
    this.runtimeConfig = await this.loadRuntimeConfigFile(runtimeYamlPath);

    if (
      !this.runtimeConfig.resources ||
      this.runtimeConfig.resources.length === 0
    ) {
      console.log('No resources specified in runtime.yaml');
      return [];
    }

    const resources: RuntimeResource[] = [];
    const basePath = path.dirname(runtimeYamlPath);

    for (const resourceEntry of this.runtimeConfig.resources) {
      const resourcePath =
        typeof resourceEntry === 'string' ? resourceEntry : resourceEntry.path;
      const resolvedPath = this.resolveManifestPath(resourcePath, basePath);
      await this.loadManifestSource(resolvedPath, resources);
    }

    const ordered = this.orderResourcesByKindDependencies(resources);
    return this.expandTemplateInstances(ordered);
  }

  async loadDirectory(dirPath: string): Promise<RuntimeResource[]> {
    const resources: RuntimeResource[] = [];
    await this.walkDirectory(dirPath, resources);
    const ordered = this.orderResourcesByKindDependencies(resources);
    return this.expandTemplateInstances(ordered);
  }

  private resolveManifestPath(manifestPath: string, basePath: string): string {
    // Handle environment variables with CEL expression format
    if (manifestPath.includes('${{') && manifestPath.includes('}}')) {
      // Simple env var substitution for ${{{ env.VAR_NAME }}}
      const envVarMatch = manifestPath.match(
        /\$\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/,
      );
      if (envVarMatch) {
        const envValue = process.env[envVarMatch[1]];
        if (!envValue) {
          throw new Error(`Environment variable ${envVarMatch[1]} not found`);
        }
        manifestPath = manifestPath.replace(envVarMatch[0], envValue);
      }
    }

    // Handle URLs
    if (
      manifestPath.startsWith('http://') ||
      manifestPath.startsWith('https://')
    ) {
      return manifestPath;
    }

    // Handle absolute paths
    if (path.isAbsolute(manifestPath)) {
      return manifestPath;
    }

    // Handle relative paths
    return path.resolve(basePath, manifestPath);
  }

  private async loadManifestSource(
    sourcePath: string,
    resources: RuntimeResource[],
  ): Promise<void> {
    if (sourcePath.startsWith('http://') || sourcePath.startsWith('https://')) {
      throw new Error('Remote manifest loading not yet implemented');
    }

    const stats = await fs.stat(sourcePath);

    if (stats.isDirectory()) {
      await this.walkDirectory(sourcePath, resources);
    } else if (stats.isFile() && this.isYamlFile(path.basename(sourcePath))) {
      await this.loadYamlFile(sourcePath, resources);
    } else {
      throw new Error(`Invalid manifest source: ${sourcePath}`);
    }
  }

  async loadRuntimeConfigFile(
    runtimeYamlPath: string,
  ): Promise<ModuleManifest> {
    const content = await fs.readFile(runtimeYamlPath, 'utf-8');
    const config = yaml.load(content) as ModuleManifest;

    if (!validateModuleManifest(config)) {
      throw new Error(
        `Invalid runtime.yaml format: ${formatAjvErrors(validateModuleManifest.errors)}`,
      );
    }

    // Store module name for template resolution
    this.moduleName = config.name || null;

    return config;
  }
  getRuntimeConfig(): ModuleManifest | null {
    return this.runtimeConfig;
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
      resource.metadata.uri = ResourceURI.fromFile(
        absolutePath,
        kind,
        name,
      ).toString();
      resource.metadata.generationDepth = 0;

      // Track template names for resolution
      if (resource.kind === 'TemplateDefinition') {
        this.templateNames.add(resource.metadata.name);
      }

      resources.push(resource);
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
      // Resolve "Self." prefix to module name
      if (this.moduleName && doc.kind.startsWith('Self.')) {
        doc.kind = `${this.moduleName}.${doc.kind.substring(5)}`;
      }
      // Resolve non-prefixed kind to Self. if it matches a known template
      else if (
        this.moduleName &&
        !doc.kind.includes('.') &&
        this.templateNames.has(doc.kind)
      ) {
        doc.kind = `${this.moduleName}.${doc.kind}`;
      }
      return doc as RuntimeResource;
    }

    return null;
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
      } else if (
        this.moduleName &&
        resource.kind.startsWith(`${this.moduleName}.`)
      ) {
        // This is a template instance (Module.TemplateName)
        const templateName = resource.kind.substring(
          this.moduleName.length + 1,
        );
        if (templates.has(templateName)) {
          instancesMap.set(
            `${resource.kind}.${resource.metadata.name}`,
            resource,
          );
        } else {
          regularResources.push(resource);
        }
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
        // Extract template name from Module.TemplateName
        const templateName =
          this.moduleName && instance.kind.startsWith(`${this.moduleName}.`)
            ? instance.kind.substring(this.moduleName.length + 1)
            : instance.kind;
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
