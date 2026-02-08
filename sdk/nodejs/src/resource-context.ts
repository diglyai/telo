import { ControllerContext } from './controller-context.js';
import { RuntimeResource } from './runtime-resource.js';

export type DataValidator = (data: any) => void;

export interface ResourceContext extends ControllerContext {
  acquireHold(reason?: string): () => void;
  emitEvent(event: string, payload?: any): Promise<void>;
  invoke(kind: string, name: string, ...args: any[]): Promise<any>;
  getResources(kind: string): RuntimeResource[];
  getResourcesByName(kind: string, name: string): RuntimeResource | null;
  registerManifest(resource: any): void;
  validateSchema(value: any, schema: any): void;
  createSchemaValidator(schema: any): DataValidator;
  registerController(
    moduleName: string,
    resourceKind: string,
    controllerInstance: any,
  ): Promise<void>;
}
