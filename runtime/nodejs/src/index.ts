export { ControllerRegistry } from './controller-registry';
export { EventStream } from './event-stream';
export { Kernel } from './kernel';
export { Loader } from './loader';
export { ManifestRegistry as Registry } from './registry';
export { ResourceURI } from './resource-uri';
export { SnapshotSerializer } from './snapshot-serializer';
export {
    ControllerDefinition,
    ControllerInstance,
    DiglyRuntimeError,
    ExecContext,
    KernelContext,
    ResourceDefinition
} from './types';
export type { Kernel as IKernel } from './types';

// Template system exports
export {
    extractDefaultsFromSchema,
    isTemplateDefinition,
    TemplateContext,
    TemplateDefinition,
    TemplateResourceBlueprint
} from './template-definition';
export {
    expandPropertyWithControlFlow,
    expandTemplates,
    instantiateTemplate
} from './template-expander';

