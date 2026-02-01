export interface ModuleContext {
  on(event: string, handler: (payload?: any) => void | Promise<void>): void;
  once(event: string, handler: (payload?: any) => void | Promise<void>): void;
  off(event: string, handler: (payload?: any) => void | Promise<void>): void;
  emit(event: string, payload?: any): void;
  acquireHold(reason?: string): () => void;
  evaluateCel(expression: string, context: Record<string, any>): unknown;
  expandValue(value: any, context: Record<string, any>): any;
}

export interface RuntimeResource {
  kind: string;
  metadata: {
    name: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface ResourceContext extends ModuleContext {
  acquireHold(reason?: string): () => void;
  emitEvent(event: string, payload?: any): Promise<void>;
}

export interface ModuleCreateContext extends ModuleContext {
  kernel: {
    registry: Map<string, Map<string, RuntimeResource>>;
    execute: (urn: string, input: any, ctx?: any) => Promise<any>;
  };
  getResources(kind: string): RuntimeResource[];
  onResourceEvent(
    kind: string,
    name: string,
    event: string,
    handler: (payload?: any) => void | Promise<void>,
  ): void;
  onceResourceEvent(
    kind: string,
    name: string,
    event: string,
    handler: (payload?: any) => void | Promise<void>,
  ): void;
  offResourceEvent(
    kind: string,
    name: string,
    event: string,
    handler: (payload?: any) => void | Promise<void>,
  ): void;
  emitResourceEvent(
    kind: string,
    name: string,
    event: string,
    payload?: any,
  ): Promise<void>;
  createResourceContext(kind: string, name: string): ResourceContext;
}

export interface ResourceInstance {
  init?(): void | Promise<void>;
  teardown?(): void | Promise<void>;
}
