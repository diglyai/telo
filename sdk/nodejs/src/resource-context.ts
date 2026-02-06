import { ControllerContext } from './controller-context.js';
import { RuntimeResource } from './runtime-resource.js';

export interface ResourceContext extends ControllerContext {
  acquireHold(reason?: string): () => void;
  emitEvent(event: string, payload?: any): Promise<void>;
  invoke(kind: string, name: string, ...args: any[]): Promise<any>;
  getResources(kind: string): RuntimeResource[];
  getResourcesByName(kind: string, name: string): RuntimeResource | null;
  registerManifest(resource: any): void;
  registerController(
    moduleName: string,
    resourceKind: string,
    controllerInstance: any,
  ): Promise<void>;
  emitEvent(event: string, payload?: any): Promise<void>;
}
