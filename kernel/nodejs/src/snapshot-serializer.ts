import { RuntimeResource } from "@telorun/sdk";
import * as fs from "fs/promises";
import * as YAML from "js-yaml";
import * as path from "path";
import { ResourceInstance } from "./types.js";

export interface SnapshotData {
  timestamp: string;
  resources: Array<{
    kind: string;
    name: string;
    metadata: Record<string, any>;
    data: Record<string, any>;
    snapshot?: Record<string, any>; // Custom data from resource's snapshot() method
  }>;
}

/**
 * Serializes runtime state into YAML snapshots
 * Captures resource definitions, instances, and custom state
 * Recursively includes nested resources based on generationDepth
 */
export class SnapshotSerializer {
  /**
   * Take a snapshot of runtime state
   * @param resources Map of resources organized by kind
   * @param resourceInstances Map of resource instances to include custom snapshots
   * @param filePath Optional file path to write snapshot to
   * @returns Snapshot data object
   */
  async takeSnapshot(
    resources: Map<string, Map<string, RuntimeResource>>,
    resourceInstances?: Map<string, { resource: RuntimeResource; instance: ResourceInstance }>,
    filePath?: string,
  ): Promise<SnapshotData> {
    const snapshot: SnapshotData = {
      timestamp: new Date().toISOString(),
      resources: [],
    };

    // Get all resources organized by generation depth (0 = first level)
    // Start with depth 0 (directly loaded resources) and recursively include nested ones
    const resourcesByDepth = this.groupByGenerationDepth(resources);

    // Process resources starting from depth 0
    for (const depth of Array.from(resourcesByDepth.keys()).sort((a, b) => a - b)) {
      const resourcesAtDepth = resourcesByDepth.get(depth) || [];

      for (const resource of resourcesAtDepth) {
        const resourceEntry = await this.serializeResource(resource, resourceInstances);
        snapshot.resources.push(resourceEntry);
      }
    }

    // Write to file if path provided
    if (filePath) {
      await this.writeSnapshotToFile(snapshot, filePath);
    }

    return snapshot;
  }

  /**
   * Serialize a single resource
   */
  private async serializeResource(
    resource: RuntimeResource,
    resourceInstances?: Map<string, { resource: RuntimeResource; instance: ResourceInstance }>,
  ): Promise<{
    kind: string;
    name: string;
    metadata: Record<string, any>;
    data: Record<string, any>;
    snapshot?: Record<string, any>;
  }> {
    const { kind, metadata, ...data } = resource;
    const { name } = metadata;

    const resourceEntry: any = {
      kind,
      name,
      metadata: this.serializeMetadata(metadata),
      data: this.serializeData(data),
    };

    // Include custom snapshot if resource instance has snapshot() method
    if (resourceInstances) {
      const key = this.getResourceKey(kind, name);
      const instanceData = resourceInstances.get(key);

      if (instanceData && instanceData.instance) {
        const snapshotData = await this.getInstanceSnapshot(instanceData.instance);
        if (snapshotData) {
          resourceEntry.snapshot = snapshotData;
        }
      }
    }

    return resourceEntry;
  }

  /**
   * Get snapshot from resource instance if it implements snapshot() method
   */
  private async getInstanceSnapshot(
    instance: ResourceInstance,
  ): Promise<Record<string, any> | null> {
    const instanceAny = instance as any;

    // Check if snapshot method exists
    if (typeof instanceAny.snapshot === "function") {
      try {
        const result = await Promise.resolve(instanceAny.snapshot(instance as any));
        return result;
      } catch (error) {
        console.error("Error calling snapshot() on resource instance:", error);
        return null;
      }
    }

    return null;
  }

  /**
   * Serialize metadata, filtering out circular references and functions
   */
  private serializeMetadata(metadata: Record<string, any>): Record<string, any> {
    const serialized: Record<string, any> = {};

    for (const [key, value] of Object.entries(metadata)) {
      if (typeof value === "function") {
        continue;
      }
      try {
        serialized[key] = JSON.parse(JSON.stringify(value));
      } catch {
        // Skip non-serializable values
      }
    }

    return serialized;
  }

  /**
   * Serialize resource data, filtering out circular references and functions
   */
  private serializeData(data: Record<string, any>): Record<string, any> {
    const serialized: Record<string, any> = {};

    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "function") {
        continue;
      }
      try {
        serialized[key] = JSON.parse(JSON.stringify(value));
      } catch {
        // Skip non-serializable values
      }
    }

    return serialized;
  }

  /**
   * Group resources by generation depth for hierarchical ordering
   */
  private groupByGenerationDepth(
    resources: Map<string, Map<string, RuntimeResource>>,
  ): Map<number, RuntimeResource[]> {
    const grouped = new Map<number, RuntimeResource[]>();

    for (const kindMap of resources.values()) {
      for (const resource of kindMap.values()) {
        const depth = resource.metadata.generationDepth ?? 0;

        if (!grouped.has(depth)) {
          grouped.set(depth, []);
        }

        grouped.get(depth)!.push(resource);
      }
    }

    return grouped;
  }

  /**
   * Write snapshot to YAML file
   */
  private async writeSnapshotToFile(snapshot: SnapshotData, filePath: string): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (dir !== "." && dir !== "") {
      await fs.mkdir(dir, { recursive: true });
    }

    // Convert to YAML
    const yaml = YAML.dump(snapshot, {
      indent: 2,
      lineWidth: 0,
    });

    await fs.writeFile(filePath, yaml, "utf-8");
  }

  /**
   * Generate resource key for instance lookup
   */
  private getResourceKey(kind: string, name: string): string {
    return `${kind}:${name}`;
  }

  /**
   * Load snapshot from YAML file
   */
  async loadSnapshotFromFile(filePath: string): Promise<SnapshotData> {
    const content = await fs.readFile(filePath, "utf-8");
    return YAML.load(content) as SnapshotData;
  }
}
