import { RuntimeResource } from "@telorun/sdk";

class DataTypeResource implements RuntimeResource {}

export function create(): RuntimeResource {
  return new DataTypeResource();
}
