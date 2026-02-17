import { DataValidator } from "@telorun/sdk";
import AjvModule from "ajv";
import { formatAjvErrors } from "./manifest-schemas.js";
import { TeloRuntimeError } from "./types.js";
const Ajv = AjvModule.default ?? AjvModule;

export class SchemaValidator {
  private ajv: InstanceType<typeof Ajv>;

  constructor() {
    this.ajv = new Ajv({
      strict: true,
      removeAdditional: false,
      useDefaults: true,
    });
  }

  compile(schema: any): DataValidator {
    const validate = this.ajv.compile(
      "type" in schema && typeof schema.type === "string"
        ? schema
        : {
            type: "object",
            properties: schema,
            required: Object.keys(schema),
            additionalProperties: false,
          },
    );

    return {
      validate: (data: any) => {
        const isValid = validate(data);
        if (!isValid) {
          throw new TeloRuntimeError(
            "ERR_RESOURCE_NOT_FOUND",
            `Invalid value passed: ${JSON.stringify(data)}. Error: ${formatAjvErrors(validate.errors)}`,
          );
        }
      },
      isValid: (data: any) => {
        return validate(data);
      },
    };
  }
}
