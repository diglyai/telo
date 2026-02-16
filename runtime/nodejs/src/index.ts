export { ControllerRegistry } from "./controller-registry";
export { EventStream } from "./event-stream";
export { Kernel } from "./kernel";
export { Loader } from "./loader";
export { ManifestRegistry as Registry } from "./registry";
export { ResourceURI } from "./resource-uri";
export { SnapshotSerializer } from "./snapshot-serializer";
export type {
    ControllerDefinition,
    ControllerInstance,
    ExecContext,
    KernelContext,
    ResourceDefinition,
} from "./types";
export { CitoRuntimeError } from "./types";
export type { Kernel as IKernel } from "./types";

// Template system exports
export type {
    TemplateContext,
    TemplateDefinition,
    TemplateResourceBlueprint,
} from "./template-definition";
export {
    extractDefaultsFromSchema,
    isTemplateDefinition,
} from "./template-definition";
export {
    expandPropertyWithControlFlow,
    expandTemplates,
    instantiateTemplate,
} from "./template-expander";

