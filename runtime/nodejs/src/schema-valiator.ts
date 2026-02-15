import { DataValidator } from "@vokerun/sdk";
import Ajv from "ajv";
import { formatAjvErrors } from "./manifest-schemas";
import { VokeRuntimeError } from "./types";

export class SchemaValidator {
  private ajv: Ajv;

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
          throw new VokeRuntimeError(
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
