import { DiglyRuntimeError, RuntimeError, RuntimeResource } from './types';

/**
 * Registry: Indexes resources by composite key of Kind and Name
 */
export class Registry {
  private resources: Map<string, Map<string, RuntimeResource>> = new Map();
  private kindInheritance: Map<string, string> = new Map(); // derivedKind -> parentKind

  register(resource: RuntimeResource): void {
    const { kind, metadata } = resource;
    const { name } = metadata;

    if (!this.resources.has(kind)) {
      this.resources.set(kind, new Map());
    }

    const kindMap = this.resources.get(kind)!;

    if (kindMap.has(name)) {
      throw new DiglyRuntimeError(
        RuntimeError.ERR_DUPLICATE_RESOURCE,
        `Duplicate resource: ${kind}.${name}`,
      );
    }

    kindMap.set(name, resource);

    // Check if this is a Runtime.KindDefinition that creates a new kind
    if (kind === 'Runtime.KindDefinition') {
      const newKind = name;
      const parentKind = resource?.extends;
      if (parentKind) {
        this.kindInheritance.set(newKind, parentKind);
      }
    }
  }

  getParentKind(kind: string): string | undefined {
    return this.kindInheritance.get(kind);
  }

  resolveKindChain(kind: string): string[] {
    const chain: string[] = [kind];
    let current = kind;
    while (this.kindInheritance.has(current)) {
      current = this.kindInheritance.get(current)!;
      chain.push(current);
    }
    return chain;
  }

  get(kind: string, name: string): RuntimeResource | undefined {
    return this.resources.get(kind)?.get(name);
  }

  getByKind(kind: string): RuntimeResource[] {
    const kindMap = this.resources.get(kind);
    return kindMap ? Array.from(kindMap.values()) : [];
  }

  getAll(): Map<string, Map<string, RuntimeResource>> {
    return this.resources;
  }
}
