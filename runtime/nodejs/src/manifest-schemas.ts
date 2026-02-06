import { Type } from '@sinclair/typebox';
import Ajv, { ErrorObject } from 'ajv';

const EntrypointSchema = Type.Object(
  {
    runtime: Type.String(),
    entrypoint: Type.String(),
  },
  { additionalProperties: false },
);

export const ModuleManifestSchema = Type.Object(
  {
    kind: Type.Optional(Type.String()),
    name: Type.String(),
    version: Type.String(),
    imports: Type.Optional(Type.Array(Type.String())),
    definitions: Type.Optional(Type.Array(Type.String())),
    entrypoint: Type.Optional(Type.String()),
    entrypoints: Type.Optional(Type.Array(EntrypointSchema)),
    importEntrypoints: Type.Optional(
      Type.Record(Type.String(), Type.Array(EntrypointSchema)),
    ),
  },
  { additionalProperties: true },
);

export const RuntimeResourceSchema = Type.Object(
  {
    kind: Type.String(),
    metadata: Type.Object(
      { name: Type.String() },
      { additionalProperties: true },
    ),
  },
  { additionalProperties: true },
);

export const ResourceDefinitionSchema = Type.Object(
  {
    kind: Type.Literal('Runtime.Definition'),
    metadata: Type.Object(
      {
        name: Type.String(),
        resourceKind: Type.String(),
        module: Type.Optional(Type.String()),
      },
      { additionalProperties: true },
    ),
    schema: Type.Object({}, { additionalProperties: true }),
    events: Type.Optional(Type.Array(Type.String())),
    controllers: Type.Optional(Type.Array(EntrypointSchema)),
  },
  { additionalProperties: true },
);

const ajv = new Ajv({ allErrors: true, strict: false });

export const validateModuleManifest = ajv.compile(ModuleManifestSchema);
export const validateRuntimeResource = ajv.compile(RuntimeResourceSchema);
export const validateResourceDefinition = ajv.compile(ResourceDefinitionSchema);

export function formatAjvErrors(
  errors: ErrorObject[] | null | undefined,
): string {
  if (!errors || errors.length === 0) {
    return 'Unknown schema error';
  }
  return errors
    .map((err) => {
      const path =
        err.instancePath && err.instancePath.length > 0
          ? err.instancePath
          : '/';
      const message = err.message || 'is invalid';
      return `${path} ${message}`;
    })
    .join('; ');
}
