export { ControllerRegistry } from "./controller-registry.js";
export { EventStream } from "./event-stream.js";
export { Kernel } from "./kernel.js";
export { Loader } from "./loader.js";
export { ManifestRegistry as Registry } from "./registry.js";
export { ResourceURI } from "./resource-uri.js";
export { SnapshotSerializer } from "./snapshot-serializer.js";
export { TeloRuntimeError } from "./types.js";
export type {
    ControllerDefinition,
    ControllerInstance,
    ExecContext, Kernel as IKernel, KernelContext,
    ResourceDefinition
} from "./types.js";

// Template system exports
export { extractDefaultsFromSchema, isTemplateDefinition } from "./template-definition.js";
export type {
    TemplateContext,
    TemplateDefinition,
    TemplateResourceBlueprint
} from "./template-definition.js";
export {
    expandPropertyWithControlFlow,
    expandTemplates,
    instantiateTemplate
} from "./template-expander.js";

