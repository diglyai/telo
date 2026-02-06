import { ResourceContext, RuntimeResource } from '@diglyai/sdk';
import { expandValue } from './expressions';
import { Kernel } from './kernel';

export class ResourceContextImpl implements ResourceContext {
  constructor(
    readonly kernel: Kernel,
    private readonly metadata: Record<string, any>,
  ) {}

  invoke(kind: string, name: string, ...args: any[]): Promise<any> {
    return this.kernel.invoke(this.metadata.module, kind, name, ...args);
  }

  registerManifest(resource: any): void {
    this.kernel.registerManifest(resource);
  }

  getResources(kind: string): RuntimeResource[] {
    return this.kernel.getResourcesByKind(kind);
  }

  getResourcesByName(kind: string, name: string): RuntimeResource | null {
    return this.kernel.getResourceByName(this.metadata.module, kind, name);
  }

  async registerController(
    moduleName: string,
    resourceKind: string,
    controllerInstance: any,
  ): Promise<void> {
    await this.kernel.registerController(
      moduleName,
      resourceKind,
      controllerInstance,
    );
  }

  on(event: string, handler: (payload?: any) => void | Promise<void>): void {
    this.kernel.on(event, handler);
  }

  once(event: string, handler: (payload?: any) => void | Promise<void>): void {
    throw new Error('Method once not implemented.');
  }

  off(event: string, handler: (payload?: any) => void | Promise<void>): void {
    throw new Error('Method off not implemented.');
  }

  emit(event: string, payload?: any): void {
    throw new Error('Method emit not implemented.');
  }

  acquireHold(reason?: string): () => void {
    return this.kernel.acquireHold(reason);
  }

  evaluateCel(expression: string, context: Record<string, any>): unknown {
    throw new Error('Method evaluateCel not implemented.');
  }

  expandValue(value: any, context: Record<string, any>) {
    return expandValue(value, context);
  }

  async emitEvent(event: string, payload?: any) {
    this.kernel.emitRuntimeEvent(event, payload);
  }
}
