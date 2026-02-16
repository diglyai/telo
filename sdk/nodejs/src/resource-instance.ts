import { ResourceContext } from "./resource-context.js";

export type ResourceInstance = {
  init?(ctx?: ResourceContext): Promise<void>;
  run?(): void | Promise<void>;
  invoke?(input: any): any | Promise<any>;
  teardown?(): void | Promise<void>;

  /**
   * Optional method for debugging/snapshots
   * Called when taking runtime state snapshots
   * Should return serializable state data specific to this resource
   */
  snapshot?(): Record<string, any> | Promise<Record<string, any>>;
};
