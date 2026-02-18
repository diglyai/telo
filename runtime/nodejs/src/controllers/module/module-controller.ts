import type { ControllerContext, ResourceContext, RuntimeResource } from "@telorun/sdk";
import * as path from "path";
import { Loader } from "../../loader.js";

type ModuleResource = RuntimeResource & {
  source?: string;
  imports?: string[];
  definitions?: string[];
  resources?: (string | { path: string })[];
};

export function register(ctx: ControllerContext): void {
  // Module controller doesn't need register hook
  // Processing happens during create phase
}

export async function create(resource: ModuleResource, ctx: ResourceContext): Promise<null> {
  // Get the module base path from the resource's URI or source
  const moduleBasePath = resource.metadata.source
    ? path.dirname(resource.metadata.source)
    : getModuleBasePath(resource.metadata.uri);
  const loader = new Loader();
  try {
    // Load and register resource definitions from imports
    if (resource.imports && Array.isArray(resource.imports)) {
      for (const importPath of resource.imports) {
        const defResources = await loader.loadDirectory(loader.resolvePath(moduleBasePath, importPath));
        for (const defResource of defResources) {
          ctx.registerManifest(defResource);
        }
      }
    }
    // Load and register resources from definitions and resources paths
    if (resource.definitions && Array.isArray(resource.definitions)) {
      for (const defPath of resource.definitions) {
        const defResources = await loader.loadManifest(loader.resolvePath(moduleBasePath, defPath));
        for (const defResource of defResources) {
          ctx.registerManifest(defResource);
        }
      }
    }

    if (resource.resources && Array.isArray(resource.resources)) {
      for (const defPath of resource.resources) {
        const rawPath = typeof defPath === "string" ? defPath : defPath.path;
        const defResources = await loader.loadManifest(loader.resolvePath(moduleBasePath, rawPath));
        for (const defResource of defResources) {
          ctx.registerManifest(defResource);
        }
      }
    }

    // Module resource doesn't create a runtime instance
    return null;
  } catch (error) {
    throw new Error(
      `Failed to process Module "${resource.metadata.name}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function getModuleBasePath(uri?: string): string {
  if (!uri) {
    return process.cwd();
  }

  try {
    // URI format: file://localhost/path/to/file.yaml#kind.name
    // Extract the file path part (before the #)
    const hashIndex = uri.indexOf("#");
    const filePath = hashIndex > 0 ? uri.substring(0, hashIndex) : uri;

    // Parse as URL to handle file:// scheme
    if (filePath.startsWith("file://")) {
      // Remove 'file://localhost' and get the path
      let pathPart = filePath.substring("file://".length);
      if (pathPart.startsWith("localhost/")) {
        pathPart = pathPart.substring("localhost".length);
      } else if (pathPart.startsWith("localhost\\")) {
        pathPart = pathPart.substring("localhost".length);
      }
      return path.dirname(pathPart);
    }

    // Fallback: treat as regular path
    return path.dirname(filePath);
  } catch {
    return process.cwd();
  }
}

export const schema = {
  type: "object",
  additionalProperties: true,
};
