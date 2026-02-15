import { NoopValidator, ResourceContext, RuntimeResource } from "@diglyai/sdk";
import Ajv from "ajv";
import { expandValue } from "./expressions";
import { Kernel } from "./kernel";
import { formatAjvErrors } from "./manifest-schemas";
import { SchemaValidator } from "./schema-valiator";
import { DiglyRuntimeError } from "./types";

export class ResourceContextImpl implements ResourceContext {
  constructor(
    readonly kernel: Kernel,
    private readonly metadata: Record<string, any>,
    private readonly validator: SchemaValidator = new SchemaValidator(),
  ) {}

  createSchemaValidator(schema: any) {
    if (!schema) {
      return new NoopValidator();
    }
    return this.validator.compile(schema);
  }

  validateSchema(value: any, schema: any) {
    const ajv = new Ajv();
    const validate = ajv.compile(
      "type" in schema && typeof schema.type === "string"
        ? schema
        : {
            type: "object",
            properties: schema,
            required: Object.keys(schema),
            additionalProperties: false,
          },
    );
    const isValid = validate(value);
    if (!isValid) {
      throw new DiglyRuntimeError(
        "ERR_INVALID_VALUE",
        `Invalid value passed: ${JSON.stringify(value)}. Error: ${formatAjvErrors(validate.errors)}`,
      );
    }
  }

  invoke(kind: string, name: string, ...args: any[]): Promise<any> {
    const parts = kind.split(".");
    if (parts.length > 2) {
      return this.kernel.invoke(parts[0], parts.slice(1).join("."), name, ...args);
    }
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
    await this.kernel.registerController(moduleName, resourceKind, controllerInstance);
  }

  registerDefinition(def: any) {
    this.kernel.registerResourceDefinition(def);
  }

  on(event: string, handler: (payload?: any) => void | Promise<void>): void {
    this.kernel.on(event, handler);
  }

  once(event: string, handler: (payload?: any) => void | Promise<void>): void {
    throw new Error("Method once not implemented.");
  }

  off(event: string, handler: (payload?: any) => void | Promise<void>): void {
    throw new Error("Method off not implemented.");
  }

  async emit(event: string, payload?: any) {
    await this.kernel.emitRuntimeEvent(event, payload);
  }

  acquireHold(reason?: string): () => void {
    return this.kernel.acquireHold(reason);
  }

  requestExit(code: number): void {
    this.kernel.requestExit(code);
  }

  evaluateCel(expression: string, context: Record<string, any>): unknown {
    throw new Error("Method evaluateCel not implemented.");
  }

  expandValue(value: any, context: Record<string, any>) {
    return expandValue(value, context);
  }

  async emitEvent(event: string, payload?: any) {
    await this.kernel.emitRuntimeEvent(event, payload);
  }
}
