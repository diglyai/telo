export { Kernel } from './kernel';
export { Loader } from './loader';
export { ModuleLoader } from './module-loader';
export { ModuleManifestLoader } from './module-manifest-loader';
export { Registry } from './registry';
export {
  DiglyModule,
  DiglyRuntimeError,
  ExecContext,
  ModuleLoader as IModuleLoader,
  KernelContext, ModuleConfig, ModuleContext, ModuleDiscoveryResult,
  ModuleManifest,
  ResourceDefinition,
  RuntimeError,
  RuntimeResource
} from './types';
export type { Kernel as IKernel } from './types';

// Template system exports
export {
  extractDefaultsFromSchema, isTemplateDefinition, TemplateContext, TemplateDefinition,
  TemplateResourceBlueprint
} from './template-definition';
export {
  expandPropertyWithControlFlow, expandTemplates,
  instantiateTemplate
} from './template-expander';

