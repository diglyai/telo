import { ResourceContext } from "@telorun/sdk";
import { Static, Type } from "@sinclair/typebox";

export const schema = Type.Object(
  {
    schema: Type.Object({
      type: Type.String(),
    }),
  },
  {},
);

type AssertManifest = Static<typeof schema>;

export async function create(manifest: AssertManifest, ctx: ResourceContext) {
  const validator = ctx.createSchemaValidator(manifest.schema);
  return {
    invoke: (data: any) => {
      validator.validate(data);
      return true;
    },
  };
}
