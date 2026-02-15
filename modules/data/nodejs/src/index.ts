import { RuntimeResource } from "@vokerun/sdk";

class DataTypeResource implements RuntimeResource {}

export function create(): RuntimeResource {
  return new DataTypeResource();
}
