import { RuntimeResource } from "@citorun/sdk";

class DataTypeResource implements RuntimeResource {}

export function create(): RuntimeResource {
  return new DataTypeResource();
}
